import path from "node:path";
import type { ConversationMessage, RunStatus } from "./types.js";

export type QuestionOption = { label: string; description?: string };
export type Question = { question: string; header: string; options: QuestionOption[]; multiSelect: boolean };

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

export function imageMimeType(filePath: string) {
  const types: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
  return types[path.extname(filePath).toLowerCase()];
}

export function positiveDuration(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function terminalExitStatus(exitCode: number, intentionallyStopped: boolean) {
  return intentionallyStopped || exitCode === 0 ? "completed" as const : "failed" as const;
}

export function gitLabProjectPath(issueUrl: string) {
  try {
    const url = new URL(issueUrl);
    return url.pathname.match(/^\/(.+?)\/-\/(?:issues|work_items)\/\d+/)?.[1];
  } catch {
    return undefined;
  }
}

/** Slash commands, task notifications and hook output reach the session as tagged blocks. */
const TAGGED_INPUT = /^<[a-z][a-z-]*>/;

function textOf(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } => Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("\n\n");
}

export function parseConversationLine(line: string): ConversationMessage | undefined {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!entry || typeof entry !== "object") return undefined;
  // Sidechains are the subagents talking to themselves, meta entries are the
  // expanded prompt of a slash command: neither is the dialogue.
  if (entry.isSidechain === true || entry.isMeta === true) return undefined;
  const id = typeof entry.uuid === "string" ? entry.uuid : undefined;
  if (!id) return undefined;
  const at = typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString();
  // An instruction typed while Claude Code is mid-turn is recorded as a queued
  // command instead of a user message.
  if (entry.type === "attachment") {
    const attachment = entry.attachment as { type?: unknown; prompt?: unknown } | undefined;
    if (attachment?.type !== "queued_command" || typeof attachment.prompt !== "string") return undefined;
    const queued = attachment.prompt.trim();
    return queued ? { id, at, author: "user", text: queued } : undefined;
  }
  const author = entry.type === "assistant" ? "claude" as const : entry.type === "user" ? "user" as const : undefined;
  if (!author) return undefined;
  const message = entry.message as { content?: unknown } | undefined;
  const text = textOf(message?.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!text || (author === "user" && TAGGED_INPUT.test(text))) return undefined;
  return { id, at, author, text };
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
