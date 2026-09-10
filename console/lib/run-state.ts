import type { Status } from "./types";

export function activeAgents<T extends { status: string }>(agents: T[]) {
  return agents.filter((agent) => agent.status === "running");
}

export function isDemoRun(id?: string | null) {
  return typeof id === "string" && id.startsWith("demo-");
}

export function runInProgress(status: Status) {
  return status === "starting" || status === "running" || status === "attention";
}

/**
 * The workflow can be over with the engine session still open at its prompt
 * (`sessionActive`), and the conversation should stay usable for as long as that
 * session is, not just while a workflow phase is running.
 */
export function sessionAlive(status: Status, sessionActive?: boolean) {
  return runInProgress(status) || sessionActive === true;
}

/** Long enough to bridge two bursts of terminal output, short enough to fall silent as soon as the session does. */
const OUTPUT_IDLE_MS = 1_500;

/**
 * Claude Code writes a paragraph to its transcript only once the action that
 * followed it has returned, so the conversation can be a minute behind the
 * terminal. The output of the session is the only live signal that the message
 * on screen is not the last one, and saying so beats looking frozen.
 */
export function isWriting(alive: boolean, lastOutputAt: number, now: number) {
  return alive && now - lastOutputAt < OUTPUT_IDLE_MS;
}

/**
 * A branch, an agent or an artifact can only be recorded once a hook has fired,
 * and every hook payload names the transcript to read the dialogue from. An
 * empty conversation next to that kind of progress means the follower missed
 * the transcript, not that Claude is merely slow to write its next message: the
 * ordinary lag the "Claude réfléchit…" hint covers never reaches this point
 * empty-handed.
 */
export function isTranscriptStalled(messageCount: number, phase: number, agentCount: number, artifactCount: number) {
  return messageCount === 0 && (phase > 0 || agentCount > 0 || artifactCount > 0);
}

export function pendingAnswerLabel(count: number) {
  return count === 1 ? "Claude attend une réponse" : `Claude attend ${count} réponses`;
}

export function elapsedLabel(start: string, end: string | undefined, now: number) {
  const milliseconds = (end ? new Date(end).getTime() : now) - new Date(start).getTime();
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return minutes ? `${minutes} min ${seconds.toString().padStart(2, "0")} s` : `${seconds} s`;
}
