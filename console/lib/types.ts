export type Status = "idle" | "starting" | "running" | "attention" | "completed" | "failed";
export type Agent = { id: string; name: string; status: "running" | "completed" | "failed"; startedAt: string; endedAt?: string };
export type Activity = { id: string; at: string; kind: string; title: string; detail?: string };
export type QuestionOption = { label: string; description?: string };
export type PendingQuestion = { id: string; questions: { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }[] };
/** `mergesCleanly` is false when the branch no longer merges into the harness: the promotion is not one click. */
export type PendingSelfImprovementReview = { worktreeName: string; branch?: string; commits: number; mergesCleanly?: boolean };
export type ConversationMessage = { id: string; at: string; author: "claude" | "user"; text: string; pending?: boolean };
export type RunState = {
  id: string | null; status: Status; phase: number; cwd: string; issueUrl: string; instruction: string;
  startedAt: string | null; endedAt: string | null; agents: Agent[]; activities: Activity[]; messages: ConversationMessage[]; artifacts: string[]; branch?: string; mergeRequestUrl?: string; pendingQuestion?: PendingQuestion; error?: string;
};
export type RepositoryOption = { project: string; path: string; resolvedPath: string; exists: boolean };
export type RepositoryResponse = {
  repositories: RepositoryOption[];
  detected: (RepositoryOption & { source: "git" }) | null;
};
export type ArtifactResponse = { path: string; content: string; error?: string };
export type PendingImprovementsResponse = { items: PendingSelfImprovementReview[]; error?: string };
