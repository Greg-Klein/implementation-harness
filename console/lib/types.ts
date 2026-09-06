export type Status = "idle" | "starting" | "running" | "attention" | "completed" | "failed";
export type Agent = { id: string; name: string; status: "running" | "completed" | "failed"; startedAt: string; endedAt?: string };
export type Activity = { id: string; at: string; kind: string; title: string; detail?: string };
export type QuestionOption = { label: string; description?: string };
export type PendingQuestion = { id: string; questions: { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }[] };
export type PendingSelfImprovementReview = { worktreeName: string; runId: string };
export type RunState = {
  id: string | null; status: Status; phase: number; cwd: string; issueUrl: string; instruction: string;
  startedAt: string | null; endedAt: string | null; agents: Agent[]; activities: Activity[]; artifacts: string[]; pendingQuestion?: PendingQuestion; pendingSelfImprovementReview?: PendingSelfImprovementReview; error?: string;
};
export type RepositoryOption = { project: string; path: string; resolvedPath: string; exists: boolean };
export type RepositoryResponse = {
  repositories: RepositoryOption[];
  detected: (RepositoryOption & { source: "env" | "git" }) | null;
};
export type ArtifactResponse = { path: string; kind: "text" | "image"; content: string; error?: string };
