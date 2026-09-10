import { describe, expect, it } from "@jest/globals";
import { activeAgents, elapsedLabel, isDemoRun, isTranscriptStalled, isWriting, sessionAlive } from "../../lib/run-state";
import { terminalExitStatus } from "../../server/domain";

describe("run state selectors", () => {
  it("should keep only running agents in their original order", () => {
    const agents = [
      { id: "developer", status: "completed" },
      { id: "reviewer", status: "running" },
      { id: "qa", status: "failed" },
      { id: "designer", status: "running" },
    ];
    expect(activeAgents(agents)).toEqual([
      { id: "reviewer", status: "running" },
      { id: "designer", status: "running" },
    ]);
  });

  it("should return an empty list when no agent is active", () => {
    expect(activeAgents([{ id: "developer", status: "completed" }])).toEqual([]);
  });

  it("should recognise a demonstration run from its identifier", () => {
    expect(isDemoRun("demo-2026-09-06T08-32-38-000Z")).toBe(true);
    expect(isDemoRun("2026-09-06T08-32-38-000Z-a1b2c3d4")).toBe(false);
    expect(isDemoRun(undefined)).toBe(false);
    expect(isDemoRun(null)).toBe(false);
  });

  it("should measure an unfinished step against the current time", () => {
    const start = "2026-09-07T10:00:00.000Z";
    expect(elapsedLabel(start, undefined, Date.parse("2026-09-07T10:00:31.000Z"))).toBe("31 s");
    expect(elapsedLabel(start, undefined, Date.parse("2026-09-07T10:02:05.000Z"))).toBe("2 min 05 s");
    expect(elapsedLabel(start, "2026-09-07T10:00:12.000Z", Date.parse("2026-09-07T11:00:00.000Z"))).toBe("12 s");
  });

  it("should announce a message on the way only while the session is alive and talking", () => {
    const now = Date.parse("2026-09-08T13:52:30.000Z");
    expect(isWriting(true, now - 400, now)).toBe(true);
    // The session went quiet: what it wrote has landed, or it is waiting.
    expect(isWriting(true, now - 4_000, now)).toBe(false);
    // The workflow finished and the engine process is gone: nothing left to write.
    expect(isWriting(false, now - 400, now)).toBe(false);
    // No output has ever arrived on this page.
    expect(isWriting(true, 0, now)).toBe(false);
  });

  it("should keep the conversation usable while the engine session outlives the workflow", () => {
    // A workflow phase in progress is always a live session, session flag or not.
    expect(sessionAlive("running", false)).toBe(true);
    expect(sessionAlive("attention", undefined)).toBe(true);
    // The workflow finished, but the engine process is still up at its prompt.
    expect(sessionAlive("completed", true)).toBe(true);
    // The workflow finished and the engine process has actually exited.
    expect(sessionAlive("completed", false)).toBe(false);
    expect(sessionAlive("completed", undefined)).toBe(false);
    expect(sessionAlive("idle", undefined)).toBe(false);
  });

  it("should flag an empty conversation as stalled once the run has produced other hook-driven progress", () => {
    // Nothing has happened yet: an empty conversation is the ordinary start of a run.
    expect(isTranscriptStalled(0, 0, 0, 0)).toBe(false);
    // A phase advance, an agent, or an artifact can only exist once a hook fired.
    expect(isTranscriptStalled(0, 3, 0, 0)).toBe(true);
    expect(isTranscriptStalled(0, 0, 1, 0)).toBe(true);
    expect(isTranscriptStalled(0, 0, 0, 2)).toBe(true);
    // Once at least one message has been read, the follower is known to work.
    expect(isTranscriptStalled(1, 5, 2, 3)).toBe(false);
  });

  it("should mark an intentional terminal stop as stopped, never as completed or failed", () => {
    expect(terminalExitStatus(1, true)).toBe("stopped");
    expect(terminalExitStatus(0, true)).toBe("stopped");
    expect(terminalExitStatus(0, false)).toBe("completed");
    expect(terminalExitStatus(1, false)).toBe("failed");
  });
});
