import { describe, expect, it } from "@jest/globals";
import { documentTitle, faviconColor, runAlert } from "../../lib/notifications";
import type { RunState } from "../../lib/types";

function state(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "run-1", status: "running", phase: 5, cwd: "/tmp/repo", issueUrl: "", instruction: "",
    startedAt: "2026-09-07T10:00:00.000Z", endedAt: null, agents: [], activities: [], messages: [], artifacts: [],
    ...overrides,
  };
}

const question = { id: "q1", questions: [{ question: "Quelle base ?", header: "Branche", options: [], multiSelect: false }] };

describe("run notifications", () => {
  it("should call back when a decision starts waiting", () => {
    expect(runAlert(state(), state({ status: "attention", pendingQuestion: question }))).toEqual({
      tag: "question-q1",
      title: "Claude attend une réponse",
      body: "Le workflow attend ta décision pour continuer.",
    });
  });

  it("should call back when the session waits without a structured question", () => {
    expect(runAlert(state(), state({ status: "attention" }))?.title).toBe("Claude Code attend ton attention");
  });

  it("should call back when the run ends, and name the merge request when there is one", () => {
    expect(runAlert(state(), state({ status: "completed" }))?.body).toBe("Le run est allé au bout.");
    expect(runAlert(state(), state({ status: "completed", mergeRequestUrl: "https://gitlab.com/acme/-/merge_requests/1" }))?.body)
      .toBe("https://gitlab.com/acme/-/merge_requests/1");
    expect(runAlert(state(), state({ status: "failed", error: "Code 2" }))?.title).toBe("Le run a échoué");
  });

  it("should stay silent on anything that is not a transition", () => {
    expect(runAlert(null, state({ status: "attention", pendingQuestion: question }))).toBeUndefined();
    expect(runAlert(state({ status: "attention", pendingQuestion: question }), state({ status: "attention", pendingQuestion: question }))).toBeUndefined();
    expect(runAlert(state({ status: "attention" }), state({ status: "attention" }))).toBeUndefined();
    expect(runAlert(state(), state())).toBeUndefined();
  });

  it("should stay silent when the state belongs to another run", () => {
    expect(runAlert(state({ id: "run-0" }), state({ id: "run-1", status: "completed" }))).toBeUndefined();
    expect(runAlert(state(), state({ id: null, status: "completed" }))).toBeUndefined();
  });

  it("should say in the tab what the window would show", () => {
    expect(documentTitle(state({ status: "attention", pendingQuestion: question }))).toBe("● Claude attend une réponse · Implementation Harness");
    expect(documentTitle(state({ status: "attention" }))).toBe("● Attention requise · Implementation Harness");
    expect(documentTitle(state({ status: "completed" }))).toBe("✓ Terminé · Implementation Harness");
    expect(documentTitle(state({ status: "failed" }))).toBe("✗ Échec · Implementation Harness");
    expect(documentTitle(state())).toBe("Run en cours · Implementation Harness");
    expect(documentTitle(state({ status: "idle" }))).toBe("Implementation Harness");
  });

  it("should mark a waiting run apart from a healthy one", () => {
    expect(faviconColor(state({ status: "attention" }))).toBe("#d97706");
    expect(faviconColor(state({ status: "failed" }))).toBe("#b91c1c");
    expect(faviconColor(state({ status: "idle" }))).toBe("#1c211f");
  });
});
