import type { Question } from "./domain.js";

export type RunStatus = "idle" | "starting" | "running" | "attention" | "completed" | "failed";
export type AgentStatus = "running" | "completed" | "failed";
export type AgentState = { id: string; name: string; status: AgentStatus; startedAt: string; endedAt?: string };
export type Activity = { id: string; at: string; kind: "system" | "agent" | "tool" | "artifact" | "attention"; title: string; detail?: string };
export type PendingQuestion = { id: string; questions: Question[] };
export type PendingRsiReview = { worktreeName: string; runId: string };
export type RunState = {
  id: string | null; status: RunStatus; phase: number; cwd: string; issueUrl: string; instruction: string;
  startedAt: string | null; endedAt: string | null; agents: AgentState[]; activities: Activity[]; artifacts: string[]; pendingQuestion?: PendingQuestion; pendingRsiReview?: PendingRsiReview; error?: string;
};
export type RepositoryOption = { project: string; path: string; resolvedPath: string; exists: boolean };
export type HookOutput = { hookSpecificOutput: { hookEventName: "PreToolUse"; permissionDecision: "allow"; updatedInput: Record<string, unknown> } };
export type ClientMessage =
  | { type: "run.start"; cwd: string; issueUrl: string; instruction?: string }
  | { type: "terminal.input"; data: string }
  | { type: "terminal.resize"; cols: number; rows: number }
  | { type: "run.stop" }
  | { type: "run.reset" }
  | { type: "demo.start" }
  | { type: "feedback.submit"; body: string }
  | { type: "question.answer"; answers: Record<string, string> }
  | { type: "rsi.approve"; worktreeName: string }
  | { type: "rsi.reject"; worktreeName: string };
