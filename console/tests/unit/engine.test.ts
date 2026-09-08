import { describe, expect, it } from "@jest/globals";
import { claudeCode } from "../../server/engine/claude-code";
import { engine } from "../../server/engine/index";

describe("engine contract", () => {
  it("should expose claude-code as the active engine", () => {
    expect(engine.id).toBe("claude-code");
    expect(engine.label).toBe("Claude Code");
  });

  it("should build the workflow command with and without an instruction", () => {
    expect(claudeCode.command("https://gitlab.com/acme/app/-/issues/258", ""))
      .toBe("/implementation-harness:implement https://gitlab.com/acme/app/-/issues/258");
    expect(claudeCode.command("https://gitlab.com/acme/app/-/issues/258", "reste sur desktop"))
      .toBe("/implementation-harness:implement https://gitlab.com/acme/app/-/issues/258 reste sur desktop");
  });

  it("should keep the documents of a run inside the project", () => {
    expect(claudeCode.taskDirectory("/tmp/repo")).toBe("/tmp/repo/.claude/tasks");
  });

  it("should name the transcript from an event payload", () => {
    expect(claudeCode.transcriptPath({ runId: "r1", payload: { transcript_path: "/tmp/session.jsonl" } })).toBe("/tmp/session.jsonl");
    expect(claudeCode.transcriptPath({ runId: "r1", payload: {} })).toBeUndefined();
    expect(claudeCode.transcriptPath({ runId: "r1" })).toBeUndefined();
  });
});

describe("engine event translation", () => {
  it("should turn subagent hooks into agent events", () => {
    expect(claudeCode.event({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer", agent_id: "a1" }))
      .toEqual({ kind: "agent.start", agentId: "a1", agentName: "implementation-harness:developer" });
    expect(claudeCode.event({ hook_event_name: "SubagentStop", agent_type: "implementation-harness:developer", agent_id: "a1" }))
      .toEqual({ kind: "agent.stop", agentId: "a1", agentName: "implementation-harness:developer" });
  });

  it("should pass the command whole while shortening what is displayed", () => {
    const command = `git commit -m "${"x".repeat(400)}"`;
    const event = claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
    expect(event).toMatchObject({ kind: "tool.start", tool: "Bash" });
    // The activity feed gets a short label, the matchers get the real command.
    expect(event && "command" in event && event.command).toBe(command);
  });

  it("should prefer the description of a tool call over its command", () => {
    expect(claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test", description: "Lance les tests" } }))
      .toMatchObject({ label: "Lance les tests" });
  });

  it("should carry a tool response back for the merge request to be found in", () => {
    expect(claudeCode.event({ hook_event_name: "PostToolUse", tool_input: { command: "glab mr create" }, tool_response: { stdout: "ok" } }))
      .toEqual({ kind: "tool.end", command: "glab mr create", response: { stdout: "ok" } });
  });

  it("should turn a structured question into a question event", () => {
    const event = claudeCode.event({
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q1",
      tool_input: { questions: [{ question: "Quelle base ?", header: "Branche", options: [{ label: "develop" }] }] },
    });
    expect(event).toMatchObject({ kind: "question", id: "q1" });
    expect(event && "questions" in event && event.questions).toHaveLength(1);
  });

  it("should not raise the question again on the call the harness already answered", () => {
    expect(claudeCode.event({
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Quelle base ?", header: "Branche", options: [] }], answers: { "Quelle base ?": "develop" } },
    })).toBeUndefined();
  });

  it("should ignore an event the harness has no use for", () => {
    expect(claudeCode.event({ hook_event_name: "SessionStart" })).toBeUndefined();
    expect(claudeCode.event({})).toBeUndefined();
  });

  it("should hand the answers back in the shape Claude Code expects", () => {
    expect(claudeCode.questionAnswer({ questions: [] }, { "Quelle base ?": "develop" })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { questions: [], answers: { "Quelle base ?": "develop" } },
      },
    });
  });
});

describe("engine event translation of a malformed agent payload", () => {
  it("should refuse an agent event without an agent type", () => {
    expect(claudeCode.event({ hook_event_name: "SubagentStart", agent_id: "a1" })).toBeUndefined();
    expect(claudeCode.event({ hook_event_name: "SubagentStop", agent_type: "" })).toBeUndefined();
  });

  it("should key an agent that reported no id on its name", () => {
    expect(claudeCode.event({ hook_event_name: "SubagentStart", agent_type: "developer" }))
      .toMatchObject({ kind: "agent.start", agentName: "developer" });
  });
});
