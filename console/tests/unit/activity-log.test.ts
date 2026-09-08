import { describe, expect, it } from "@jest/globals";
import { activity, archivedState, ctx, emptyState } from "../../server/context";

function startRun(id: string) {
  ctx.state = { ...emptyState(), id, status: "running", startedAt: new Date().toISOString() };
}

describe("activity log", () => {
  it("should archive the whole run while the broadcast feed stays a window", () => {
    startRun("2026-09-07T09-47-32-752Z-60bc30d4");
    for (let index = 0; index < 250; index += 1) activity("tool", `Bash ${index}`);
    expect(ctx.state.activities).toHaveLength(80);
    expect(archivedState().activities).toHaveLength(250);
    // Newest first, so the last entry is the oldest the run ever emitted.
    expect(archivedState().activities.at(-1)?.title).toBe("Bash 0");
    expect(ctx.state.activities.at(-1)?.title).toBe("Bash 170");
  });

  it("should bound the archive, since a run rewrites it in full on every event", () => {
    startRun("run-bounded");
    for (let index = 0; index < 1_200; index += 1) activity("tool", `Bash ${index}`);
    expect(archivedState().activities).toHaveLength(1_000);
    expect(archivedState().activities.at(-1)?.title).toBe("Bash 200");
  });

  it("should not carry the history of a previous run into the next one", () => {
    startRun("run-before");
    activity("system", "Session créée");
    activity("agent", "developer");
    startRun("run-after");
    activity("system", "Session créée");
    expect(archivedState().activities).toEqual([expect.objectContaining({ title: "Session créée" })]);
  });

  it("should leave the archive of another run out of the current state", () => {
    startRun("run-owner");
    activity("system", "Session créée");
    ctx.state = { ...emptyState(), id: "run-without-archive" };
    expect(archivedState().activities).toEqual([]);
  });
});
