import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn as spawnChild } from "node:child_process";
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import next from "next";
import * as pty from "node-pty";
import chokidar, { type FSWatcher } from "chokidar";
import { WebSocketServer, WebSocket } from "ws";
import { gitLabProjectPath, imageMimeType, normalizeAnswers, normalizeQuestion, parseRepositoryMappings, phaseForArtifact, positiveDuration, resolveArtifactPath, terminalExitStatus, type Question } from "./domain";

type RunStatus = "idle" | "starting" | "running" | "attention" | "completed" | "failed";
type AgentStatus = "running" | "completed" | "failed";
type AgentState = { id: string; name: string; status: AgentStatus; startedAt: string; endedAt?: string };
type Activity = { id: string; at: string; kind: "system" | "agent" | "tool" | "artifact" | "attention"; title: string; detail?: string };
type PendingQuestion = { id: string; questions: Question[] };
type RunState = { id: string | null; status: RunStatus; phase: number; cwd: string; issueUrl: string; instruction: string; startedAt: string | null; endedAt: string | null; agents: AgentState[]; activities: Activity[]; artifacts: string[]; pendingQuestion?: PendingQuestion; error?: string };
type RepositoryOption = { project: string; path: string; resolvedPath: string; exists: boolean };
type HookOutput = { hookSpecificOutput: { hookEventName: "PreToolUse"; permissionDecision: "allow"; updatedInput: Record<string, unknown> } };
type ClientMessage =
  | { type: "run.start"; cwd: string; issueUrl: string; instruction?: string }
  | { type: "terminal.input"; data: string }
  | { type: "terminal.resize"; cols: number; rows: number }
  | { type: "run.stop" }
  | { type: "run.reset" }
  | { type: "demo.start" }
  | { type: "feedback.submit"; body: string }
  | { type: "question.answer"; answers: Record<string, string> };

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.resolve(harnessRoot, "..");
try { process.loadEnvFile(path.join(pluginRoot, ".env")); } catch { /* Local mappings are optional. */ }
const dataRoot = path.join(harnessRoot, "data", "runs");
const feedbackRoot = path.join(harnessRoot, "data", "feedback", "pending");
const port = Number(process.env.PORT ?? 3210);
const hostname = process.env.X_IMPLEMENT_HOST ?? "127.0.0.1";
const dev = process.env.NODE_ENV !== "production";
let terminal: pty.IPty | null = null;
let artifactWatcher: FSWatcher | null = null;
let terminalBuffer = "";
let state: RunState = emptyState();
let pendingQuestionInput: Record<string, unknown> | null = null;
let resolvePendingQuestion: ((output?: HookOutput) => void) | null = null;
const demoTimers = new Set<ReturnType<typeof setTimeout>>();
const scheduledSelfAudits = new Set<string>();
const intentionallyStoppedRuns = new Set<string>();
const app = next({ dev, hostname, port, dir: harnessRoot });
const handle = app.getRequestHandler();
const sockets = new Set<WebSocket>();
const demoStepDuration = positiveDuration(process.env.X_IMPLEMENT_DEMO_STEP_MS, 5_000);
const demoArtifactContents: Record<string, string> = {
  "ticket-context.md": `# IH-42 · Préférences de notification

## Objectif
Permettre à chaque utilisateur de choisir les notifications reçues tout en conservant les alertes critiques.

## Critères d’acceptation
- Les préférences sont enregistrées par utilisateur.
- Les alertes critiques restent actives.
- Le réglage est pris en compte sans rechargement de la page.`,
  "implementation-plan.md": `# Plan d’implémentation

1. Ajouter le modèle de préférences.
2. Créer le panneau de réglages.
3. Connecter l’enregistrement optimiste.
4. Ajouter les tests du fallback critique.
5. Vérifier l’accessibilité et les états d’erreur.`,
  "developer-report.md": `# Rapport d’implémentation

- Modèle de préférences ajouté.
- Formulaire connecté au serveur.
- Mise à jour optimiste avec restauration en cas d’échec.
- Tests unitaires ajoutés.

Statut : prêt pour review.`,
  "test-report.json": `{
  "status": "passed",
  "tests": 11,
  "passed": 11,
  "failed": 0
}`,
  "senior-review-round-1.md": `# Review 1/2 · Changements demandés

## Retours
1. Le fallback des alertes critiques ignore le fuseau horaire de l’utilisateur.
2. Aucun test ne couvre ce cas de régression.

Décision : corrections requises avant approbation.`,
  "test-report-round-2.json": `{
  "status": "passed",
  "tests": 12,
  "passed": 12,
  "failed": 0,
  "regressionTest": "critical-alert-timezone"
}`,
  "senior-review-round-2.md": `# Review 2/2 · Approuvée

Les deux retours du premier passage sont résolus :

- le fallback utilise désormais le fuseau horaire de l’utilisateur ;
- un test de régression couvre ce comportement.

Décision : approuvé.`,
  "qa-report.json": `{
  "status": "passed",
  "accessibility": "passed",
  "typecheck": "passed",
  "unitTests": "12/12"
}`,
  "mr-description.md": `# IH-42 · Ajouter les préférences de notification

## Changements
- Ajout du panneau de préférences.
- Enregistrement optimiste des réglages.
- Conservation des alertes critiques.
- Prise en compte des retours de review sur le fuseau horaire.

## Validation
- 12 tests passent.
- Review senior approuvée au second passage.
- QA validée.`,
};

function emptyState(): RunState {
  return { id: null, status: "idle", phase: 0, cwd: "", issueUrl: "", instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], artifacts: [] };
}
function now() { return new Date().toISOString(); }
function activity(kind: Activity["kind"], title: string, detail?: string) {
  state.activities = [{ id: crypto.randomUUID(), at: now(), kind, title, detail }, ...state.activities].slice(0, 80);
}
function broadcast(message: object) {
  const serialized = JSON.stringify(message);
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(serialized);
}
async function persistState() {
  if (!state.id || state.id.startsWith("demo-")) return;
  const runDir = path.join(dataRoot, state.id);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "run.json"), JSON.stringify(state, null, 2));
}
function publishState() { broadcast({ type: "state", state }); void persistState(); }
function scheduleDemo(delay: number, callback: () => void) {
  const timer = setTimeout(() => { demoTimers.delete(timer); callback(); }, delay);
  demoTimers.add(timer);
}
function clearDemoTimers() {
  for (const timer of demoTimers) clearTimeout(timer);
  demoTimers.clear();
}
function demoTerminal(message: string) {
  const line = `\r\n\x1b[38;5;108m●\x1b[0m ${message}\r\n`;
  terminalBuffer = (terminalBuffer + line).slice(-600_000);
  broadcast({ type: "terminal.output", data: line });
}
async function readArtifact(artifactPath: string) {
  if (!state.id || !state.artifacts.includes(artifactPath)) throw new Error("Document introuvable pour ce run.");
  if (state.id.startsWith("demo-")) {
    const content = demoArtifactContents[artifactPath];
    if (content === undefined) throw new Error("Document de démonstration introuvable.");
    return { path: artifactPath, kind: "text", content };
  }

  const root = path.resolve(dataRoot, state.id, "artifacts");
  const target = resolveArtifactPath(root, artifactPath);
  if (!target) throw new Error("Chemin de document invalide.");
  const buffer = await readFile(target);
  if (buffer.byteLength > 2_000_000) throw new Error("Ce document dépasse la limite de prévisualisation de 2 Mo.");
  const imageType = imageMimeType(target);
  if (imageType) return { path: artifactPath, kind: "image", content: `data:${imageType};base64,${buffer.toString("base64")}` };
  return { path: artifactPath, kind: "text", content: buffer.toString("utf8") };
}
function findExecutable(name: string) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
function expandHome(value: string) {
  return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}
function repositoryMappings(): Record<string, string> {
  return parseRepositoryMappings(process.env.X_IMPLEMENT_REPOSITORIES);
}
function configuredRepositories(): RepositoryOption[] {
  return Object.entries(repositoryMappings())
    .map(([project, repositoryPath]) => {
      const resolvedPath = path.resolve(expandHome(repositoryPath));
      return { project, path: repositoryPath, resolvedPath, exists: existsSync(resolvedPath) };
    })
    .sort((left, right) => left.project.localeCompare(right.project));
}
async function discoverProjectDirectory(project: string) {
  const roots = (process.env.X_IMPLEMENT_SEARCH_ROOTS ?? "~/workspace")
    .split(",")
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => path.resolve(expandHome(root)));
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, entry.name);
      try {
        const config = await readFile(path.join(candidate, ".git", "config"), "utf8");
        if (config.includes(project)) return candidate;
      } catch { /* This directory is not a regular Git checkout. */ }
    }
  }
  return undefined;
}
async function detectProjectDirectory(issueUrl: string) {
  const project = gitLabProjectPath(issueUrl);
  if (!project) return undefined;
  const mapped = repositoryMappings()[project];
  if (mapped) {
    const resolvedPath = path.resolve(expandHome(mapped));
    if (existsSync(resolvedPath)) return { project, path: mapped, resolvedPath, exists: true, source: "env" as const };
  }
  const discovered = await discoverProjectDirectory(project);
  if (discovered) return { project, path: discovered, resolvedPath: discovered, exists: true, source: "git" as const };
  return undefined;
}
async function resolveProjectDirectory(input: string, issueUrl: string) {
  if (input.trim()) {
    const explicit = path.resolve(expandHome(input.trim()));
    if (!existsSync(explicit)) throw new Error("Le répertoire du projet n’existe pas.");
    return explicit;
  }

  const project = gitLabProjectPath(issueUrl);
  if (!project) throw new Error("L’URL du ticket GitLab n’est pas reconnue.");
  const detected = await detectProjectDirectory(issueUrl);
  if (detected) return detected.resolvedPath;
  throw new Error(`Aucun checkout trouvé pour ${project}. Renseigne son chemin ou ajoute-le à X_IMPLEMENT_REPOSITORIES.`);
}
function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 180) : undefined;
}
function waitForQuestionAnswer(payload: Record<string, unknown>) {
  const toolInput = payload.tool_input as Record<string, unknown> | undefined;
  if (!toolInput || (toolInput.answers && typeof toolInput.answers === "object")) return undefined;
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions.flatMap((question) => {
    const normalized = normalizeQuestion(question);
    return normalized ? [normalized] : [];
  }) : [];
  if (questions.length === 0 || resolvePendingQuestion) return undefined;

  pendingQuestionInput = toolInput;
  state.pendingQuestion = {
    id: normalizeText(payload.tool_use_id) ?? crypto.randomUUID(),
    questions,
  };
  state.status = "attention";
  activity("attention", questions.length > 1 ? `${questions.length} décisions attendent ta réponse` : "Une décision attend ta réponse");

  return new Promise<HookOutput | undefined>((resolve) => {
    resolvePendingQuestion = resolve;
    publishState();
  });
}
function answerQuestion(answers: Record<string, string>) {
  if (!state.pendingQuestion) throw new Error("Aucune question n’attend de réponse.");
  const normalizedAnswers = normalizeAnswers(state.pendingQuestion.questions, answers);
  if (!normalizedAnswers) throw new Error("Réponds à chaque question avant de continuer.");
  if (!pendingQuestionInput || !resolvePendingQuestion) {
    if (!state.id?.startsWith("demo-")) throw new Error("Le pont de réponse avec Claude Code n’est plus actif.");
    state.pendingQuestion = undefined;
    state.status = "running";
    activity("system", "Réponses reçues", Object.values(normalizedAnswers).join(" · "));
    publishState();
    demoTerminal("Réponses reçues. Le workflow simulé reprend.");
    continueDemoRun();
    return;
  }

  const resolve = resolvePendingQuestion;
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...pendingQuestionInput, answers: normalizedAnswers },
    },
  };
  resolvePendingQuestion = null;
  pendingQuestionInput = null;
  state.pendingQuestion = undefined;
  state.status = "running";
  activity("system", "Réponse transmise à Claude Code");
  publishState();
  resolve(output);
}
async function archiveArtifact(source: string) {
  if (!state.id) return;
  const taskRoot = path.join(state.cwd, ".claude", "tasks");
  const relative = path.relative(taskRoot, source);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return;
  const target = path.join(dataRoot, state.id, "artifacts", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  if (!state.artifacts.includes(relative)) {
    state.artifacts = [...state.artifacts, relative];
    activity("artifact", "Nouvel artefact", relative);
  }
  state.phase = Math.max(state.phase, phaseForArtifact(relative));
  publishState();
}
async function startArtifactWatcher(cwd: string) {
  await artifactWatcher?.close();
  const taskRoot = path.join(cwd, ".claude", "tasks");
  artifactWatcher = chokidar.watch(taskRoot, { ignoreInitial: false, awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 80 } });
  artifactWatcher.on("add", (file) => void archiveArtifact(file));
  artifactWatcher.on("change", (file) => void archiveArtifact(file));
}
async function startRun(message: Extract<ClientMessage, { type: "run.start" }>) {
  if (terminal) throw new Error("Une session Claude Code est déjà active.");
  clearDemoTimers();
  const cwd = await resolveProjectDirectory(message.cwd, message.issueUrl);
  const claude = findExecutable("claude");
  if (!claude) throw new Error("Claude Code est introuvable dans PATH.");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  state = { ...emptyState(), id, status: "starting", cwd, issueUrl: message.issueUrl.trim(), instruction: message.instruction?.trim() ?? "", startedAt: now() };
  terminalBuffer = "";
  activity("system", "Session créée", path.basename(cwd));
  publishState();
  await startArtifactWatcher(cwd);
  const command = `/x-implement:x-implement ${state.issueUrl}${state.instruction ? ` ${state.instruction}` : ""}`;
  const runTerminal = pty.spawn(claude, ["--plugin-dir", pluginRoot, "--name", `x-implement ${path.basename(cwd)}`, command], {
    name: "xterm-256color", cols: 120, rows: 34, cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", X_IMPLEMENT_RUN_ID: id, X_IMPLEMENT_HARNESS_HOOK_URL: `http://${hostname}:${port}/api/hooks` },
  });
  terminal = runTerminal;
  state.status = "running";
  activity("system", "Claude Code démarré", command);
  publishState();
  runTerminal.onData((data) => {
    terminalBuffer = (terminalBuffer + data).slice(-600_000);
    broadcast({ type: "terminal.output", data });
    if (state.id) void appendFile(path.join(dataRoot, state.id, "terminal.log"), data).catch(() => undefined);
  });
  runTerminal.onExit(({ exitCode }) => {
    const intentionallyStopped = intentionallyStoppedRuns.delete(id);
    if (state.id !== id) return;
    if (terminal === runTerminal) terminal = null;
    state.status = terminalExitStatus(exitCode, intentionallyStopped);
    resolvePendingQuestion?.();
    resolvePendingQuestion = null;
    pendingQuestionInput = null;
    state.pendingQuestion = undefined;
    state.endedAt = now();
    if (state.status === "failed") state.error = `Claude Code s’est arrêté avec le code ${exitCode}.`;
    activity("system", intentionallyStopped ? "Session arrêtée par l’utilisateur" : exitCode === 0 ? "Session terminée" : "Session interrompue", `Code ${exitCode}`);
    publishState();
    scheduleAutonomousReview(id);
  });
}
function startDemoRun() {
  if (terminal || state.status === "running" || state.status === "starting" || state.status === "attention") throw new Error("Une session est déjà active.");
  clearDemoTimers();
  terminalBuffer = "";
  const id = `demo-${crypto.randomUUID().slice(0, 8)}`;
  state = {
    ...emptyState(), id, status: "running", phase: 1,
    cwd: "~/workspace/acme-dashboard", issueUrl: "ticket-simule://IH-42",
    instruction: "Mode démonstration — aucun dépôt ne sera modifié.", startedAt: now(),
  };
  activity("system", "Ticket simulé chargé", "IH-42 · Ajouter les préférences de notification");
  publishState();
  demoTerminal("Lecture du ticket GitLab simulé…");
  scheduleDemo(demoStepDuration, () => {
    state.artifacts = ["ticket-context.md"];
    activity("artifact", "Contexte du ticket consolidé", "ticket-context.md");
    publishState();
    demoTerminal("Critères d’acceptation et cas limites extraits.");
  });
  scheduleDemo(demoStepDuration * 2, () => {
    state.phase = 2;
    state.status = "attention";
    state.pendingQuestion = {
      id: `demo-question-${id}`,
      questions: [
        {
          header: "Branche de base",
          question: "Sur quelle branche faut-il construire cette implémentation ?",
          options: [
            { label: "develop", description: "Suit le flux d’intégration existant." },
            { label: "main", description: "Part directement de la branche stable." },
          ],
          multiSelect: false,
        },
        {
          header: "Notifications",
          question: "Quel comportement faut-il appliquer quand les notifications sont désactivées ?",
          options: [
            { label: "Tout masquer", description: "Aucune notification n’est présentée." },
            { label: "Garder les alertes critiques", description: "Les alertes de sécurité restent visibles." },
          ],
          multiSelect: false,
        },
      ],
    };
    activity("attention", "Deux décisions attendent ta réponse");
    publishState();
    demoTerminal("Claude attend tes décisions dans le panneau de droite.");
  });
}
function continueDemoRun() {
  scheduleDemo(0, () => {
    state.phase = 3;
    activity("system", "Branche de démonstration préparée", "feat/ih-42-notification-preferences");
    publishState();
    demoTerminal("Branche et plan de travail préparés.");
  });
  scheduleDemo(demoStepDuration, () => {
    state.phase = 4;
    state.artifacts = [...state.artifacts, "implementation-plan.md"];
    activity("artifact", "Plan d’implémentation validé", "implementation-plan.md");
    publishState();
    demoTerminal("Plan découpé en composants, tests et migration de données.");
  });
  scheduleDemo(demoStepDuration * 2, () => {
    state.phase = 5;
    state.agents = [{ id: "demo-developer", name: "developer", status: "running", startedAt: now() }];
    activity("agent", "developer démarre");
    publishState();
    demoTerminal("Délégation de l’implémentation à l’agent developer…");
  });
  scheduleDemo(demoStepDuration * 3, () => {
    state.phase = 6;
    state.agents = [
      ...state.agents.map((agent) => ({ ...agent, status: "completed" as const, endedAt: now() })),
      { id: "demo-reviewer", name: "senior-reviewer", status: "running", startedAt: now() },
    ];
    state.artifacts = [...state.artifacts, "developer-report.md", "test-report.json"];
    activity("agent", "Implémentation terminée, vérifications en cours");
    publishState();
    demoTerminal("Tests unitaires et contrôle TypeScript terminés. Passage en review…");
  });
  scheduleDemo(demoStepDuration * 4, () => {
    state.phase = 7;
    state.agents = state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "failed", endedAt: now() } : agent);
    state.artifacts = [...state.artifacts, "senior-review-round-1.md"];
    activity("attention", "Review : corrections demandées", "Le fallback critique ignore le fuseau horaire · un test de régression manque");
    publishState();
    demoTerminal("Review 1/2 : changements demandés sur le fallback et sa couverture de test.");
  });
  scheduleDemo(demoStepDuration * 5, () => {
    state.phase = 5;
    state.agents = state.agents.map((agent) => agent.id === "demo-developer" ? { ...agent, status: "running", startedAt: now(), endedAt: undefined } : agent);
    activity("agent", "developer reprend l’implémentation", "Application des deux retours de review");
    publishState();
    demoTerminal("Boucle vers l’implémentation : correction du fallback et ajout du test manquant…");
  });
  scheduleDemo(demoStepDuration * 6, () => {
    state.phase = 6;
    state.agents = state.agents.map((agent) => {
      if (agent.id === "demo-developer") return { ...agent, status: "completed", endedAt: now() };
      if (agent.id === "demo-reviewer") return { ...agent, status: "running", startedAt: now(), endedAt: undefined };
      return agent;
    });
    state.artifacts = [...state.artifacts, "test-report-round-2.json"];
    activity("agent", "Corrections vérifiées", "12 tests passent, dont le nouveau test de régression");
    publishState();
    demoTerminal("Corrections terminées. Les 12 tests passent, nouvelle review demandée.");
  });
  scheduleDemo(demoStepDuration * 7, () => {
    state.phase = 7;
    state.agents = state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "completed", endedAt: now() } : agent);
    state.artifacts = [...state.artifacts, "senior-review-round-2.md", "qa-report.json"];
    activity("agent", "Review 2/2 approuvée", "Les retours du premier passage sont résolus");
    publishState();
    demoTerminal("Review 2/2 : approuvée. Les retours ont bien été pris en compte.");
  });
  scheduleDemo(demoStepDuration * 8, () => {
    state.phase = 8;
    state.artifacts = [...state.artifacts, "mr-description.md"];
    activity("artifact", "Merge request préparée", "mr-description.md");
    publishState();
    demoTerminal("Description et checklist de merge request générées.");
  });
  scheduleDemo(demoStepDuration * 9, () => {
    state.phase = 9;
    activity("system", "Rapport de review publié", "Review 2/2 · approuvée");
    publishState();
    demoTerminal("Rapport final publié dans la merge request simulée.");
  });
  scheduleDemo(demoStepDuration * 10, () => {
    state.phase = 10;
    state.status = "completed";
    state.endedAt = now();
    activity("system", "Démonstration terminée", "Aucun dépôt ni ticket n’a été modifié.");
    publishState();
    demoTerminal("Merge request simulée prête. Fin de la démonstration.");
  });
}
function stopRun() {
  if (state.id?.startsWith("demo-")) {
    clearDemoTimers();
    state.pendingQuestion = undefined;
    state.status = "completed";
    state.endedAt = now();
    activity("system", "Démonstration arrêtée");
    publishState();
    return;
  }
  if (!terminal) return;
  const runId = state.id;
  resolvePendingQuestion?.();
  resolvePendingQuestion = null;
  pendingQuestionInput = null;
  state.pendingQuestion = undefined;
  if (runId) intentionallyStoppedRuns.add(runId);
  terminal.kill(); terminal = null;
}
async function saveFeedback(body: string) {
  const feedback = body.trim();
  if (!state.id) throw new Error("Aucune exécution à laquelle rattacher ce retour.");
  if (state.id.startsWith("demo-")) throw new Error("La démonstration n’enregistre pas de retour RSI.");
  if (!feedback) throw new Error("Le retour est vide.");
  if (feedback.length > 5_000) throw new Error("Le retour dépasse 5 000 caractères.");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  await mkdir(feedbackRoot, { recursive: true });
  await writeFile(path.join(feedbackRoot, `${id}.json`), JSON.stringify({
    id, runId: state.id, createdAt: now(), status: "pending", feedback,
    issueUrl: state.issueUrl, projectDirectory: state.cwd,
  }, null, 2));
  activity("artifact", "Retour ajouté à la boucle RSI", `${id}.json`);
  publishState();
}
async function queueAutonomousReview(runId: string, snapshot: RunState) {
  if (scheduledSelfAudits.has(runId)) return;
  scheduledSelfAudits.add(runId);
  const id = `self-audit-${runId}`;
  try {
    await mkdir(feedbackRoot, { recursive: true });
    await writeFile(path.join(feedbackRoot, `${id}.json`), JSON.stringify({
      id, runId, createdAt: now(), status: "pending", source: "autonomous",
      objective: "Find durable improvements from observable friction, failures, repeated review findings and missing verification in this run.",
      signals: {
        finalStatus: snapshot.status,
        finalPhase: snapshot.phase,
        elapsedMs: snapshot.startedAt ? Date.now() - new Date(snapshot.startedAt).getTime() : null,
        agents: snapshot.agents.map((agent) => ({ name: agent.name, status: agent.status })),
        artifacts: snapshot.artifacts,
        attentionEvents: snapshot.activities.filter((item) => item.kind === "attention").map((item) => item.title),
        error: snapshot.error,
      },
    }, null, 2));
  } catch (error) {
    scheduledSelfAudits.delete(runId);
    throw error;
  }
  if (state.id === runId) {
    activity("artifact", "Auto-audit RSI mis en file", `${id}.json`);
    publishState();
  }
}
function startAutonomousImprovement(runId: string) {
  if (process.env.X_IMPLEMENT_RSI_AUTORUN !== "true") return;
  const claude = findExecutable("claude");
  if (!claude) return;
  const worktreeName = `rsi-${runId.slice(-8)}`;
  const feedbackDirectory = path.join(harnessRoot, "data", "feedback");
  const child = spawnChild(claude, [
    "--background", "--worktree", worktreeName,
    "--add-dir", pluginRoot,
    "--plugin-dir", pluginRoot,
    "--permission-mode", "auto",
    "--name", `x-implement RSI ${runId.slice(-8)}`,
    `/x-implement:x-improve ${feedbackDirectory}`,
  ], {
    cwd: pluginRoot,
    env: { ...process.env, X_IMPLEMENT_RSI_PRIMARY_CHECKOUT: pluginRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let launchError: Error | undefined;
  child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4_000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4_000); });
  child.on("error", (error) => { launchError = error; });
  child.on("close", (code) => {
    if (state.id === runId) {
      const launched = code === 0 && !launchError;
      activity(launched ? "agent" : "attention", launched ? "Auto-amélioration RSI lancée" : "Auto-amélioration RSI non démarrée", normalizeText(launchError?.message ?? output));
      publishState();
    }
  });
}
function scheduleAutonomousReview(runId: string) {
  const snapshot = structuredClone(state);
  void queueAutonomousReview(runId, snapshot)
    .then(() => startAutonomousImprovement(runId))
    .catch((error) => {
      if (state.id !== runId) return;
      activity("attention", "Auto-audit RSI impossible", normalizeText(error instanceof Error ? error.message : error));
      publishState();
    });
}
function processHook(body: Record<string, unknown>) {
  if (!state.id || body.runId !== state.id) return;
  const payload = (body.payload ?? {}) as Record<string, unknown>;
  const event = normalizeText(payload.hook_event_name) ?? "Hook";
  const agentName = normalizeText(payload.agent_type) ?? "agent";
  const agentId = normalizeText(payload.agent_id) ?? `${agentName}-${Date.now()}`;
  if (event === "SubagentStart") {
    state.agents = [{ id: agentId, name: agentName, status: "running", startedAt: now() }, ...state.agents.filter((agent) => agent.id !== agentId)];
    activity("agent", `${agentName} démarre`);
  } else if (event === "SubagentStop") {
    state.agents = state.agents.map((agent) => agent.id === agentId || (agent.name === agentName && agent.status === "running") ? { ...agent, status: "completed", endedAt: now() } : agent);
    activity("agent", `${agentName} termine`);
  } else if (event === "PreToolUse") {
    const tool = normalizeText(payload.tool_name) ?? "outil";
    if (tool === "AskUserQuestion") return waitForQuestionAnswer(payload);
    const toolInput = payload.tool_input as Record<string, unknown> | undefined;
    activity("tool", tool, normalizeText(toolInput?.description) ?? normalizeText(toolInput?.command));
  } else if (event === "Notification") {
    state.status = "attention"; activity("attention", "Claude Code attend ton attention", normalizeText(payload.message));
  } else if (event === "Stop") {
    if (state.phase >= 8) state.phase = 10;
    state.status = state.phase >= 10 ? "completed" : "attention";
    activity("attention", state.phase >= 10 ? "Workflow terminé" : "Claude Code attend une réponse");
    if (state.phase >= 10 && state.id) {
      scheduleAutonomousReview(state.id);
    }
  }
  publishState();
}
async function readBody(request: IncomingMessage) {
  let body = ""; for await (const chunk of request) body += chunk;
  return JSON.parse(body || "{}") as Record<string, unknown>;
}
function respond(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body));
}

await mkdir(dataRoot, { recursive: true });
await app.prepare();
const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/hooks") {
    try {
      const hookOutput = await processHook(await readBody(request));
      respond(response, 200, { ok: true, hookOutput: hookOutput ?? null });
    }
    catch { respond(response, 400, { ok: false }); }
    return;
  }
  if (request.method === "GET" && request.url === "/api/state") { respond(response, 200, { state }); return; }
  if (request.method === "GET" && request.url?.startsWith("/api/artifacts")) {
    const requestUrl = new URL(request.url, `http://${hostname}:${port}`);
    try { respond(response, 200, await readArtifact(requestUrl.searchParams.get("path") ?? "")); }
    catch (error) { respond(response, 404, { error: error instanceof Error ? error.message : "Document introuvable." }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/repositories")) {
    const requestUrl = new URL(request.url, `http://${hostname}:${port}`);
    const issueUrl = requestUrl.searchParams.get("issueUrl") ?? "";
    try {
      const detected = issueUrl ? await detectProjectDirectory(issueUrl) : undefined;
      respond(response, 200, { repositories: configuredRepositories(), detected: detected ?? null });
    } catch (error) {
      respond(response, 500, { repositories: configuredRepositories(), detected: null, error: error instanceof Error ? error.message : "Discovery failed." });
    }
    return;
  }
  await handle(request, response);
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") return;
  wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
});
wss.on("connection", (socket) => {
  sockets.add(socket); socket.send(JSON.stringify({ type: "state", state }));
  if (terminalBuffer) socket.send(JSON.stringify({ type: "terminal.output", data: terminalBuffer }));
  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientMessage;
      if (message.type === "run.start") await startRun(message);
      if (message.type === "terminal.input") terminal?.write(message.data);
      if (message.type === "terminal.resize") terminal?.resize(message.cols, message.rows);
      if (message.type === "run.stop") stopRun();
      if (message.type === "run.reset" && !terminal) { clearDemoTimers(); state = emptyState(); terminalBuffer = ""; publishState(); }
      if (message.type === "demo.start") startDemoRun();
      if (message.type === "feedback.submit") await saveFeedback(message.body);
      if (message.type === "question.answer") answerQuestion(message.answers);
    } catch (error) {
      state.status = "failed"; state.error = error instanceof Error ? error.message : "Impossible d’exécuter cette action.";
      activity("system", "Erreur", state.error); publishState();
    }
  });
  socket.on("close", () => sockets.delete(socket));
});
server.listen(port, hostname, () => console.log(`X-Implement Harness: http://${hostname}:${port}`));
async function shutdown() { clearDemoTimers(); terminal?.kill(); await artifactWatcher?.close(); server.close(); }
process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
