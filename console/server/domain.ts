import path from "node:path";
import type { AgentState, RunState, RunStatus } from "./types.js";

export type QuestionOption = { label: string; description?: string };
export type Question = { question: string; header: string; options: QuestionOption[]; multiSelect: boolean };

/**
 * One line of readable text out of anything an agent reports, short enough for
 * the activity feed. A blank field carries no more information than a missing
 * one, so it comes back undefined and callers can fall back on it with `??`.
 */
export function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\s+/g, " ").trim().slice(0, 180) || undefined;
}

export function normalizeQuestion(value: unknown): Question | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.question !== "string" || !input.question.trim()) return undefined;
  const options = Array.isArray(input.options) ? input.options.flatMap((option) => {
    if (!option || typeof option !== "object") return [];
    const candidate = option as Record<string, unknown>;
    if (typeof candidate.label !== "string" || !candidate.label.trim()) return [];
    return [{ label: candidate.label.trim(), description: typeof candidate.description === "string" ? candidate.description.trim() : undefined }];
  }) : [];
  return {
    question: input.question.trim(),
    header: typeof input.header === "string" && input.header.trim() ? input.header.trim() : "Question",
    options,
    multiSelect: input.multiSelect === true,
  };
}

export function resolveArtifactPath(rootDirectory: string, artifactPath: string) {
  const root = path.resolve(rootDirectory);
  const target = path.resolve(root, artifactPath);
  return target.startsWith(`${root}${path.sep}`) ? target : undefined;
}

export function normalizeAnswers(questions: Question[], answers: Record<string, string>) {
  const normalized = Object.fromEntries(questions.map(({ question }) => [question, answers[question]?.trim() ?? ""]));
  return Object.values(normalized).every(Boolean) ? normalized : undefined;
}

const DOCUMENT_EXTENSIONS = new Set([".md", ".json", ".txt"]);

/**
 * An artifact of the run is a document the workflow wrote to be read. The
 * screenshots and the downloaded design assets are the agents' working
 * material: they live in the repository, where the agents write them and read
 * them back, and listing them alongside the reports only buries the reports.
 */
export function isRunDocument(relativePath: string) {
  return DOCUMENT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

export function positiveDuration(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function terminalExitStatus(exitCode: number, intentionallyStopped: boolean) {
  return intentionallyStopped || exitCode === 0 ? "completed" as const : "failed" as const;
}

/**
 * The autonomous loop only has something to learn from a run that left a trace:
 * a delegated agent, a produced document, or an unexpected exit. A session
 * stopped before any of that happened would otherwise spend a full improvement
 * cycle on empty signals.
 */
export function hasAuditableEvidence(snapshot: Pick<RunState, "status" | "agents" | "artifacts">) {
  return snapshot.status === "failed" || snapshot.agents.length > 0 || snapshot.artifacts.length > 0;
}

// The console is itself a Next server, and Next writes its bundler choice and
// NODE_ENV into the environment. Handing those down to an agent that runs a
// build makes it abort on conflicting bundler flags, whatever the code checked.
export function withoutBundlerVariables<T extends Record<string, string | undefined>>(environment: T) {
  const cleaned = { ...environment };
  for (const key of Object.keys(cleaned)) {
    if (key.startsWith("__NEXT_") || key === "TURBOPACK" || key === "NODE_ENV" || key === "NEXT_DEPLOYMENT_ID") delete cleaned[key];
  }
  return cleaned;
}

export function gitLabProjectPath(issueUrl: string) {
  try {
    const url = new URL(issueUrl);
    return url.pathname.match(/^\/(.+?)\/-\/(?:issues|work_items)\/\d+/)?.[1];
  } catch {
    return undefined;
  }
}

/** The agent a stop event closes: by id, or by name for one that reported no id. */
export function agentStopTarget(agents: AgentState[], agentId: string, agentName: string) {
  return agents.find((agent) => agent.id === agentId)
    ?? agents.find((agent) => agent.name === agentName && agent.status === "running");
}

export function runInProgress(status: RunStatus) {
  return status === "starting" || status === "running" || status === "attention";
}

export function phaseForAgent(agentName: string) {
  const name = agentName.slice(agentName.lastIndexOf(":") + 1);
  if (name === "ticket-planner") return 4;
  if (name === "developer") return 5;
  if (name.endsWith("-reviewer") || name === "review-orchestrator") return 6;
  return 0;
}

export function createsBranch(command: string | undefined) {
  return command !== undefined && /\bgit\b[^;&|]*?\b(?:checkout\s+-b|switch\s+(?:-c|--create))\b/.test(command);
}

const BRANCH_NAME = /\bgit\b[^;&|]*?\b(?:checkout\s+-b|switch\s+(?:-c|--create))\s+(?:--\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/;

/** The branch the workflow works on, read from the command that creates it. */
export function branchFromCommand(command: string | undefined) {
  const name = command?.match(BRANCH_NAME)?.[1];
  return name ? name.replace(/^["']|["']$/g, "") : undefined;
}

export function createsMergeRequest(command: string | undefined) {
  return command !== undefined && /\b(?:glab|gh)\b[^;&|]*?\b(?:mr|pr)\s+create\b/.test(command);
}

const MERGE_REQUEST_URL = /https?:\/\/[^\s"'<>()\\]*?\/(?:-\/merge_requests|merge_requests|pull)\/\d+/;

/**
 * The created merge request only ever names itself in the output of the command
 * that opened it, and that output reaches the harness as a PostToolUse response
 * whose shape depends on the tool.
 */
export function mergeRequestUrl(toolResponse: unknown) {
  if (toolResponse === undefined || toolResponse === null) return undefined;
  const text = typeof toolResponse === "string" ? toolResponse : JSON.stringify(toolResponse);
  return text?.match(MERGE_REQUEST_URL)?.[0];
}

export function gitRemoteProjects(config: string): string[] {
  const projects = new Set<string>();
  for (const match of config.matchAll(/^\s*url\s*=\s*(.+)$/gm)) {
    const url = match[1].trim().replace(/\.git$/, "");
    const scp = url.match(/^[^/]+@[^:/]+:(.+)$/)?.[1];
    const project = scp ?? url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i)?.[1];
    if (project) projects.add(project.replace(/^\/+/, ""));
  }
  return [...projects];
}

/** A previous run leaves its documents in the project, and only this run's own count. */
export function belongsToRun(writtenAt: number, startedAt: string | null) {
  return startedAt !== null && writtenAt >= new Date(startedAt).getTime();
}

export function phaseForArtifact(relativePath: string) {
  const name = path.basename(relativePath);
  if (name === "ticket-context.md") return 1;
  if (name === "open-questions.md") return 2;
  if (name === "planner-output.json") return 4;
  if (name.startsWith("developer-report")) return 5;
  if (name.startsWith("senior-review") || name.startsWith("designer-review") || name.startsWith("qa-report")) return 6;
  if (name === "review-summary.md") return 7;
  if (name === "mr-description.md") return 8;
  if (name === "mr-review-comment.md") return 9;
  return 0;
}
