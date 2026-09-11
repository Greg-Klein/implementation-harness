export type Status = "idle" | "starting" | "running" | "attention" | "completed" | "stopped" | "failed";
/** `abandoned`: the run ended before the agent ever reported an outcome, so it has none to read. */
export type Agent = { id: string; name: string; status: "running" | "completed" | "failed" | "abandoned"; startedAt: string; endedAt?: string };
export type Activity = { id: string; at: string; kind: string; title: string; detail?: string };
export type QuestionOption = { label: string; description?: string };
export type PendingQuestion = { id: string; questions: { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }[] };
/** `mergesCleanly` is false when the branch no longer merges into the harness: the promotion is not one click. */
export type PendingSelfImprovementReview = { worktreeName: string; branch?: string; commits: number; mergesCleanly?: boolean; status: "analyzing" | "ready" };
export type ConversationMessage = { id: string; at: string; author: "claude" | "user"; text: string; pending?: boolean };
export type RunState = {
  id: string | null; status: Status; phase: number; cwd: string; issueUrl: string; instruction: string;
  startedAt: string | null; endedAt: string | null; agents: Agent[]; activities: Activity[]; messages: ConversationMessage[]; artifacts: string[]; branch?: string; mergeRequestUrl?: string; pendingQuestion?: PendingQuestion; error?: string;
  /** The engine process behind this run is still up, taking input, whether or not the workflow itself has finished. Absent on states built before this field existed. */
  sessionActive?: boolean;
  /** What Claude is doing at this instant, from the tool it last called. Absent as soon as it hands control back. */
  action?: string;
};
export type RepositoryOption = { project: string; path: string; resolvedPath: string; exists: boolean };
export type RepositoryResponse = {
  repositories: RepositoryOption[];
  detected: (RepositoryOption & { source: "git" }) | null;
};
export type ArtifactResponse = { path: string; content: string; error?: string; encoding?: "utf8" | "base64"; contentType?: string };
export type EvidenceVerdict = "pass" | "fail" | "not_run" | "measured" | "confirmed" | "unverified";
export type EvidenceItem = { label: string; verdict: EvidenceVerdict; expected?: string; actual?: string; command?: string; screenshot?: string; note?: string };
export type EvidenceReport = { source: "qa" | "design" | "developer"; status?: string; items: EvidenceItem[] };
export type PendingImprovementsResponse = { items: PendingSelfImprovementReview[]; error?: string };
