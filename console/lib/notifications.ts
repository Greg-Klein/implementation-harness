import { pendingAnswerLabel, runInProgress } from "./run-state";
import type { RunState } from "./types";

/** Two cues, the distinction the workflow has always made: something is expected of you, or the run is over. */
export type AlertCue = "attention" | "done";
export type RunAlert = { tag: string; title: string; body: string; cue: AlertCue };

const NAME = "Implementation Harness";

/**
 * A run lasts long enough to be left alone, so the harness has to call the user
 * back. Only transitions raise an alert: a reconnection replays the current
 * state, and replaying it must not ring a second time.
 */
export function runAlert(previous: RunState | null, next: RunState): RunAlert | undefined {
  if (!previous || !next.id || previous.id !== next.id) return undefined;
  const questions = next.pendingQuestion?.questions.length ?? 0;
  if (questions > 0 && !previous.pendingQuestion)
    return { tag: `question-${next.pendingQuestion?.id}`, title: pendingAnswerLabel(questions), body: "Le workflow attend ta décision pour continuer.", cue: "attention" };
  if (questions === 0 && next.status === "attention" && previous.status !== "attention")
    return { tag: `attention-${next.id}`, title: "Claude Code attend ton attention", body: "Le run est en pause tant que tu n'as pas repris la main.", cue: "attention" };
  if (next.status === "completed" && runInProgress(previous.status))
    return { tag: `completed-${next.id}`, title: "Workflow terminé", body: next.mergeRequestUrl ?? "Le run est allé au bout.", cue: "done" };
  // A failed run is over too, and what happens next is the user's call either
  // way: the workflow has always used the same cue for both.
  if (next.status === "failed" && runInProgress(previous.status))
    return { tag: `failed-${next.id}`, title: "Le run a échoué", body: next.error ?? "La session s'est interrompue.", cue: "done" };
  return undefined;
}

/** The tab is the only thing left of the harness once the window is behind another one. */
export function documentTitle(run: RunState) {
  const questions = run.pendingQuestion?.questions.length ?? 0;
  if (questions > 0) return `● ${pendingAnswerLabel(questions)} · ${NAME}`;
  if (run.status === "attention") return `● Attention requise · ${NAME}`;
  if (run.status === "failed") return `✗ Échec · ${NAME}`;
  if (run.status === "completed") return `✓ Terminé · ${NAME}`;
  if (runInProgress(run.status)) return `Run en cours · ${NAME}`;
  return NAME;
}

export function faviconColor(run: RunState) {
  if (run.status === "attention") return "#d97706";
  if (run.status === "failed") return "#b91c1c";
  if (run.status === "completed") return "#477a62";
  if (runInProgress(run.status)) return "#477a62";
  return "#1c211f";
}

export function faviconDataUri(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
