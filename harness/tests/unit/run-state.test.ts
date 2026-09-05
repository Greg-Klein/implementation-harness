import { describe, expect, it } from "@jest/globals";
import { activeAgents } from "../../lib/run-state";
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

  it("should keep an intentional terminal stop successful", () => {
    expect(terminalExitStatus(1, true)).toBe("completed");
    expect(terminalExitStatus(0, false)).toBe("completed");
    expect(terminalExitStatus(1, false)).toBe("failed");
  });
});
