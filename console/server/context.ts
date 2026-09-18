import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { closeAbandonedAgents, runInProgress } from "./domain.js";
import type { Activity, RunState, ServerMessage } from "./types.js";

/**
 * Every open page, with the run it has opened. The list of runs goes to all of
 * them; the state of a run and the output of its terminal go only to the pages
 * showing it, so a console with three runs does not push three transcripts and
 * three terminals into every tab.
 */
export const clients = new Map<WebSocket, { runId?: string }>();

export function now() { return new Date().toISOString(); }

function deliver(socket: WebSocket, serialized: string) {
  if (socket.readyState === WebSocket.OPEN) socket.send(serialized);
}

export function send(socket: WebSocket, message: ServerMessage) {
  deliver(socket, JSON.stringify(message));
}

export function broadcast(message: ServerMessage) {
  const serialized = JSON.stringify(message);
  for (const socket of clients.keys()) deliver(socket, serialized);
}

/** To the pages showing this run, and to nobody else. */
export function broadcastToViewers(runId: string, message: ServerMessage) {
  const serialized = JSON.stringify(message);
  for (const [socket, subscription] of clients) if (subscription.runId === runId) deliver(socket, serialized);
}

/** Bounded, because the archive is rewritten in full on every event. */
export const ARCHIVED_ACTIVITIES = 1_000;

/**
 * `RunSession` starts empty on every process boot, but a run archived on disk
 * mid-flight keeps whatever status it last persisted. A crash or a restart
 * between two events leaves it reading "running" forever: nothing was left
 * to ever write its outcome. Read at startup, before any new run can begin,
 * so a stale run is never mistaken for one still in progress.
 */
export async function reconcileInterruptedRuns(runsDirectory: string) {
  let runIds: string[];
  try { runIds = await readdir(runsDirectory); } catch { return; }
  await Promise.all(runIds.map(async (runId) => {
    const runFile = path.join(runsDirectory, runId, "run.json");
    let state: RunState;
    try { state = JSON.parse(await readFile(runFile, "utf8")) as RunState; } catch { return; }
    if (!runInProgress(state.status)) return;
    const endedAt = now();
    const closingEntry: Activity = { id: crypto.randomUUID(), at: endedAt, kind: "system", title: "Run interrompu par un redémarrage du serveur" };
    const interrupted: RunState = {
      ...state,
      status: "failed",
      endedAt,
      sessionActive: false,
      agents: closeAbandonedAgents(state.agents ?? [], endedAt).agents,
      error: "Le serveur du harnais a redémarré ou s'est arrêté pendant que ce run était en cours ; son issue réelle n'a jamais été enregistrée.",
      activities: [closingEntry, ...state.activities].slice(0, ARCHIVED_ACTIVITIES),
    };
    await writeFile(runFile, JSON.stringify(interrupted, null, 2)).catch(() => undefined);
  }));
}
