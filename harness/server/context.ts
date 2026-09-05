import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { dataRoot } from "./config.js";
import type { Activity, HookOutput, RunState } from "./types.js";

export function emptyState(): RunState {
  return { id: null, status: "idle", phase: 0, cwd: "", issueUrl: "", instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], artifacts: [] };
}

export const ctx = {
  state: emptyState(),
  terminalBuffer: "",
  sockets: new Set<WebSocket>(),
  pendingQuestionInput: null as Record<string, unknown> | null,
  resolvePendingQuestion: null as ((output?: HookOutput) => void) | null,
};

export function now() { return new Date().toISOString(); }

export function activity(kind: Activity["kind"], title: string, detail?: string) {
  ctx.state.activities = [{ id: crypto.randomUUID(), at: now(), kind, title, detail }, ...ctx.state.activities].slice(0, 80);
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
