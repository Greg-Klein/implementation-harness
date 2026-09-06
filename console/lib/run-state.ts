export function activeAgents<T extends { status: string }>(agents: T[]) {
  return agents.filter((agent) => agent.status === "running");
}

export function pendingAnswerLabel(count: number) {
  return count === 1 ? "Claude attend une réponse" : `Claude attend ${count} réponses`;
}
