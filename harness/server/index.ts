import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import next from "next";
import * as pty from "node-pty";
import chokidar, { type FSWatcher } from "chokidar";
import { WebSocketServer, WebSocket } from "ws";

type RunStatus = "idle" | "starting" | "running" | "attention" | "completed" | "failed";
type AgentStatus = "running" | "completed" | "failed";
type AgentState = { id: string; name: string; status: AgentStatus; startedAt: string; endedAt?: string };
type Activity = { id: string; at: string; kind: "system" | "agent" | "tool" | "artifact" | "attention"; title: string; detail?: string };
type RunState = { id: string | null; status: RunStatus; phase: number; cwd: string; issueUrl: string; instruction: string; startedAt: string | null; endedAt: string | null; agents: AgentState[]; activities: Activity[]; artifacts: string[]; error?: string };
type ClientMessage =
  | { type: "run.start"; cwd: string; issueUrl: string; instruction?: string }
  | { type: "terminal.input"; data: string }
  | { type: "terminal.resize"; cols: number; rows: number }
  | { type: "run.stop" }
  | { type: "run.reset" };

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.resolve(harnessRoot, "..");
const dataRoot = path.join(harnessRoot, "data", "runs");
const port = Number(process.env.PORT ?? 3210);
const hostname = process.env.X_IMPLEMENT_HOST ?? "127.0.0.1";
const dev = process.env.NODE_ENV !== "production";
let terminal: pty.IPty | null = null;
let artifactWatcher: FSWatcher | null = null;
let terminalBuffer = "";
let state: RunState = emptyState();
const app = next({ dev, hostname, port, dir: harnessRoot });
const handle = app.getRequestHandler();
const sockets = new Set<WebSocket>();

function emptyState(): RunState {
  return { id: null, status: "idle", phase: 0, cwd: "", issueUrl: "", instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], artifacts: [] };
}
function now() { return new Date().toISOString(); }
function activity(kind: Activity["kind"], title: string, detail?: string) {
  state.activities = [{ id: crypto.randomUUID(), at: now(), kind, title, detail }, ...state.activities].slice(0, 80);
}
function broadcast(message: object) {
  const serialized = JSON.stringify(message);
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(serialized);
}
async function persistState() {
  if (!state.id) return;
  const runDir = path.join(dataRoot, state.id);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "run.json"), JSON.stringify(state, null, 2));
}
function publishState() { broadcast({ type: "state", state }); void persistState(); }
function findExecutable(name: string) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 180) : undefined;
}
function phaseForArtifact(relativePath: string) {
  const name = path.basename(relativePath);
  if (name === "ticket-context.md") return 1;
  if (name === "open-questions.md") return 2;
  if (name === "planner-output.json") return 4;
  if (name.startsWith("developer-report")) return 5;
  if (name.startsWith("senior-review") || name.startsWith("designer-review") || name.startsWith("qa-report")) return 6;
  if (name === "review-summary.md") return 7;
  if (name === "mr-description.md") return 8;
  if (name === "mr-review-comment.md") return 9;
  return 0;
}
async function archiveArtifact(source: string) {
  if (!state.id) return;
  const taskRoot = path.join(state.cwd, ".claude", "tasks");
  const relative = path.relative(taskRoot, source);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return;
  const target = path.join(dataRoot, state.id, "artifacts", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  if (!state.artifacts.includes(relative)) {
    state.artifacts = [...state.artifacts, relative];
    activity("artifact", "Nouvel artefact", relative);
  }
  state.phase = Math.max(state.phase, phaseForArtifact(relative));
  publishState();
}
async function startArtifactWatcher(cwd: string) {
  await artifactWatcher?.close();
  const taskRoot = path.join(cwd, ".claude", "tasks");
  artifactWatcher = chokidar.watch(taskRoot, { ignoreInitial: false, awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 80 } });
  artifactWatcher.on("add", (file) => void archiveArtifact(file));
  artifactWatcher.on("change", (file) => void archiveArtifact(file));
}
async function startRun(message: Extract<ClientMessage, { type: "run.start" }>) {
  if (terminal) throw new Error("Une session Claude Code est déjà active.");
  const cwd = path.resolve(message.cwd.trim());
  if (!existsSync(cwd)) throw new Error("Le répertoire du projet n’existe pas.");
  const claude = findExecutable("claude");
  if (!claude) throw new Error("Claude Code est introuvable dans PATH.");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  state = { ...emptyState(), id, status: "starting", cwd, issueUrl: message.issueUrl.trim(), instruction: message.instruction?.trim() ?? "", startedAt: now() };
  terminalBuffer = "";
  activity("system", "Session créée", path.basename(cwd));
  publishState();
  await startArtifactWatcher(cwd);
  const command = `/x-implement:x-implement ${state.issueUrl}${state.instruction ? ` ${state.instruction}` : ""}`;
  terminal = pty.spawn(claude, ["--plugin-dir", pluginRoot, "--name", `x-implement ${path.basename(cwd)}`, command], {
    name: "xterm-256color", cols: 120, rows: 34, cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", X_IMPLEMENT_RUN_ID: id, X_IMPLEMENT_HARNESS_HOOK_URL: `http://${hostname}:${port}/api/hooks` },
  });
  state.status = "running";
  activity("system", "Claude Code démarré", command);
  publishState();
  terminal.onData((data) => {
    terminalBuffer = (terminalBuffer + data).slice(-600_000);
    broadcast({ type: "terminal.output", data });
    if (state.id) void appendFile(path.join(dataRoot, state.id, "terminal.log"), data).catch(() => undefined);
  });
  terminal.onExit(({ exitCode }) => {
    terminal = null;
    state.status = exitCode === 0 ? "completed" : "failed";
    state.endedAt = now();
    if (exitCode !== 0) state.error = `Claude Code s’est arrêté avec le code ${exitCode}.`;
    activity("system", exitCode === 0 ? "Session terminée" : "Session interrompue", `Code ${exitCode}`);
    publishState();
  });
}
function stopRun() {
  if (!terminal) return;
  terminal.kill(); terminal = null; state.status = "completed"; state.endedAt = now();
  activity("system", "Session arrêtée par l’utilisateur"); publishState();
}
function processHook(body: Record<string, unknown>) {
  if (!state.id || body.runId !== state.id) return;
  const payload = (body.payload ?? {}) as Record<string, unknown>;
  const event = normalizeText(payload.hook_event_name) ?? "Hook";
  const agentName = normalizeText(payload.agent_type) ?? "agent";
  const agentId = normalizeText(payload.agent_id) ?? `${agentName}-${Date.now()}`;
  if (event === "SubagentStart") {
    state.agents = [{ id: agentId, name: agentName, status: "running", startedAt: now() }, ...state.agents.filter((agent) => agent.id !== agentId)];
    activity("agent", `${agentName} démarre`);
  } else if (event === "SubagentStop") {
    state.agents = state.agents.map((agent) => agent.id === agentId || (agent.name === agentName && agent.status === "running") ? { ...agent, status: "completed", endedAt: now() } : agent);
    activity("agent", `${agentName} termine`);
  } else if (event === "PreToolUse") {
    const tool = normalizeText(payload.tool_name) ?? "outil";
    const toolInput = payload.tool_input as Record<string, unknown> | undefined;
    activity("tool", tool, normalizeText(toolInput?.description) ?? normalizeText(toolInput?.command));
  } else if (event === "Notification") {
    state.status = "attention"; activity("attention", "Claude Code attend ton attention", normalizeText(payload.message));
  } else if (event === "Stop") {
    if (state.phase >= 8) state.phase = 10;
    state.status = state.phase >= 10 ? "completed" : "attention";
    activity("attention", state.phase >= 10 ? "Workflow terminé" : "Claude Code attend une réponse");
  }
  publishState();
}
async function readBody(request: IncomingMessage) {
  let body = ""; for await (const chunk of request) body += chunk;
  return JSON.parse(body || "{}") as Record<string, unknown>;
}
function respond(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body));
}

await mkdir(dataRoot, { recursive: true });
await app.prepare();
const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/hooks") {
    try { processHook(await readBody(request)); respond(response, 200, { ok: true }); }
    catch { respond(response, 400, { ok: false }); }
    return;
  }
  if (request.method === "GET" && request.url === "/api/state") { respond(response, 200, { state }); return; }
  await handle(request, response);
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") { socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
});
wss.on("connection", (socket) => {
  sockets.add(socket); socket.send(JSON.stringify({ type: "state", state }));
  if (terminalBuffer) socket.send(JSON.stringify({ type: "terminal.output", data: terminalBuffer }));
  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientMessage;
      if (message.type === "run.start") await startRun(message);
      if (message.type === "terminal.input") terminal?.write(message.data);
      if (message.type === "terminal.resize") terminal?.resize(message.cols, message.rows);
      if (message.type === "run.stop") stopRun();
      if (message.type === "run.reset" && !terminal) { state = emptyState(); terminalBuffer = ""; publishState(); }
    } catch (error) {
      state.status = "failed"; state.error = error instanceof Error ? error.message : "Impossible d’exécuter cette action.";
      activity("system", "Erreur", state.error); publishState();
    }
  });
  socket.on("close", () => sockets.delete(socket));
});
server.listen(port, hostname, () => console.log(`X-Implement Harness: http://${hostname}:${port}`));
async function shutdown() { terminal?.kill(); await artifactWatcher?.close(); server.close(); }
process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
