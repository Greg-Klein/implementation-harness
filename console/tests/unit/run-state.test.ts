import { describe, expect, it } from "@jest/globals";
import { activeAgents, elapsedLabel, isDemoRun, isWriting } from "../../lib/run-state";
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

  it("should announce a message on the way only while the session is talking", () => {
    const now = Date.parse("2026-09-08T13:52:30.000Z");
    expect(isWriting("running", now - 400, now)).toBe(true);
    expect(isWriting("attention", now - 400, now)).toBe(true);
    // The session went quiet: what it wrote has landed, or it is waiting.
    expect(isWriting("running", now - 4_000, now)).toBe(false);
    expect(isWriting("completed", now - 400, now)).toBe(false);
    // No output has ever arrived on this page.
    expect(isWriting("running", 0, now)).toBe(false);
  });

  it("should keep an intentional terminal stop successful", () => {
    expect(terminalExitStatus(1, true)).toBe("completed");
    expect(terminalExitStatus(0, false)).toBe("completed");
    expect(terminalExitStatus(1, false)).toBe("failed");
  });
});
