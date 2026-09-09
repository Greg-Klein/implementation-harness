import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { dataRoot } from "./config.js";
import type { Activity, ConversationMessage, RunState } from "./types.js";

export function emptyState(): RunState {
  return { id: null, status: "idle", phase: 0, cwd: "", issueUrl: "", instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], messages: [], artifacts: [], sessionActive: false };
}

export const ctx = {
  state: emptyState(),
  terminalBuffer: "",
  sockets: new Set<WebSocket>(),
  pendingQuestionInput: null as Record<string, unknown> | null,
  /** Resolved with whatever the active engine expects back, which only that engine knows. */
  resolvePendingQuestion: null as ((output?: unknown) => void) | null,
};

/**
 * Every event pushes the whole state to the clients, so the feed they receive
 * stays a window. The archive is the only history a later audit can read, and
 * writing that same window to it destroyed the rest: a run of an hour kept
 * eighty events and lost its first thirty-four minutes.
 */
const BROADCAST_ACTIVITIES = 80;
/** Bounded too, because the archive is rewritten in full on every event. */
const ARCHIVED_ACTIVITIES = 1_000;
let archive = { runId: null as string | null, activities: [] as Activity[] };

export function now() { return new Date().toISOString(); }

export function activity(kind: Activity["kind"], title: string, detail?: string) {
  const entry: Activity = { id: crypto.randomUUID(), at: now(), kind, title, detail };
  // Starting a run replaces the state wholesale, so the run an archive belongs
  // to is the only thing telling the current one from the previous.
  if (archive.runId !== ctx.state.id) archive = { runId: ctx.state.id, activities: [] };
  archive.activities = [entry, ...archive.activities].slice(0, ARCHIVED_ACTIVITIES);
  ctx.state.activities = [entry, ...ctx.state.activities].slice(0, BROADCAST_ACTIVITIES);
}

/** The run as it is archived: the same state, with the history the clients never received. */
export function archivedState(): RunState {
  return archive.runId === ctx.state.id ? { ...ctx.state, activities: archive.activities } : ctx.state;
}

/** Late transcript reads can repeat a message the input already showed, so the local echo is replaced rather than doubled. */
export function conversationMessage(message: ConversationMessage) {
  const echoed = message.author === "user"
    ? ctx.state.messages.findLast((entry) => entry.id.startsWith("local-") && entry.text === message.text)
    : undefined;
  ctx.state.messages = echoed
    ? ctx.state.messages.map((entry) => (entry === echoed ? message : entry))
    : [...ctx.state.messages, message].slice(-400);
}

export function broadcast(message: object) {
  const serialized = JSON.stringify(message);
  for (const socket of ctx.sockets) if (socket.readyState === WebSocket.OPEN) socket.send(serialized);
}

async function persistState() {
  if (!ctx.state.id || ctx.state.id.startsWith("demo-")) return;
  const runDir = path.join(dataRoot, ctx.state.id);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "run.json"), JSON.stringify(archivedState(), null, 2));
}

export function publishState() { broadcast({ type: "state", state: ctx.state }); void persistState(); }
