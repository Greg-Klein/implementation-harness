import { normalizeAnswers, normalizeQuestion } from "./domain.js";
import { ctx, activity, now, publishState } from "./context.js";
import { scheduleAutonomousReview } from "./rsi.js";
import type { HookOutput } from "./types.js";

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 180) : undefined;
}

export function waitForQuestionAnswer(payload: Record<string, unknown>): Promise<HookOutput | undefined> | undefined {
  const toolInput = payload.tool_input as Record<string, unknown> | undefined;
  if (!toolInput || (toolInput.answers && typeof toolInput.answers === "object")) return undefined;
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions.flatMap((question) => {
    const normalized = normalizeQuestion(question);
    return normalized ? [normalized] : [];
  }) : [];
  if (questions.length === 0 || ctx.resolvePendingQuestion) return undefined;

  ctx.pendingQuestionInput = toolInput;
  ctx.state.pendingQuestion = {
    id: normalizeText(payload.tool_use_id) ?? crypto.randomUUID(),
    questions,
  };
  ctx.state.status = "attention";
  activity("attention", questions.length > 1 ? `${questions.length} décisions attendent ta réponse` : "Une décision attend ta réponse");

  return new Promise<HookOutput | undefined>((resolve) => {
    ctx.resolvePendingQuestion = resolve;
    publishState();
  });
}

export function answerQuestion(answers: Record<string, string>, continueDemoRun: () => void) {
  if (!ctx.state.pendingQuestion) throw new Error("Aucune question n'attend de réponse.");
  const normalizedAnswers = normalizeAnswers(ctx.state.pendingQuestion.questions, answers);
  if (!normalizedAnswers) throw new Error("Réponds à chaque question avant de continuer.");
  if (!ctx.pendingQuestionInput || !ctx.resolvePendingQuestion) {
    if (!ctx.state.id?.startsWith("demo-")) throw new Error("Le pont de réponse avec Claude Code n'est plus actif.");
    ctx.state.pendingQuestion = undefined;
    ctx.state.status = "running";
    activity("system", "Réponses reçues", Object.values(normalizedAnswers).join(" · "));
    publishState();
    continueDemoRun();
    return;
  }

  const resolve = ctx.resolvePendingQuestion;
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...ctx.pendingQuestionInput, answers: normalizedAnswers },
    },
  };
  ctx.resolvePendingQuestion = null;
  ctx.pendingQuestionInput = null;
  ctx.state.pendingQuestion = undefined;
  ctx.state.status = "running";
  activity("system", "Réponse transmise à Claude Code");
  publishState();
  resolve(output);
}

export function clearPendingQuestion() {
  ctx.resolvePendingQuestion?.();
  ctx.resolvePendingQuestion = null;
  ctx.pendingQuestionInput = null;
  ctx.state.pendingQuestion = undefined;
}

export function processHook(body: Record<string, unknown>) {
  if (!ctx.state.id || body.runId !== ctx.state.id) return;
  const payload = (body.payload ?? {}) as Record<string, unknown>;
  const event = normalizeText(payload.hook_event_name) ?? "Hook";
  const agentName = normalizeText(payload.agent_type) ?? "agent";
  const agentId = normalizeText(payload.agent_id) ?? `${agentName}-${Date.now()}`;
  if (event === "SubagentStart") {
    ctx.state.agents = [{ id: agentId, name: agentName, status: "running", startedAt: now() }, ...ctx.state.agents.filter((agent) => agent.id !== agentId)];
    activity("agent", `${agentName} démarre`);
  } else if (event === "SubagentStop") {
    ctx.state.agents = ctx.state.agents.map((agent) => agent.id === agentId || (agent.name === agentName && agent.status === "running") ? { ...agent, status: "completed", endedAt: now() } : agent);
    activity("agent", `${agentName} termine`);
  } else if (event === "PreToolUse") {
    const tool = normalizeText(payload.tool_name) ?? "outil";
    if (tool === "AskUserQuestion") return waitForQuestionAnswer(payload);
    const toolInput = payload.tool_input as Record<string, unknown> | undefined;
    activity("tool", tool, normalizeText(toolInput?.description) ?? normalizeText(toolInput?.command));
  } else if (event === "Notification") {
    ctx.state.status = "attention";
    activity("attention", "Claude Code attend ton attention", normalizeText(payload.message));
  } else if (event === "Stop") {
    if (ctx.state.phase >= 8) ctx.state.phase = 10;
    ctx.state.status = ctx.state.phase >= 10 ? "completed" : "attention";
    activity("attention", ctx.state.phase >= 10 ? "Workflow terminé" : "Claude Code attend une réponse");
    if (ctx.state.phase >= 10 && ctx.state.id) scheduleAutonomousReview(ctx.state.id);
  }
  publishState();
}
