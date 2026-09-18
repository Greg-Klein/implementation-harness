import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { broadcast, now } from "./context.js";
import { dataRoot, hostname, maxConcurrentRuns, port, queueFile } from "./config.js";
import { closeAbandonedAgents, describeQueue, runInProgress, terminalExitStatus } from "./domain.js";
import { clearTaskDirectory, closeArtifactWatcher, startArtifactWatcher } from "./artifacts.js";
import { closeTranscript } from "./transcript.js";
import { clearPendingQuestion } from "./hooks.js";
import { acknowledgeDemoInstruction, demoLaunchState, startDemoRun } from "./demo.js";
import { scheduleAutonomousReview } from "./self-improvement.js";
import { resolveProjectDirectory } from "./repository.js";
import { engine } from "./engine/index.js";
import { RunSession } from "./run-session.js";
import type { HarnessSnapshot, QueuedRun } from "./types.js";

export type LaunchRequest = { cwd: string; issueUrl: string; instruction?: string };
export type LaunchOutcome = { started: RunSession } | { queued: QueuedRun };

function runIdentifier() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Every run the console is holding, and the launches waiting for room. Two
 * ceilings, both enforced here and nowhere else:
 *
 * - one run per checkout, because two agent sessions in the same working tree
 *   fight over the branch, over `.claude/tasks` and over each other's edits;
 * - `maxConcurrentRuns` sessions in total, because each one is a full Claude
 *   Code session with its own quota and its own CPU.
 *
 * A launch that hits either one is queued rather than refused, and the queue is
 * drained the moment a run lets go of its checkout.
 */
export class RunRegistry {
  private readonly sessions = new Map<string, RunSession>();
  private queue: QueuedRun[] = [];

  get(runId: string | undefined) {
    return runId ? this.sessions.get(runId) : undefined;
  }

  /** The run holding each checkout right now, which is what a queued launch waits on. */
  private holders() {
    const holders = new Map<string, string>();
    for (const session of this.sessions.values()) if (session.holdsRepository) holders.set(session.state.cwd, session.id);
    return holders;
  }

  private occupiedSlots() {
    return [...this.sessions.values()].filter((session) => session.holdsRepository).length;
  }

  snapshot(): HarnessSnapshot {
    return {
      // Newest first, the order the side list reads in.
      runs: [...this.sessions.values()].map((session) => session.summary()).sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? "")),
      queued: describeQueue(this.queue, this.holders()),
      maxConcurrentRuns,
    };
  }

  publishSnapshot() {
    broadcast({ type: "harness", snapshot: this.snapshot() });
  }

  /**
   * Starts the run if there is room for it, queues it otherwise. The checkout is
   * resolved here, before anything is queued, so a ticket with no checkout fails
   * while the user is still looking at the form rather than an hour later.
   */
  async launch(request: LaunchRequest): Promise<LaunchOutcome> {
    if (!engine.locate()) throw new Error(`${engine.label} est introuvable dans PATH.`);
    const cwd = await resolveProjectDirectory(request.cwd, request.issueUrl);
    const entry: QueuedRun = {
      id: `queued-${crypto.randomUUID().slice(0, 8)}`,
      cwd,
      issueUrl: request.issueUrl.trim(),
      instruction: request.instruction?.trim() ?? "",
      queuedAt: now(),
    };
    if (this.holders().has(cwd) || this.occupiedSlots() >= maxConcurrentRuns) {
      this.queue = [...this.queue, entry];
      await this.persistQueue();
      this.publishSnapshot();
      return { queued: entry };
    }
    const started = await this.start(entry);
    this.publishSnapshot();
    return { started };
  }

  /** The simulated run, subject to the same ceilings: it takes a slot and it holds its own address. */
  startDemo() {
    const launch = demoLaunchState();
    if (this.holders().has(launch.cwd)) throw new Error("Une démonstration est déjà en cours.");
    if (this.occupiedSlots() >= maxConcurrentRuns) throw new Error(`Le harnais tient déjà ${maxConcurrentRuns} runs. Libère une place avant de lancer la démonstration.`);
    const session = this.register(new RunSession(`demo-${crypto.randomUUID().slice(0, 8)}`, launch));
    startDemoRun(session);
    this.publishSnapshot();
    return session;
  }

  private register(session: RunSession) {
    session.onChange = () => this.publishSnapshot();
    this.sessions.set(session.id, session);
    return session;
  }

  private async start(entry: QueuedRun) {
    const id = runIdentifier();
    const session = this.register(new RunSession(id, {
      status: "starting", phase: 1, cwd: entry.cwd, issueUrl: entry.issueUrl, instruction: entry.instruction, startedAt: now(),
    }));
    session.activity("system", "Session créée", path.basename(entry.cwd));
    session.publish();
    await clearTaskDirectory(entry.cwd);
    await startArtifactWatcher(session);
    const command = engine.command(session.state.issueUrl, session.state.instruction);
    session.engine = engine.start({
      cwd: entry.cwd, runId: id, command,
      hookUrl: `http://${hostname}:${port}/api/hooks`,
      onData: (data) => {
        session.appendTerminal(data);
        void appendFile(path.join(dataRoot, id, "terminal.log"), data).catch(() => undefined);
      },
      onExit: (exitCode) => this.handleExit(session, exitCode),
    });
    session.state.status = "running";
    session.state.sessionActive = true;
    session.activity("system", `${engine.label} démarré`, command);
    session.publish();
    return session;
  }

  private handleExit(session: RunSession, exitCode: number) {
    session.engine = null;
    session.state.sessionActive = false;
    // Whatever the session was doing when it went away, it is not doing it now.
    session.state.action = undefined;
    clearPendingQuestion(session);
    // The workflow can already have closed the run, and how its idle session
    // then ends says nothing about the outcome it reached.
    if (runInProgress(session.state.status)) {
      session.state.status = terminalExitStatus(exitCode, session.intentionallyStopped);
      session.state.endedAt = now();
      if (session.state.status === "failed") session.state.error = `${engine.label} s'est arrêté avec le code ${exitCode}.`;
    }
    session.activity("system", session.intentionallyStopped ? "Session arrêtée par l'utilisateur" : exitCode === 0 ? "Session terminée" : "Session interrompue", `Code ${exitCode}`);
    closeAgentsLeftBehind(session);
    session.publish();
    scheduleAutonomousReview(session);
    // The checkout and the slot are free now, which is what the queue waits on.
    void this.drain();
  }

  stop(runId: string) {
    const session = this.expect(runId);
    if (session.demo) {
      session.clearDemoTimers();
      session.state.pendingQuestion = undefined;
      session.state.action = undefined;
      session.state.status = "stopped";
      session.state.endedAt = now();
      session.activity("system", "Démonstration arrêtée");
      closeAgentsLeftBehind(session);
      session.publish();
      void this.drain();
      return;
    }
    if (!session.engine) return;
    session.intentionallyStopped = true;
    clearPendingQuestion(session);
    session.engine.kill();
    session.engine = null;
  }

  /**
   * Removes a finished run from the console. Refused while its session is still
   * up: the run would vanish from the list with a live agent session behind it,
   * reachable from nowhere.
   */
  async close(runId: string) {
    const session = this.expect(runId);
    if (session.holdsRepository) throw new Error("Ce run tient encore sa session. Arrête-la avant de le fermer.");
    await closeArtifactWatcher(session);
    await closeTranscript(session);
    await session.dispose();
    this.sessions.delete(runId);
    this.publishSnapshot();
    await this.drain();
  }

  sendInstruction(runId: string, text: string) {
    const session = this.expect(runId);
    const instruction = text.trim();
    if (!instruction) throw new Error("L'instruction est vide.");
    if (!session.engine && !session.demo) throw new Error(`Aucune session ${engine.label} n'est active.`);
    session.engine?.submit(instruction);
    session.conversationMessage({ id: `local-${crypto.randomUUID()}`, at: now(), author: "user", text: instruction, pending: session.engine !== null });
    session.activity("system", "Instruction transmise", instruction);
    session.publish();
    if (!session.engine) acknowledgeDemoInstruction(session);
  }

  cancelQueued(queuedId: string) {
    const remaining = this.queue.filter((entry) => entry.id !== queuedId);
    if (remaining.length === this.queue.length) throw new Error("Cette demande n'est plus en file.");
    this.queue = remaining;
    void this.persistQueue();
    this.publishSnapshot();
  }

  /**
   * Starts everything the freed room allows, in the order the launches were
   * asked for. An entry whose checkout is still held is stepped over rather than
   * blocking the ones behind it: it is waiting on a different run, and holding
   * the whole queue for it would leave free slots idle.
   */
  async drain() {
    for (;;) {
      if (this.occupiedSlots() >= maxConcurrentRuns) break;
      const holders = this.holders();
      const index = this.queue.findIndex((entry) => !holders.has(entry.cwd));
      if (index < 0) break;
      const [entry] = this.queue.splice(index, 1);
      try {
        await this.start(entry);
      } catch (error) {
        broadcast({ type: "notice", level: "attention", title: "Run en file non démarré", detail: error instanceof Error ? error.message : String(error), at: now() });
      }
    }
    await this.persistQueue();
    this.publishSnapshot();
  }

  private expect(runId: string) {
    const session = this.sessions.get(runId);
    if (!session) throw new Error("Ce run n'existe plus.");
    return session;
  }

  private async persistQueue() {
    await mkdir(path.dirname(queueFile), { recursive: true }).catch(() => undefined);
    await writeFile(queueFile, JSON.stringify(this.queue, null, 2)).catch(() => undefined);
  }

  /**
   * The launches accepted before the console went down. They were queued because
   * something else was running, and that something else did not survive the
   * restart, so they start as soon as the server is listening.
   */
  async restoreQueue() {
    try {
      const stored = JSON.parse(await readFile(queueFile, "utf8")) as unknown;
      this.queue = Array.isArray(stored) ? stored.filter((entry): entry is QueuedRun =>
        Boolean(entry) && typeof entry === "object"
        && typeof (entry as QueuedRun).id === "string"
        && typeof (entry as QueuedRun).cwd === "string"
        && typeof (entry as QueuedRun).issueUrl === "string") : [];
    } catch {
      this.queue = [];
    }
  }

  async shutdown() {
    for (const session of this.sessions.values()) await session.dispose().catch(() => undefined);
    this.sessions.clear();
  }
}

/**
 * Called on every path that ends a run, and before the self-audit reads the
 * state: an agent the session can no longer report on must stop reading as
 * running, in the console and in the signals the improvement loop is given.
 */
function closeAgentsLeftBehind(session: RunSession) {
  const { agents, abandoned } = closeAbandonedAgents(session.state.agents, now());
  if (abandoned.length === 0) return;
  session.state.agents = agents;
  session.activity("agent", abandoned.length === 1 ? "Un agent n'a jamais rapporté sa fin" : `${abandoned.length} agents n'ont jamais rapporté leur fin`, abandoned.map((agent) => agent.name).join(" · "));
}

export const registry = new RunRegistry();
