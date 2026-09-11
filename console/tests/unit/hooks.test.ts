import { beforeEach, describe, expect, it } from "@jest/globals";

import { ctx, emptyState } from "../../server/context";
import { processHook } from "../../server/hooks";

// A demonstration identifier keeps the completion out of the self-improvement loop.
const hook = (payload: Record<string, unknown>) => processHook({ runId: "demo-hooks", payload });

beforeEach(() => {
  ctx.state = { ...emptyState(), id: "demo-hooks", status: "running", phase: 1 };
});

describe("workflow signals from Claude Code hooks", () => {
  it("should follow the phase of the agent that starts working", () => {
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:ticket-planner", agent_id: "a1" });
    expect(ctx.state.phase).toBe(4);
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer", agent_id: "a2" });
    expect(ctx.state.phase).toBe(5);
    hook({ hook_event_name: "SubagentStart", agent_type: "Explore", agent_id: "a3" });
    expect(ctx.state.phase).toBe(5);
  });

  it("should light up the branch step when the branch is created", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git switch -c fix-258" } });
    expect(ctx.state.phase).toBe(3);
  });

  it("should keep tool calls out of the feed, and still read the branch from them", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
    expect(ctx.state.activities).toEqual([]);
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git switch -c fix-258" } });
    expect(ctx.state.activities).toEqual([expect.objectContaining({ title: "Branche de travail", detail: "fix-258" })]);
  });

  it("should stay quiet when the session goes idle while a background agent works", () => {
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer", agent_id: "a1" });
    hook({ hook_event_name: "Stop" });
    const announced = ctx.state.activities.length;
    hook({ hook_event_name: "Notification", message: "Claude is waiting for your input" });
    expect(ctx.state.status).toBe("running");
    expect(ctx.state.activities).toHaveLength(announced);
  });

  it("should drop the call for attention as soon as Claude Code resumes", () => {
    hook({ hook_event_name: "Notification", message: "Claude needs your permission" });
    expect(ctx.state.status).toBe("attention");
    hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "a.ts" } });
    expect(ctx.state.status).toBe("running");
  });

  it("should keep the run alive while a background agent works", () => {
    ctx.state.phase = 9;
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:senior-reviewer", agent_id: "a1" });
    hook({ hook_event_name: "Stop" });
    expect(ctx.state.status).toBe("running");
    expect(ctx.state.phase).toBe(9);

    hook({ hook_event_name: "SubagentStop", agent_type: "implementation-harness:senior-reviewer", agent_id: "a1" });
    hook({ hook_event_name: "Stop" });
    expect(ctx.state).toMatchObject({ status: "completed", phase: 10 });
  });

  it("should say what the agent is doing, and forget it as soon as the turn ends", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "glab issue view 258" } });
    expect(ctx.state.action).toBe("Lecture du ticket GitLab");
    hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/repo/console/server/domain.ts" } });
    expect(ctx.state.action).toBe("Lecture de domain.ts");
    // The action is an instant, never a milestone: the feed keeps none of it.
    expect(ctx.state.activities).toEqual([]);
    hook({ hook_event_name: "Stop" });
    expect(ctx.state.action).toBeUndefined();
  });

  it("should stop claiming an action while it waits for the user to decide", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm run test:unit" } });
    expect(ctx.state.action).toBe("Exécution des tests");
    hook({
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q1",
      tool_input: { questions: [{ question: "Quelle base ?", header: "Branche", options: [{ label: "develop" }] }] },
    });
    expect(ctx.state.status).toBe("attention");
    expect(ctx.state.action).toBeUndefined();
  });

  it("should ignore an agent event that names no agent", () => {
    hook({ hook_event_name: "SubagentStart", agent_type: "  ", agent_id: "a1" });
    expect(ctx.state.agents).toEqual([]);
    expect(ctx.state.activities).toEqual([]);
  });

  it("should not announce a stop it cannot attribute to a running agent", () => {
    hook({ hook_event_name: "SubagentStop", agent_type: "implementation-harness:developer", agent_id: "a1" });
    expect(ctx.state.agents).toEqual([]);
    expect(ctx.state.activities).toEqual([]);
  });

  it("should close an agent that reported no id, by its name", () => {
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer" });
    hook({ hook_event_name: "SubagentStop", agent_type: "implementation-harness:developer" });
    expect(ctx.state.agents).toHaveLength(1);
    expect(ctx.state.agents[0]).toMatchObject({ name: "implementation-harness:developer", status: "completed" });
  });

  it("should date the end of the run from the workflow, not from the session", () => {
    ctx.state.phase = 9;
    expect(ctx.state.endedAt).toBeNull();
    hook({ hook_event_name: "Stop" });
    expect(ctx.state).toMatchObject({ status: "completed", phase: 10 });
    // The session then sits idle at its prompt and may be killed much later.
    expect(ctx.state.endedAt).not.toBeNull();
  });

  it("should not date the end of a run that is only waiting for an answer", () => {
    ctx.state.phase = 5;
    hook({ hook_event_name: "Stop" });
    expect(ctx.state).toMatchObject({ status: "attention", endedAt: null });
  });

  it("should leave a finished run alone when the idle session keeps notifying", () => {
    ctx.state = { ...ctx.state, status: "completed", phase: 10 };
    hook({ hook_event_name: "Notification", message: "Claude is waiting for your input" });
    expect(ctx.state.status).toBe("completed");
    hook({ hook_event_name: "Stop" });
    expect(ctx.state.status).toBe("completed");
  });

  it("should ignore hooks from another run", () => {
    processHook({ runId: "demo-other", payload: { hook_event_name: "Notification" } });
    expect(ctx.state.status).toBe("running");
  });
});
