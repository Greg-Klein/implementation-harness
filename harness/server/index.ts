import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";
import next from "next";
import * as pty from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import { ctx, activity, emptyState, now, publishState } from "./context.js";
import { terminalExitStatus } from "./domain.js";
import { hostname, port, dev, pluginRoot, dataRoot, harnessRoot } from "./config.js";
import { closeArtifactWatcher, readArtifact, startArtifactWatcher } from "./artifacts.js";
import { answerQuestion, clearPendingQuestion, processHook } from "./hooks.js";
import { clearDemoTimers, continueDemoRun, startDemoRun } from "./demo.js";
import { demoRsiDiff } from "./demo-data.js";
import { saveFeedback, scheduleAutonomousReview } from "./rsi.js";
import { configuredRepositories, detectProjectDirectory, findExecutable, resolveProjectDirectory } from "./repository.js";
import type { ClientMessage } from "./types.js";

const execFileAsync = promisify(execFile);
let terminal: pty.IPty | null = null;
const intentionallyStoppedRuns = new Set<string>();

async function applyRsiReview(worktreeName: string, merge: boolean) {
  if (!ctx.state.pendingRsiReview || ctx.state.pendingRsiReview.worktreeName !== worktreeName)
    throw new Error("Aucune révision RSI en attente pour ce worktree.");
  if (worktreeName.startsWith("demo-")) {
    activity("system", merge ? "Améliorations RSI fusionnées (démo)" : "Améliorations RSI ignorées (démo)", worktreeName);
    ctx.state.pendingRsiReview = undefined;
    publishState();
    return;
  }
  const { stdout: listOut } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: pluginRoot });
  const block = listOut.split("\n\n").find((b) => b.includes(`refs/heads/${worktreeName}`));
  const worktreePath = block?.split("\n").find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
  if (!worktreePath) throw new Error(`Worktree "${worktreeName}" introuvable.`);
  if (merge) {
    await execFileAsync("git", ["-C", pluginRoot, "merge", "--no-ff", worktreeName, "-m", `rsi: apply improvements from ${worktreeName}`]);
    activity("system", "Améliorations RSI fusionnées", worktreeName);
  } else {
    activity("system", "Améliorations RSI ignorées", worktreeName);
  }
  await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], { cwd: pluginRoot });
  await execFileAsync("git", ["-C", pluginRoot, "branch", "-D", worktreeName]).catch(() => undefined);
  ctx.state.pendingRsiReview = undefined;
  publishState();
}

async function startRun(message: Extract<ClientMessage, { type: "run.start" }>) {
  if (terminal) throw new Error("Une session Claude Code est déjà active.");
  clearDemoTimers();
  const cwd = await resolveProjectDirectory(message.cwd, message.issueUrl);
  const claude = findExecutable("claude");
  if (!claude) throw new Error("Claude Code est introuvable dans PATH.");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  ctx.state = { ...emptyState(), id, status: "starting", cwd, issueUrl: message.issueUrl.trim(), instruction: message.instruction?.trim() ?? "", startedAt: now() };
  ctx.terminalBuffer = "";
  activity("system", "Session créée", path.basename(cwd));
  publishState();
  await startArtifactWatcher(cwd);
  const command = `/x-implement:x-implement ${ctx.state.issueUrl}${ctx.state.instruction ? ` ${ctx.state.instruction}` : ""}`;
  const runTerminal = pty.spawn(claude, ["--plugin-dir", pluginRoot, "--name", `x-implement ${path.basename(cwd)}`, command], {
    name: "xterm-256color", cols: 120, rows: 34, cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", X_IMPLEMENT_RUN_ID: id, X_IMPLEMENT_HARNESS_HOOK_URL: `http://${hostname}:${port}/api/hooks` },
  });
  terminal = runTerminal;
  ctx.state.status = "running";
  activity("system", "Claude Code démarré", command);
  publishState();
  runTerminal.onData((data) => {
    ctx.terminalBuffer = (ctx.terminalBuffer + data).slice(-600_000);
    for (const socket of ctx.sockets) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "terminal.output", data }));
    void appendFile(path.join(dataRoot, id, "terminal.log"), data).catch(() => undefined);
  });
  runTerminal.onExit(({ exitCode }) => {
    const intentionallyStopped = intentionallyStoppedRuns.delete(id);
    if (ctx.state.id !== id) return;
    if (terminal === runTerminal) terminal = null;
    ctx.state.status = terminalExitStatus(exitCode, intentionallyStopped);
    clearPendingQuestion();
    ctx.state.endedAt = now();
    if (ctx.state.status === "failed") ctx.state.error = `Claude Code s'est arrêté avec le code ${exitCode}.`;
    activity("system", intentionallyStopped ? "Session arrêtée par l'utilisateur" : exitCode === 0 ? "Session terminée" : "Session interrompue", `Code ${exitCode}`);
    publishState();
    scheduleAutonomousReview(id);
  });
}

function stopRun() {
  if (ctx.state.id?.startsWith("demo-")) {
    clearDemoTimers();
    ctx.state.pendingQuestion = undefined;
    ctx.state.pendingRsiReview = undefined;
    ctx.state.status = "completed";
    ctx.state.endedAt = now();
    activity("system", "Démonstration arrêtée");
    publishState();
    return;
  }
  if (!terminal) return;
  const runId = ctx.state.id;
  clearPendingQuestion();
  if (runId) intentionallyStoppedRuns.add(runId);
  terminal.kill(); terminal = null;
}

function readBody(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { try { resolve(JSON.parse(body || "{}") as Record<string, unknown>); } catch { reject(new Error("Invalid JSON")); } });
    request.on("error", reject);
  });
}

function respond(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body));
}

await mkdir(dataRoot, { recursive: true });
const app = next({ dev, hostname, port, dir: harnessRoot });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/hooks") {
    try {
      const hookOutput = await processHook(await readBody(request));
      respond(response, 200, { ok: true, hookOutput: hookOutput ?? null });
    } catch { respond(response, 400, { ok: false }); }
    return;
  }
  if (request.method === "GET" && request.url === "/api/state") { respond(response, 200, { state: ctx.state }); return; }
  if (request.method === "GET" && request.url?.startsWith("/api/artifacts")) {
    const requestUrl = new URL(request.url, `http://${hostname}:${port}`);
    try { respond(response, 200, await readArtifact(requestUrl.searchParams.get("path") ?? "")); }
    catch (error) { respond(response, 404, { error: error instanceof Error ? error.message : "Document introuvable." }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/rsi/diff")) {
    const worktreeName = new URL(request.url, `http://${hostname}:${port}`).searchParams.get("worktree") ?? "";
    if (!worktreeName || !/^[a-z0-9-]+$/i.test(worktreeName)) { respond(response, 400, { error: "Nom de worktree invalide." }); return; }
    if (worktreeName.startsWith("demo-")) { respond(response, 200, { diff: demoRsiDiff }); return; }
    try {
      const exec = promisify(execFile);
      const { stdout: listOut } = await exec("git", ["worktree", "list", "--porcelain"], { cwd: pluginRoot });
      const worktreePath = listOut.split("\n\n").flatMap((block) => {
        const pathLine = block.split("\n").find((l) => l.startsWith("worktree "));
        const branchLine = block.split("\n").find((l) => l.startsWith("branch "));
        if (pathLine && branchLine?.includes(worktreeName)) return [pathLine.slice("worktree ".length)];
        return [];
      })[0];
      if (!worktreePath) { respond(response, 404, { error: "Worktree introuvable." }); return; }
      const { stdout: diff } = await exec("git", ["diff", "HEAD"], { cwd: worktreePath, maxBuffer: 2 * 1024 * 1024 });
      respond(response, 200, { diff: diff || "(aucune modification détectée)" });
    } catch (error) { respond(response, 500, { error: error instanceof Error ? error.message : "Erreur git." }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/repositories")) {
    const requestUrl = new URL(request.url, `http://${hostname}:${port}`);
    const issueUrl = requestUrl.searchParams.get("issueUrl") ?? "";
    try {
      const detected = issueUrl ? await detectProjectDirectory(issueUrl) : undefined;
      respond(response, 200, { repositories: configuredRepositories(), detected: detected ?? null });
    } catch (error) {
      respond(response, 500, { repositories: configuredRepositories(), detected: null, error: error instanceof Error ? error.message : "Discovery failed." });
    }
    return;
  }
  await handle(request, response);
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") return;
  wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
});
wss.on("connection", (socket) => {
  ctx.sockets.add(socket);
  socket.send(JSON.stringify({ type: "state", state: ctx.state }));
  if (ctx.terminalBuffer) socket.send(JSON.stringify({ type: "terminal.output", data: ctx.terminalBuffer }));
  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientMessage;
      if (message.type === "run.start") await startRun(message);
      if (message.type === "terminal.input") terminal?.write(message.data);
      if (message.type === "terminal.resize") terminal?.resize(message.cols, message.rows);
      if (message.type === "run.stop") stopRun();
      if (message.type === "run.reset" && !terminal) { clearDemoTimers(); ctx.state = emptyState(); ctx.terminalBuffer = ""; publishState(); }
      if (message.type === "demo.start") startDemoRun(terminal !== null);
      if (message.type === "feedback.submit") await saveFeedback(message.body);
      if (message.type === "question.answer") answerQuestion(message.answers, continueDemoRun);
      if (message.type === "rsi.approve") await applyRsiReview(message.worktreeName, true);
      if (message.type === "rsi.reject") await applyRsiReview(message.worktreeName, false);
    } catch (error) {
      ctx.state.status = "failed"; ctx.state.error = error instanceof Error ? error.message : "Impossible d'exécuter cette action.";
      activity("system", "Erreur", ctx.state.error); publishState();
    }
  });
  socket.on("close", () => ctx.sockets.delete(socket));
});

server.listen(port, hostname, () => console.log(`X-Implement Harness: http://${hostname}:${port}`));

async function shutdown() { clearDemoTimers(); terminal?.kill(); await closeArtifactWatcher(); server.close(); }
process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
