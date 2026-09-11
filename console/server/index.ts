import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { ctx, activity, conversationMessage, emptyState, now, publishState, reconcileInterruptedRuns } from "./context.js";
import { closeAbandonedAgents, runInProgress, terminalExitStatus } from "./domain.js";
import { hostname, port, dev, pluginRoot, dataRoot, consoleRoot } from "./config.js";
import { clearTaskDirectory, closeArtifactWatcher, readArtifact, startArtifactWatcher } from "./artifacts.js";
import { closeTranscript, followTranscript } from "./transcript.js";
import { answerQuestion, clearPendingQuestion, processHook } from "./hooks.js";
import { acknowledgeDemoInstruction, clearDemoTimers, continueDemoRun, demoState, startDemoRun } from "./demo.js";
import { demoSelfImprovementDiff } from "./demo-data.js";
import { listPendingImprovements, saveFeedback, scheduleAutonomousReview } from "./self-improvement.js";
import { detectProjectDirectory, discoverRepositories, resolveProjectDirectory } from "./repository.js";
import { branchIsMerged, findWorktree, mergeBranch, removeWorktree, worktreeDiff, worktreeIsClean } from "./worktree.js";
import { engine } from "./engine/index.js";
import type { EngineSession } from "./engine/index.js";
import type { ClientMessage } from "./types.js";

let terminal: EngineSession | null = null;
const intentionallyStoppedRuns = new Set<string>();

async function applySelfImprovementReview(worktreeName: string, merge: boolean) {
  if (worktreeName.startsWith("demo-")) {
    demoState.pendingImprovement = undefined;
    activity("system", merge ? "Améliorations fusionnées (démo)" : "Améliorations ignorées (démo)", worktreeName);
    publishState();
    return;
  }
  const worktree = await findWorktree(worktreeName);
  if (!worktree) throw new Error(`Aucun worktree d'auto-amélioration "${worktreeName}" à traiter.`);
  if (merge) {
    if (!worktree.branch) throw new Error(`Le worktree "${worktreeName}" n'est sur aucune branche.`);
    // A worktree is destroyed just below, so nothing may be announced as merged
    // before the checkout actually moved.
    const merged = await mergeBranch(pluginRoot, worktree.branch, `self-improvement: apply improvements from ${worktreeName}`)
      .catch((error) => { throw new Error(`La fusion de ${worktreeName} a échoué et a été annulée, le worktree est conservé : ${error instanceof Error ? error.message.split("\n")[0] : error}`); });
    // Git brings nothing in two cases its exit code cannot tell apart: a branch
    // whose commits the harness already contains, and one that holds no commit at
    // all. The first is work landed by hand, and refusing to clean it up left no
    // honest way out — merging said nothing was merged, discarding recorded as
    // ignored what had in fact been kept. The second may still be an agent
    // mid-write, so the worktree only goes when it has nothing uncommitted either.
    const spent = !merged && await branchIsMerged(pluginRoot, worktree.branch) && await worktreeIsClean(worktree);
    if (!merged && !spent)
      throw new Error(`${worktreeName} n'apporte aucun commit à fusionner. Rien n'a été fusionné, le worktree est conservé.`);
    activity("system", merged ? "Améliorations fusionnées" : "Améliorations déjà présentes", worktreeName);
  } else {
    // Merging already refuses to destroy a worktree with something uncommitted
    // on disk (see worktreeIsClean's own contract): ignoring must refuse the same
    // way, or "Ignorer" becomes the one button that can erase a diagnosis the
    // validation step deliberately left uncommitted after a failed check.
    if (!(await worktreeIsClean(worktree)))
      throw new Error(`${worktreeName} contient des changements non validés : les ignorer les détruirait. Rien n'a été touché.`);
    activity("system", "Améliorations ignorées", worktreeName);
  }
  await removeWorktree(pluginRoot, worktree);
  publishState();
}

async function startRun(message: Extract<ClientMessage, { type: "run.start" }>) {
  if (terminal) throw new Error(`Une session ${engine.label} est déjà active.`);
  clearDemoTimers();
  const cwd = await resolveProjectDirectory(message.cwd, message.issueUrl);
  if (!engine.locate()) throw new Error(`${engine.label} est introuvable dans PATH.`);
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  ctx.state = { ...emptyState(), id, status: "starting", phase: 1, cwd, issueUrl: message.issueUrl.trim(), instruction: message.instruction?.trim() ?? "", startedAt: now() };
  ctx.terminalBuffer = "";
  activity("system", "Session créée", path.basename(cwd));
  publishState();
  await clearTaskDirectory(cwd);
  await startArtifactWatcher(cwd);
  await closeTranscript();
  const command = engine.command(ctx.state.issueUrl, ctx.state.instruction);
  const runTerminal = engine.start({
    cwd, runId: id, command,
    hookUrl: `http://${hostname}:${port}/api/hooks`,
    onData: (data) => {
      ctx.terminalBuffer = (ctx.terminalBuffer + data).slice(-600_000);
      for (const socket of ctx.sockets) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "terminal.output", data }));
      void appendFile(path.join(dataRoot, id, "terminal.log"), data).catch(() => undefined);
    },
    onExit: (exitCode) => {
      const intentionallyStopped = intentionallyStoppedRuns.delete(id);
      if (ctx.state.id !== id) return;
      if (terminal === runTerminal) terminal = null;
      ctx.state.sessionActive = false;
      // Whatever the session was doing when it went away, it is not doing it now.
      ctx.state.action = undefined;
      clearPendingQuestion();
      // The workflow can already have closed the run, and how its idle session
      // then ends says nothing about the outcome it reached.
      if (runInProgress(ctx.state.status)) {
        ctx.state.status = terminalExitStatus(exitCode, intentionallyStopped);
        ctx.state.endedAt = now();
        if (ctx.state.status === "failed") ctx.state.error = `${engine.label} s'est arrêté avec le code ${exitCode}.`;
      }
      activity("system", intentionallyStopped ? "Session arrêtée par l'utilisateur" : exitCode === 0 ? "Session terminée" : "Session interrompue", `Code ${exitCode}`);
      closeAgentsLeftBehind();
      publishState();
      scheduleAutonomousReview(id);
    },
  });
  terminal = runTerminal;
  ctx.state.status = "running";
  ctx.state.sessionActive = true;
  activity("system", `${engine.label} démarré`, command);
  publishState();
}

/**
 * Called on every path that ends a run, and before the self-audit reads the
 * state: an agent the session can no longer report on must stop reading as
 * running, in the console and in the signals the improvement loop is given.
 */
function closeAgentsLeftBehind() {
  const { agents, abandoned } = closeAbandonedAgents(ctx.state.agents, now());
  if (abandoned.length === 0) return;
  ctx.state.agents = agents;
  activity("agent", abandoned.length === 1 ? "Un agent n'a jamais rapporté sa fin" : `${abandoned.length} agents n'ont jamais rapporté leur fin`, abandoned.map((agent) => agent.name).join(" · "));
}

function sendInstruction(text: string) {
  const instruction = text.trim();
  if (!instruction) throw new Error("L'instruction est vide.");
  if (!terminal && !ctx.state.id?.startsWith("demo-")) throw new Error(`Aucune session ${engine.label} n'est active.`);
  terminal?.submit(instruction);
  conversationMessage({ id: `local-${crypto.randomUUID()}`, at: now(), author: "user", text: instruction, pending: terminal !== null });
  activity("system", "Instruction transmise", instruction);
  publishState();
  if (!terminal) acknowledgeDemoInstruction();
}

async function resetRun() {
  if (runInProgress(ctx.state.status)) throw new Error("Arrête la session en cours avant de démarrer un nouveau run.");
  // The workflow can be over with the agent session still open at its
  // prompt, and a new run needs the terminal free.
  stopRun();
  clearDemoTimers();
  await closeTranscript();
  ctx.state = emptyState();
  ctx.terminalBuffer = "";
  publishState();
}

function stopRun() {
  if (ctx.state.id?.startsWith("demo-")) {
    clearDemoTimers();
    ctx.state.pendingQuestion = undefined;
    ctx.state.action = undefined;
    ctx.state.status = "stopped";
    ctx.state.endedAt = now();
    activity("system", "Démonstration arrêtée");
    closeAgentsLeftBehind();
    publishState();
    return;
  }
  if (!terminal) return;
  const runId = ctx.state.id;
  clearPendingQuestion();
  if (runId) intentionallyStoppedRuns.add(runId);
  terminal.kill(); terminal = null;
}

/** Every event names the transcript of the session, which is where the dialogue is read from. */
function followRunTranscript(body: Record<string, unknown>) {
  if (!ctx.state.id || body.runId !== ctx.state.id) return;
  const transcript = engine.transcriptPath(body);
  if (transcript) void followTranscript(transcript);
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
await reconcileInterruptedRuns(dataRoot);
const app = next({ dev, hostname, port, dir: consoleRoot });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/hooks") {
    try {
      const body = await readBody(request);
      followRunTranscript(body);
      const hookOutput = await processHook(body);
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
  if (request.method === "GET" && request.url?.startsWith("/api/self-improvement/diff")) {
    const worktreeName = new URL(request.url, `http://${hostname}:${port}`).searchParams.get("worktree") ?? "";
    if (!worktreeName || !/^[a-z0-9-]+$/i.test(worktreeName)) { respond(response, 400, { error: "Nom de worktree invalide." }); return; }
    if (worktreeName.startsWith("demo-")) { respond(response, 200, { diff: demoSelfImprovementDiff }); return; }
    try {
      const worktree = await findWorktree(worktreeName);
      if (!worktree) { respond(response, 404, { error: "Worktree introuvable." }); return; }
      const diff = await worktreeDiff(worktree);
      respond(response, 200, { diff: diff || "(aucune modification détectée)" });
    } catch (error) { respond(response, 500, { error: error instanceof Error ? error.message : "Erreur git." }); }
    return;
  }
  if (request.method === "GET" && request.url === "/api/self-improvement/pending") {
    try { respond(response, 200, { items: await listPendingImprovements() }); }
    catch (error) { respond(response, 500, { items: [], error: error instanceof Error ? error.message : "Erreur git." }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/repositories")) {
    const requestUrl = new URL(request.url, `http://${hostname}:${port}`);
    const issueUrl = requestUrl.searchParams.get("issueUrl") ?? "";
    try {
      const repositories = await discoverRepositories();
      const detected = issueUrl ? await detectProjectDirectory(issueUrl, repositories) : undefined;
      respond(response, 200, { repositories, detected: detected ?? null });
    } catch (error) {
      respond(response, 500, { repositories: [], detected: null, error: error instanceof Error ? error.message : "Discovery failed." });
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
    let message: ClientMessage | undefined;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
      if (message.type === "run.start") await startRun(message);
      if (message.type === "terminal.input") terminal?.write(message.data);
      if (message.type === "instruction.send") sendInstruction(message.text);
      if (message.type === "terminal.resize") terminal?.resize(message.cols, message.rows);
      if (message.type === "run.stop") stopRun();
      if (message.type === "run.reset") await resetRun();
      if (message.type === "demo.start") startDemoRun(terminal !== null);
      if (message.type === "feedback.submit") await saveFeedback(message.body);
      if (message.type === "question.answer") answerQuestion(message.answers, continueDemoRun);
      if (message.type === "selfImprovement.approve") await applySelfImprovementReview(message.worktreeName, true);
      if (message.type === "selfImprovement.reject") await applySelfImprovementReview(message.worktreeName, false);
    } catch (error) {
      ctx.state.error = error instanceof Error ? error.message : "Impossible d'exécuter cette action.";
      // Only a failed launch is the run's own failure. A panel action that fails
      // must not rewrite the status of a run that already ended cleanly, nor be
      // archived as its verdict.
      if (message?.type === "run.start") { ctx.state.status = "failed"; ctx.state.endedAt = now(); }
      activity("system", "Erreur", ctx.state.error); publishState();
    }
  });
  socket.on("close", () => ctx.sockets.delete(socket));
});

server.listen(port, hostname, () => console.log(`Implementation Harness: http://${hostname}:${port}`));

async function shutdown() { clearDemoTimers(); terminal?.kill(); await closeArtifactWatcher(); await closeTranscript(); server.close(); }
process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
