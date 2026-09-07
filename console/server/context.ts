import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { dataRoot } from "./config.js";
import type { Activity, ConversationMessage, RunState } from "./types.js";

export function emptyState(): RunState {
  return { id: null, status: "idle", phase: 0, cwd: "", issueUrl: "", instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], messages: [], artifacts: [] };
}

export const ctx = {
  state: emptyState(),
  terminalBuffer: "",
  sockets: new Set<WebSocket>(),
  pendingQuestionInput: null as Record<string, unknown> | null,
  /** Resolved with whatever the active engine expects back, which only that engine knows. */
  resolvePendingQuestion: null as ((output?: unknown) => void) | null,
};

export function now() { return new Date().toISOString(); }

export function activity(kind: Activity["kind"], title: string, detail?: string) {
  ctx.state.activities = [{ id: crypto.randomUUID(), at: now(), kind, title, detail }, ...ctx.state.activities].slice(0, 80);
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
  await writeFile(path.join(runDir, "run.json"), JSON.stringify(ctx.state, null, 2));
}

export function publishState() { broadcast({ type: "state", state: ctx.state }); void persistState(); }
