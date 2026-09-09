import type { Question } from "./domain.js";

export type RunStatus = "idle" | "starting" | "running" | "attention" | "completed" | "failed";
export type AgentStatus = "running" | "completed" | "failed";
export type AgentState = { id: string; name: string; status: AgentStatus; startedAt: string; endedAt?: string };
export type Activity = { id: string; at: string; kind: "system" | "agent" | "tool" | "artifact" | "attention"; title: string; detail?: string };
export type PendingQuestion = { id: string; questions: Question[] };
/**
 * One worktree the improvement loop left for a verdict, independent of any run: it is
 * discovered by listing worktrees, never tied to the run that happened to spawn it.
 * `mergesCleanly` is false when the branch no longer merges into the harness: the
 * promotion is not one click.
 */
export type PendingSelfImprovementReview = { worktreeName: string; branch?: string; commits: number; mergesCleanly?: boolean };
export type ConversationMessage = { id: string; at: string; author: "claude" | "user"; text: string; pending?: boolean };
export type RunState = {
  id: string | null; status: RunStatus; phase: number; cwd: string; issueUrl: string; instruction: string;
  startedAt: string | null; endedAt: string | null; agents: AgentState[]; activities: Activity[]; messages: ConversationMessage[]; artifacts: string[]; branch?: string; mergeRequestUrl?: string; pendingQuestion?: PendingQuestion; error?: string;
};
export type RepositoryOption = { project: string; path: string; resolvedPath: string; exists: boolean };
export type HookOutput = { hookSpecificOutput: { hookEventName: "PreToolUse"; permissionDecision: "allow"; updatedInput: Record<string, unknown> } };
export type ClientMessage =
  | { type: "run.start"; cwd: string; issueUrl: string; instruction?: string }
  | { type: "terminal.input"; data: string }
  | { type: "instruction.send"; text: string }
  | { type: "terminal.resize"; cols: number; rows: number }
  | { type: "run.stop" }
  | { type: "run.reset" }
  | { type: "demo.start" }
  | { type: "feedback.submit"; body: string }
  | { type: "question.answer"; answers: Record<string, string> }
  | { type: "selfImprovement.approve"; worktreeName: string }
  | { type: "selfImprovement.reject"; worktreeName: string };
