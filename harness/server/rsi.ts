import { spawn as spawnChild } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ctx, activity, now, publishState } from "./context.js";
import { feedbackRoot, harnessRoot, pluginRoot } from "./config.js";
import { findExecutable } from "./repository.js";
import type { RunState } from "./types.js";

const scheduledSelfAudits = new Set<string>();

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 180) : undefined;
}

export async function saveFeedback(body: string) {
  const feedback = body.trim();
  if (!ctx.state.id) throw new Error("Aucune exécution à laquelle rattacher ce retour.");
  if (ctx.state.id.startsWith("demo-")) throw new Error("La démonstration n'enregistre pas de retour RSI.");
  if (!feedback) throw new Error("Le retour est vide.");
  if (feedback.length > 5_000) throw new Error("Le retour dépasse 5 000 caractères.");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  await mkdir(feedbackRoot, { recursive: true });
  await writeFile(path.join(feedbackRoot, `${id}.json`), JSON.stringify({
    id, runId: ctx.state.id, createdAt: now(), status: "pending", feedback,
    issueUrl: ctx.state.issueUrl, projectDirectory: ctx.state.cwd,
  }, null, 2));
  activity("artifact", "Retour ajouté à la boucle RSI", `${id}.json`);
  publishState();
}

async function queueAutonomousReview(runId: string, snapshot: RunState) {
  if (scheduledSelfAudits.has(runId)) return;
  scheduledSelfAudits.add(runId);
  const id = `self-audit-${runId}`;
  try {
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
  } catch (error) {
    scheduledSelfAudits.delete(runId);
    throw error;
  }
  if (ctx.state.id === runId) {
    activity("artifact", "Auto-audit RSI mis en file", `${id}.json`);
    publishState();
  }
}

function startAutonomousImprovement(runId: string) {
  if (process.env.X_IMPLEMENT_RSI_AUTORUN !== "true") return;
  const claude = findExecutable("claude");
  if (!claude) return;
  const worktreeName = `rsi-${runId.slice(-8)}`;
  const feedbackDirectory = path.join(harnessRoot, "data", "feedback");
  const child = spawnChild(claude, [
    "--background", "--worktree", worktreeName,
    "--add-dir", pluginRoot,
    "--plugin-dir", pluginRoot,
    "--permission-mode", "auto",
    "--name", `x-implement RSI ${runId.slice(-8)}`,
    `/x-implement:x-improve ${feedbackDirectory}`,
  ], {
    cwd: pluginRoot,
    env: { ...process.env, X_IMPLEMENT_RSI_PRIMARY_CHECKOUT: pluginRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let launchError: Error | undefined;
  child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4_000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4_000); });
  child.on("error", (error) => { launchError = error; });
  child.on("close", (code) => {
    if (ctx.state.id !== runId) return;
    if (code === 0 && !launchError) {
      ctx.state.pendingRsiReview = { worktreeName, runId };
      activity("agent", "Améliorations RSI prêtes — en attente de validation");
    } else {
      activity("attention", "Auto-amélioration RSI non démarrée", normalizeText(launchError?.message ?? output));
    }
    publishState();
  });
}

export function scheduleAutonomousReview(runId: string) {
  const snapshot = structuredClone(ctx.state);
  void queueAutonomousReview(runId, snapshot)
    .then(() => startAutonomousImprovement(runId))
    .catch((error) => {
      if (ctx.state.id !== runId) return;
      activity("attention", "Auto-audit RSI impossible", normalizeText(error instanceof Error ? error.message : error));
      publishState();
    });
}
