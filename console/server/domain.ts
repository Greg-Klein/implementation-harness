import path from "node:path";

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
