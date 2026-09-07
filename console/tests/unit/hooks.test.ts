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
