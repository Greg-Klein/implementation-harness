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

/**
 * A user-initiated stop is neither a crash nor a workflow that ran to its end:
 * calling it "completed" told the user the run had gone all the way (a merge
 * request, a published review) when they themselves had just cut it off,
 * sometimes before a single agent had started.
 */
export function terminalExitStatus(exitCode: number, intentionallyStopped: boolean) {
  if (intentionallyStopped) return "stopped" as const;
  return exitCode === 0 ? "completed" as const : "failed" as const;
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

const IMPROVEMENT_WORKTREE_PREFIX = "self-improvement-";

export function improvementWorktreeName(runId: string) {
  return `${IMPROVEMENT_WORKTREE_PREFIX}${runId.slice(-8)}`;
}

/** Whether a worktree path is one the improvement loop created, whichever run named it. */
export function isImprovementWorktree(worktreePath: string) {
  return path.basename(worktreePath).startsWith(IMPROVEMENT_WORKTREE_PREFIX);
}

/**
 * The improvement worktree already in flight, out of every worktree registered
 * against the harness. One undecided branch at a time is the whole point: the
 * loop opened eleven in a day on 7 September, four of them conflicting with each
 * other, and each rotted as the harness branch moved on. A branch nobody has
 * ruled on is also the branch the next iteration would be diagnosed against, so
 * the loop waits for a verdict instead of stacking.
 */
export function improvementWorktreeInFlight(worktreePaths: string[]) {
  return worktreePaths.find(isImprovementWorktree);
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

/**
 * The agents a finished run leaves behind. A stop event can never arrive for an
 * agent whose session is gone, so one that was still running keeps reading as
 * running for good: the console spins a live timer on a run that ended hours
 * ago, and the next self-audit is handed a "running" agent to diagnose. Its real
 * outcome is unknowable at that point, and calling it completed or failed both
 * invent one, so it is abandoned.
 */
export function closeAbandonedAgents(agents: AgentState[], endedAt: string) {
  const abandoned = agents.filter((agent) => agent.status === "running");
  if (abandoned.length === 0) return { agents, abandoned };
  return { agents: agents.map((agent) => agent.status === "running" ? { ...agent, status: "abandoned" as const, endedAt } : agent), abandoned };
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

/**
 * What a shell command is busy doing. Ordered, first match wins, so a rule
 * always comes before the family it belongs to: `glab mr create` opens the
 * merge request before it is merely a call to GitLab.
 */
const SHELL_ACTIONS: [RegExp, string][] = [
  [/\b(?:glab|gh)\b[^;&|]*\b(?:mr|pr)\s+create\b/, "Ouverture de la merge request"],
  [/\b(?:glab|gh)\b[^;&|]*\b(?:mr|pr)\b/, "Consultation de la merge request"],
  [/\bglab\b[^;&|]*\b(?:issue|work-item)\b/, "Lecture du ticket GitLab"],
  [/\bglab\b/, "Consultation de GitLab"],
  [/\bgh\b/, "Consultation de GitHub"],
  [/\bgit\b[^;&|]*\b(?:checkout\s+-b|switch\s+(?:-c|--create))\b/, "Création de la branche"],
  [/\bgit\b[^;&|]*\bcommit\b/, "Commit des modifications"],
  [/\bgit\b[^;&|]*\bpush\b/, "Publication de la branche"],
  [/\bgit\b/, "Inspection du dépôt"],
  [/\b(?:jest|vitest|pytest|playwright|test:unit|test:integration)\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b/, "Exécution des tests"],
  [/\btsc\b|\btypecheck\b/, "Vérification des types"],
  [/\b(?:eslint|biome|ruff|lint)\b/, "Analyse statique du code"],
  [/\b(?:build|make|cargo)\b/, "Build du projet"],
  [/\b(?:npm|pnpm|yarn)\s+(?:ci|install|add)\b/, "Installation des dépendances"],
  [/\b(?:grep|rg|ack)\b/, "Recherche dans le code"],
  [/\b(?:cat|head|tail|less|sed|awk)\b/, "Lecture des fichiers"],
  [/\b(?:ls|find|tree)\b/, "Exploration du dépôt"],
];

function named(prefix: string, target: string | undefined, fallback: string) {
  return target ? `${prefix} ${path.basename(target)}` : fallback;
}

const TOOL_ACTIONS: Record<string, (target?: string) => string> = {
  Read: (target) => named("Lecture de", target, "Lecture d'un fichier"),
  Edit: (target) => named("Modification de", target, "Modification d'un fichier"),
  NotebookEdit: (target) => named("Modification de", target, "Modification d'un notebook"),
  Write: (target) => named("Écriture de", target, "Écriture d'un fichier"),
  Grep: (target) => target ? `Recherche de « ${target} »` : "Recherche dans le code",
  Glob: () => "Parcours des fichiers",
  Task: (target) => target ? `Délégation à ${target}` : "Délégation à un agent",
  Agent: (target) => target ? `Délégation à ${target}` : "Délégation à un agent",
  Skill: (target) => target ? `Compétence ${target}` : "Chargement d'une compétence",
  TodoWrite: () => "Mise à jour du plan",
  WebSearch: () => "Recherche sur le web",
  WebFetch: (target) => {
    const host = target && URL.canParse(target) ? new URL(target).host : undefined;
    return host ? `Consultation de ${host}` : "Consultation du web";
  },
};

function externalToolAction(tool: string) {
  if (tool.startsWith("mcp__playwright__")) return "Pilotage du navigateur";
  if (/figma/i.test(tool)) return "Consultation de Figma";
  return tool.startsWith("mcp__") ? "Appel d'un outil externe" : undefined;
}

/**
 * What the interface says the agent is doing right now, read from the tool it
 * just called. A tool call is not a milestone and has no place in the activity
 * feed, but between two paragraphs of the dialogue it is the only thing that
 * says a silent session is working rather than stuck.
 */
export function actionLabel(tool: string, command?: string, target?: string) {
  if (tool === "Bash") return SHELL_ACTIONS.find(([pattern]) => pattern.test(command ?? ""))?.[1] ?? "Commande shell";
  return TOOL_ACTIONS[tool]?.(target) ?? externalToolAction(tool);
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
  if (name.startsWith("developer-report") || name.startsWith("dev-evidence")) return 5;
  if (name.startsWith("senior-review") || name.startsWith("designer-review") || name.startsWith("qa-report") || name.startsWith("qa-evidence") || name.startsWith("design-evidence")) return 6;
  if (name === "review-summary.md") return 7;
  if (name === "mr-description.md") return 8;
  if (name === "mr-review-comment.md") return 9;
  return 0;
}
