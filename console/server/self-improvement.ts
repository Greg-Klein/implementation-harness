import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ctx, activity, now, publishState } from "./context.js";
import { feedbackRoot, consoleRoot } from "./config.js";
import { hasAuditableEvidence, normalizeText } from "./domain.js";
import { engine } from "./engine/index.js";
import { findWorktree, worktreeDiff } from "./worktree.js";
import type { RunState } from "./types.js";

const auditedRuns = new Set<string>();
const decidedImprovementReviews = new Set<string>();
const improvementWatchers = new Set<ReturnType<typeof setTimeout>>();
const WATCH_INTERVAL_MS = 15_000;
const WATCH_ATTEMPTS = 120;

export async function saveFeedback(body: string) {
  const feedback = body.trim();
  if (!ctx.state.id) throw new Error("Aucune exécution à laquelle rattacher ce retour.");
  if (ctx.state.id.startsWith("demo-")) throw new Error("La démonstration n'enregistre pas de retour d’auto-amélioration.");
  if (!feedback) throw new Error("Le retour est vide.");
  if (feedback.length > 5_000) throw new Error("Le retour dépasse 5 000 caractères.");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  await mkdir(feedbackRoot, { recursive: true });
  await writeFile(path.join(feedbackRoot, `${id}.json`), JSON.stringify({
    id, runId: ctx.state.id, createdAt: now(), status: "pending", feedback,
    issueUrl: ctx.state.issueUrl, projectDirectory: ctx.state.cwd,
  }, null, 2));
  activity("artifact", "Retour ajouté à la boucle d’auto-amélioration", `${id}.json`);
  publishState();
}

async function queueAutonomousReview(runId: string, snapshot: RunState) {
  const id = `self-audit-${runId}`;
  await mkdir(feedbackRoot, { recursive: true });
  await writeFile(path.join(feedbackRoot, `${id}.json`), JSON.stringify({
    id, runId, createdAt: now(), status: "pending", source: "autonomous",
    objective: "Find durable improvements from observable friction, failures, repeated review findings and missing verification in this run.",
    signals: {
      finalStatus: snapshot.status,
      finalPhase: snapshot.phase,
      elapsedMs: snapshot.startedAt ? Date.now() - new Date(snapshot.startedAt).getTime() : null,
      agents: snapshot.agents.map((agent) => ({ name: agent.name, status: agent.status })),
      artifacts: snapshot.artifacts,
      attentionEvents: snapshot.activities.filter((item) => item.kind === "attention").map((item) => item.title),
      error: snapshot.error,
    },
  }, null, 2));
  if (ctx.state.id === runId) {
    activity("artifact", "Auto-audit mis en file", `${id}.json`);
    publishState();
  }
}

export function clearImprovementWatchers() {
  for (const timer of improvementWatchers) clearTimeout(timer);
  improvementWatchers.clear();
}

/** The user merged or discarded these improvements: the watcher must never raise that review again. */
export function forgetImprovementReview(runId: string) {
  decidedImprovementReviews.add(runId);
  clearImprovementWatchers();
}

function watchForImprovements(worktreeName: string, runId: string, attempt = 0) {
  const timer = setTimeout(async () => {
    improvementWatchers.delete(timer);
    if (ctx.state.id !== runId || ctx.state.pendingSelfImprovementReview || decidedImprovementReviews.has(runId)) return;
    const worktree = await findWorktree(worktreeName).catch(() => undefined);
    const diff = worktree ? await worktreeDiff(worktree).catch(() => "") : "";
    if (diff.trim()) {
      ctx.state.pendingSelfImprovementReview = { worktreeName, runId };
      activity("agent", "Améliorations prêtes — en attente de validation", worktreeName);
      publishState();
      return;
    }
    if (attempt + 1 < WATCH_ATTEMPTS) watchForImprovements(worktreeName, runId, attempt + 1);
  }, WATCH_INTERVAL_MS);
  improvementWatchers.add(timer);
}

function startAutonomousImprovement(runId: string) {
  if (process.env.IMPL_SELF_IMPROVEMENT_AUTORUN !== "true") return;
  const worktreeName = `self-improvement-${runId.slice(-8)}`;
  const child = engine.startSelfImprovement({
    worktreeName,
    feedbackDirectory: path.join(consoleRoot, "data", "feedback"),
    runId,
  });
  if (!child) return;
  let output = "";
  let launchError: Error | undefined;
  child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4_000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4_000); });
  child.on("error", (error) => { launchError = error; });
  child.on("close", (code) => {
    if (ctx.state.id !== runId) return;
    if (code === 0 && !launchError) {
      // The launcher returns as soon as the background session exists, so the
      // review is only offered once that session has actually written something.
      watchForImprovements(worktreeName, runId);
      activity("agent", "Auto-amélioration lancée en tâche de fond", worktreeName);
    } else {
      activity("attention", "Auto-amélioration non démarrée", normalizeText(launchError?.message ?? output));
    }
    publishState();
  });
}

/**
 * The Stop hook fires on every idle turn once the workflow reaches its last phase,
 * and the terminal exit fires once more. The decision therefore has to be taken
 * once per run and kept: a second launch races the first one over the same
 * worktree, and one of them destroys the other's work.
 */
export function scheduleAutonomousReview(runId: string) {
  // A demonstration run has nothing to teach the loop, like its feedback field.
  if (runId.startsWith("demo-")) return;
  if (auditedRuns.has(runId)) return;
  auditedRuns.add(runId);
  const snapshot = structuredClone(ctx.state);
  if (!hasAuditableEvidence(snapshot)) {
    if (ctx.state.id === runId) {
      activity("system", "Auto-audit sans objet", "Cette exécution n'a produit ni agent, ni document, ni échec à analyser.");
      publishState();
    }
    return;
  }
  void queueAutonomousReview(runId, snapshot)
    .then(() => startAutonomousImprovement(runId))
    .catch((error) => {
      if (ctx.state.id !== runId) return;
      activity("attention", "Auto-audit impossible", normalizeText(error instanceof Error ? error.message : error));
      publishState();
    });
}
