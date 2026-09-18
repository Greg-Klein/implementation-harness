import { describe, expect, it } from "@jest/globals";
import { concurrencyLimit, describeQueue, emptyState, runHoldsRepository, summarizeRun } from "../../server/domain";
import type { QueuedRun, RunState } from "../../server/types";

function state(overrides: Partial<RunState> = {}): RunState {
  return { ...emptyState(), id: "run-1", cwd: "/work/repo-a", issueUrl: "https://gitlab.com/acme/app/-/issues/258", ...overrides };
}

function queued(overrides: Partial<QueuedRun> = {}): QueuedRun {
  return { id: "q1", cwd: "/work/repo-a", issueUrl: "https://gitlab.com/acme/app/-/issues/266", instruction: "", queuedAt: "2026-09-18T10:00:00.000Z", ...overrides };
}

describe("how many runs the console may hold", () => {
  it("should take the configured ceiling when it is a usable count", () => {
    expect(concurrencyLimit("5", 3)).toBe(5);
    expect(concurrencyLimit("1", 3)).toBe(1);
  });

  it("should fall back on the default for anything that is not one", () => {
    expect(concurrencyLimit(undefined, 3)).toBe(3);
    expect(concurrencyLimit("", 3)).toBe(3);
    expect(concurrencyLimit("0", 3)).toBe(3);
    expect(concurrencyLimit("-2", 3)).toBe(3);
    expect(concurrencyLimit("2.5", 3)).toBe(3);
    expect(concurrencyLimit("beaucoup", 3)).toBe(3);
    // A ceiling nobody could watch is a mistake, not a preference.
    expect(concurrencyLimit("40", 3)).toBe(3);
  });
});

describe("the checkout a run holds", () => {
  it("should hold it for as long as the workflow is going", () => {
    expect(runHoldsRepository({ status: "starting", sessionActive: false })).toBe(true);
    expect(runHoldsRepository({ status: "running", sessionActive: true })).toBe(true);
    expect(runHoldsRepository({ status: "attention", sessionActive: true })).toBe(true);
  });

  /**
   * The workflow reaching its last phase does not free the working tree: the
   * session stays at its prompt, the user keeps talking to it and it keeps
   * writing to the same branch.
   */
  it("should keep holding it while the agent session is still up after the workflow", () => {
    expect(runHoldsRepository({ status: "completed", sessionActive: true })).toBe(true);
    expect(runHoldsRepository({ status: "failed", sessionActive: true })).toBe(true);
  });

  it("should release it once the session is gone", () => {
    expect(runHoldsRepository({ status: "completed", sessionActive: false })).toBe(false);
    expect(runHoldsRepository({ status: "stopped", sessionActive: false })).toBe(false);
    expect(runHoldsRepository({ status: "failed", sessionActive: false })).toBe(false);
  });
});

describe("what the side list is told about a run", () => {
  it("should carry what a row needs without carrying the run itself", () => {
    const summary = summarizeRun(state({
      status: "attention", phase: 6, branch: "feat/258", sessionActive: true,
      pendingQuestion: { id: "q9", questions: [
        { question: "Quelle base ?", header: "Branche", options: [], multiSelect: false },
        { question: "Et ensuite ?", header: "Suite", options: [], multiSelect: false },
      ] },
      agents: [
        { id: "a1", name: "developer", status: "running", startedAt: "2026-09-18T10:00:00.000Z" },
        { id: "a2", name: "Explore", status: "completed", startedAt: "2026-09-18T09:00:00.000Z" },
      ],
      messages: [{ id: "m1", at: "2026-09-18T10:01:00.000Z", author: "claude", text: "Plan prêt." }],
    }));
    expect(summary).toMatchObject({
      id: "run-1", status: "attention", phase: 6, branch: "feat/258",
      pendingQuestionId: "q9", pendingQuestionCount: 2, runningAgents: 1,
      lastMessageId: "m1", lastMessageAuthor: "claude", holdsRepository: true,
    });
    // The list is pushed to every page on every event of every run: it must not
    // grow with the length of a run.
    expect(summary).not.toHaveProperty("messages");
    expect(summary).not.toHaveProperty("activities");
    expect(summary).not.toHaveProperty("artifacts");
  });

  it("should report no pending decision when nothing is waiting", () => {
    expect(summarizeRun(state())).toMatchObject({ pendingQuestionCount: 0, pendingQuestionId: undefined });
  });
});

describe("why a queued launch is still waiting", () => {
  it("should name the run holding its checkout rather than the slot count", () => {
    const holders = new Map([["/work/repo-a", "run-1"]]);
    expect(describeQueue([queued()], holders)).toEqual([expect.objectContaining({ reason: "repository", blockedBy: "run-1" })]);
  });

  it("should fall back on the slot count when nothing holds its checkout", () => {
    const [described] = describeQueue([queued({ cwd: "/work/repo-b" })], new Map([["/work/repo-a", "run-1"]]));
    expect(described.reason).toBe("slot");
    expect(described.blockedBy).toBeUndefined();
  });

  it("should answer per entry, since two waiting launches rarely wait on the same thing", () => {
    const holders = new Map([["/work/repo-a", "run-1"]]);
    const described = describeQueue([queued({ id: "q1" }), queued({ id: "q2", cwd: "/work/repo-c" })], holders);
    expect(described.map((entry) => entry.reason)).toEqual(["repository", "slot"]);
  });

  it("should keep the order the launches were asked in", () => {
    const described = describeQueue([queued({ id: "q1" }), queued({ id: "q2" }), queued({ id: "q3" })], new Map());
    expect(described.map((entry) => entry.id)).toEqual(["q1", "q2", "q3"]);
  });
});
