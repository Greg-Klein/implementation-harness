import { actionLabel, agentStopTarget, branchFromCommand, createsBranch, createsMergeRequest, mergeRequestUrl, normalizeAnswers, phaseForAgent, runInProgress } from "./domain.js";
import { ctx, activity, now, publishState } from "./context.js";
import { scheduleAutonomousReview } from "./self-improvement.js";
import { engine } from "./engine/index.js";
import type { EngineEvent } from "./engine/index.js";

function advancePhase(phase: number) {
  ctx.state.phase = Math.max(ctx.state.phase, phase);
}

/** The agent resumed on its own, so the call for attention no longer holds. */
function resumeFromAttention() {
  if (ctx.state.status === "attention" && !ctx.state.pendingQuestion) ctx.state.status = "running";
}

function rememberBranch(command: string | undefined) {
  const branch = branchFromCommand(command);
  if (!branch || ctx.state.branch === branch) return;
  ctx.state.branch = branch;
  activity("system", "Branche de travail", branch);
}

/** The merge request is the deliverable of the run, and its address exists nowhere but in the output of the command that opened it. */
function rememberMergeRequest(toolResponse: unknown) {
  if (ctx.state.mergeRequestUrl) return;
  const url = mergeRequestUrl(toolResponse);
  if (!url) return;
  ctx.state.mergeRequestUrl = url;
  advancePhase(9);
  activity("system", "Merge request ouverte", url);
}

/**
 * Parks the agent until the user answers in the interface. The promise is what
 * keeps it waiting, and resolving it is what lets it go: whichever engine is
 * driving, it must be able to wait on this.
 */
function waitForQuestionAnswer(event: Extract<EngineEvent, { kind: "question" }>) {
  if (ctx.resolvePendingQuestion) return undefined;
  ctx.pendingQuestionInput = event.input;
  ctx.state.pendingQuestion = { id: event.id ?? crypto.randomUUID(), questions: event.questions };
  ctx.state.status = "attention";
  ctx.state.action = undefined;
  activity("attention", event.questions.length > 1 ? `${event.questions.length} décisions attendent ta réponse` : "Une décision attend ta réponse");

  return new Promise<unknown>((resolve) => {
    ctx.resolvePendingQuestion = resolve;
    publishState();
  });
}

export function answerQuestion(answers: Record<string, string>, continueDemoRun: () => void) {
  if (!ctx.state.pendingQuestion) throw new Error("Aucune question n'attend de réponse.");
  const normalizedAnswers = normalizeAnswers(ctx.state.pendingQuestion.questions, answers);
  if (!normalizedAnswers) throw new Error("Réponds à chaque question avant de continuer.");
  if (!ctx.pendingQuestionInput || !ctx.resolvePendingQuestion) {
    if (!ctx.state.id?.startsWith("demo-")) throw new Error(`Le pont de réponse avec ${engine.label} n'est plus actif.`);
    ctx.state.pendingQuestion = undefined;
    ctx.state.status = "running";
    activity("system", "Réponses reçues", Object.values(normalizedAnswers).join(" · "));
    publishState();
    continueDemoRun();
    return;
  }

  const resolve = ctx.resolvePendingQuestion;
  const output = engine.questionAnswer(ctx.pendingQuestionInput, normalizedAnswers);
  ctx.resolvePendingQuestion = null;
  ctx.pendingQuestionInput = null;
  ctx.state.pendingQuestion = undefined;
  ctx.state.status = "running";
  activity("system", `Réponse transmise à ${engine.label}`);
  publishState();
  resolve(output);
}

export function clearPendingQuestion() {
  ctx.resolvePendingQuestion?.();
  ctx.resolvePendingQuestion = null;
  ctx.pendingQuestionInput = null;
  ctx.state.pendingQuestion = undefined;
}

function apply(event: EngineEvent) {
  if (event.kind === "agent.start") {
    ctx.state.agents = [{ id: event.agentId, name: event.agentName, status: "running", startedAt: now() }, ...ctx.state.agents.filter((agent) => agent.id !== event.agentId)];
    activity("agent", `${event.agentName} démarre`);
    advancePhase(phaseForAgent(event.agentName));
    resumeFromAttention();
    return undefined;
  }
  if (event.kind === "agent.stop") {
    const stopped = agentStopTarget(ctx.state.agents, event.agentId, event.agentName);
    // The session is alive either way, but an unattributable stop must not
    // announce an agent finishing that the feed never saw start.
    if (stopped) {
      ctx.state.agents = ctx.state.agents.map((agent) => agent.id === stopped.id ? { ...agent, status: "completed", endedAt: now() } : agent);
      activity("agent", `${stopped.name} termine`);
    }
    resumeFromAttention();
    return undefined;
  }
  // A tool call is not a milestone: two hundred of them in a run bury the dozen
  // events that tell what the workflow did. The terminal panel keeps the detail;
  // what the feed takes from a tool call is the branch it creates. The call does
  // say what the agent is doing at this instant, and that goes to the live
  // indicator, which holds one line and forgets it.
  if (event.kind === "tool.start") {
    ctx.state.action = actionLabel(event.tool, event.command, event.target);
    if (createsBranch(event.command)) {
      advancePhase(3);
      rememberBranch(event.command);
    }
    resumeFromAttention();
    return undefined;
  }
  if (event.kind === "tool.end") {
    if (createsMergeRequest(event.command)) rememberMergeRequest(event.response);
    resumeFromAttention();
    return undefined;
  }
  if (event.kind === "attention") {
    ctx.state.status = "attention";
    activity("attention", `${engine.label} attend ton attention`, event.message);
    return undefined;
  }
  // The turn ends every time the agent hands back, including while it waits for
  // a background agent: the workflow is only over when nothing is still running.
  ctx.state.action = undefined;
  if (ctx.state.agents.some((agent) => agent.status === "running")) {
    ctx.state.status = "running";
    activity("agent", "Tour terminé, un agent continue en tâche de fond");
    return undefined;
  }
  if (ctx.state.phase >= 9) ctx.state.phase = 10;
  ctx.state.status = ctx.state.phase >= 10 ? "completed" : "attention";
  // The workflow, not the session, decides when the run ended: the session then
  // sits idle at its prompt and may be killed much later.
  if (ctx.state.status === "completed") ctx.state.endedAt = now();
  activity("attention", ctx.state.phase >= 10 ? "Workflow terminé" : `${engine.label} attend une réponse`);
  if (ctx.state.phase >= 10 && ctx.state.id) scheduleAutonomousReview(ctx.state.id);
  return undefined;
}

export function processHook(body: Record<string, unknown>) {
  if (!ctx.state.id || body.runId !== ctx.state.id) return;
  // A finished run keeps receiving events while the session sits idle at its
  // prompt, and an idle notification must not put it back in progress.
  if (!runInProgress(ctx.state.status)) return;
  const event = engine.event((body.payload ?? {}) as Record<string, unknown>);
  if (!event) return;
  // A question publishes its own state from inside the promise it hands back,
  // and that promise is what keeps the agent waiting.
  if (event.kind === "question") return waitForQuestionAnswer(event);
  apply(event);
  publishState();
}
