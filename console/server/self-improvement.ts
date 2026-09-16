import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ctx, activity, now, publishState } from "./context.js";
import { feedbackRoot, consoleRoot, pluginRoot } from "./config.js";
import { demoState } from "./demo.js";
import { hasAuditableEvidence, improvementWorktreeInFlight, improvementWorktreeName, isImprovementWorktree, normalizeText } from "./domain.js";
import { engine } from "./engine/index.js";
import { branchIsMerged, branchIsRebasedOn, branchMergesCleanly, headCommit, listWorktrees, rebaseWorktree, worktreeCommitCount, worktreeIsClean } from "./worktree.js";
import type { PendingSelfImprovementReview, RunState } from "./types.js";

const auditedRuns = new Set<string>();

/**
 * Every self-improvement worktree, whichever run spawned it and however long ago,
 * including one the background agent has just opened and not committed to yet: the
 * console shows it as "analyzing" rather than staying silent until the first commit
 * lands. A worktree with nothing ahead of the harness whose branch the harness
 * already contains is shown as "orphaned" instead, since no agent is writing to
 * it. Computed fresh on every call instead of watched: a timer that gives up after
 * a fixed delay can only ever miss a slow commit, and one that never re-checks a
 * worktree it already gave up on loses it for good.
 */
export async function listPendingImprovements(): Promise<PendingSelfImprovementReview[]> {
  const worktrees = (await listWorktrees()).filter((worktree) => isImprovementWorktree(worktree.path));
  const reviews: PendingSelfImprovementReview[] = [];
  for (const worktree of worktrees) {
    const commits = await worktreeCommitCount(worktree).catch(() => 0);
    if (commits === 0) {
      // A branch with nothing ahead of the harness is either an agent that
      // has not committed yet, or one whose commits the harness already
      // contains (merged by hand, or by an earlier promotion that left the
      // worktree behind). The two look identical from the commit count
      // alone; only branchIsMerged tells them apart.
      const alreadyMerged = worktree.branch ? await branchIsMerged(pluginRoot, worktree.branch).catch(() => false) : false;
      reviews.push({ worktreeName: path.basename(worktree.path), branch: worktree.branch, commits: 0, status: alreadyMerged ? "orphaned" : "analyzing" });
      continue;
    }
    const mergesCleanly = worktree.branch ? await branchMergesCleanly(pluginRoot, worktree.branch).catch(() => true) : true;
    reviews.push({ worktreeName: path.basename(worktree.path), branch: worktree.branch, commits, mergesCleanly, status: "ready" });
  }
  if (demoState.pendingImprovement) reviews.push(demoState.pendingImprovement);
  return reviews;
}

/**
 * Hands a branch git could not replay to a background agent, which resolves the
 * conflict in the worktree the branch already lives in and revalidates there.
 * Gated on the same flag as the improvement loop itself: a console the user never
 * opted into autonomy on must not start sessions of its own.
 */
function startConflictResolution(worktreeName: string, onto: string) {
  if (process.env.IMPL_SELF_IMPROVEMENT_AUTORUN !== "true") return false;
  const child = engine.startConflictResolution({ worktreeName, onto });
  if (!child) return false;
  child.on("close", (code) => {
    activity(code === 0 ? "system" : "attention", code === 0 ? "Rebase assisté terminé" : "Rebase assisté en échec", worktreeName);
    publishState();
  });
  return true;
}

/**
 * Replays every pending improvement branch on top of the harness as it stands now.
 * Improvement branches are all cut from the same base and land one after another, so
 * the first promotion of a series leaves every branch still waiting behind the
 * checkout, and it only drifts further as the next ones land. Replaying them at every
 * move is what keeps the queue to one click each: a branch caught up with a single
 * commit almost always replays on its own, the same branch caught up with ten rarely
 * does.
 *
 * Three states are left untouched on purpose: a branch without a commit is an agent
 * still writing, a branch the checkout already contains has nothing left to replay,
 * and a worktree with uncommitted work holds the diagnosis
 * /implementation-harness:improve deliberately leaves behind when its own validation
 * fails, which a rebase would take away.
 */
export async function realignPendingImprovements() {
  const onto = await headCommit(pluginRoot);
  for (const worktree of (await listWorktrees()).filter((candidate) => isImprovementWorktree(candidate.path))) {
    const branch = worktree.branch;
    if (!branch) continue;
    if (await worktreeCommitCount(worktree).catch(() => 0) === 0) continue;
    if (await branchIsMerged(pluginRoot, branch).catch(() => true)) continue;
    if (await branchIsRebasedOn(pluginRoot, branch, onto).catch(() => true)) continue;
    if (!(await worktreeIsClean(worktree).catch(() => false))) continue;
    const name = path.basename(worktree.path);
    if (await rebaseWorktree(worktree, onto).catch(() => false)) {
      activity("system", "Amélioration rebasée sur le harnais", name);
      continue;
    }
    // git stopped on a conflict and the branch is back where it was. An agent is the
    // only thing that settles it, and until one does the card must keep saying so.
    const delegated = startConflictResolution(name, onto);
    activity("attention", delegated ? "Rebase assisté lancé" : "Rebase impossible",
      delegated ? `${name} est en conflit avec le harnais, un agent le reprend dans son worktree.`
        : `${name} est en conflit avec le harnais. La branche est intacte, à reprendre à la main.`);
  }
  publishState();
}

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

async function startAutonomousImprovement(runId: string) {
  if (process.env.IMPL_SELF_IMPROVEMENT_AUTORUN !== "true") return;
  const worktrees = await listWorktrees().catch(() => []);
  const inFlight = improvementWorktreeInFlight(worktrees.map((worktree) => worktree.path));
  if (inFlight) {
    // The audit stays in pending/, where the next iteration reads it: nothing is
    // lost by waiting, and evidence gathered over two runs is worth more than one
    // branch per run.
    activity("system", "Auto-amélioration en attente", `${path.basename(inFlight)} n'est pas encore tranché. Fusionne-le ou ignore-le pour libérer la boucle.`);
    publishState();
    return;
  }
  const worktreeName = improvementWorktreeName(runId);
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
      // The launcher only confirms the background session exists, not that it has
      // written anything yet: listPendingImprovements() shows the worktree as
      // "analyzing" from here, then flips it to a reviewable card once a commit lands.
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
