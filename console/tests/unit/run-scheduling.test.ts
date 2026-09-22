import { describe, expect, it } from "@jest/globals";
import { concurrencyLimit, describeQueue, emptyState, exitReport, runHoldsRepository, sessionsToReleaseForQueue, summarizeRun } from "../../server/domain";
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

/** A run as the release decision reads it, finished and still holding its session unless said otherwise. */
function held(overrides: Partial<{ id: string; cwd: string; status: RunState["status"]; sessionActive: boolean; endedAt: string | null }> = {}) {
  return { id: "run-1", cwd: "/work/repo-a", status: "completed" as const, sessionActive: true, endedAt: "2026-09-18T11:00:00.000Z", ...overrides };
}

describe("the finished sessions the queue takes back", () => {
  it("should take none while nothing is waiting, however long the session has been idle", () => {
    expect(sessionsToReleaseForQueue([held()], [], 3)).toEqual([]);
  });

  it("should take the session of the finished run a launch is waiting on", () => {
    expect(sessionsToReleaseForQueue([held()], [queued()], 3)).toEqual(["run-1"]);
  });

  it("should leave a run that is still working, whoever is waiting for its checkout", () => {
    expect(sessionsToReleaseForQueue([held({ status: "running" })], [queued()], 3)).toEqual([]);
    expect(sessionsToReleaseForQueue([held({ status: "attention" })], [queued()], 3)).toEqual([]);
  });

  it("should leave a finished run whose session is already gone, since it holds nothing", () => {
    expect(sessionsToReleaseForQueue([held({ sessionActive: false })], [queued()], 3)).toEqual([]);
  });

  it("should take the oldest finished session when the queue is short of a slot rather than of that checkout", () => {
    const runs = [
      held({ id: "run-1", cwd: "/work/repo-a", endedAt: "2026-09-18T11:00:00.000Z" }),
      held({ id: "run-2", cwd: "/work/repo-b", endedAt: "2026-09-18T10:00:00.000Z" }),
    ];
    expect(sessionsToReleaseForQueue(runs, [queued({ cwd: "/work/repo-c" })], 2)).toEqual(["run-2"]);
  });

  it("should take every finished session a launch waits on, plus nothing else", () => {
    const runs = [
      held({ id: "run-1", cwd: "/work/repo-a" }),
      held({ id: "run-2", cwd: "/work/repo-b" }),
      held({ id: "run-3", cwd: "/work/repo-c" }),
    ];
    const queue = [queued({ id: "q1", cwd: "/work/repo-a" }), queued({ id: "q2", cwd: "/work/repo-c" })];
    expect(sessionsToReleaseForQueue(runs, queue, 3).sort()).toEqual(["run-1", "run-3"]);
  });

  it("should keep the room it already has when a working run is what fills it", () => {
    const runs = [held({ id: "run-1", cwd: "/work/repo-a", status: "running" })];
    expect(sessionsToReleaseForQueue(runs, [queued({ cwd: "/work/repo-b" })], 1)).toEqual([]);
  });
});

describe("what the feed says about a session that went away", () => {
  it("should name the queue when the console gave the place back", () => {
    expect(exitReport("queue", 143)).toBe("Place libérée pour la file d'attente");
  });

  it("should name the user when they stopped it themselves", () => {
    expect(exitReport("user", 143)).toBe("Session arrêtée par l'utilisateur");
  });

  it("should tell a clean end from an interrupted one when nobody asked for it", () => {
    expect(exitReport(null, 0)).toBe("Session terminée");
    expect(exitReport(null, 1)).toBe("Session interrompue");
  });
});
