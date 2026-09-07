export function activeAgents<T extends { status: string }>(agents: T[]) {
  return agents.filter((agent) => agent.status === "running");
}

export function isDemoRun(id?: string | null) {
  return typeof id === "string" && id.startsWith("demo-");
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
