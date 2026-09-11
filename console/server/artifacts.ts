import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { Stats } from "node:fs";
import { belongsToRun, isRunDocument, phaseForArtifact, resolveArtifactPath } from "./domain.js";
import { ctx, activity, publishState } from "./context.js";
import { engine } from "./engine/index.js";
import { demoArtifactContents } from "./demo-data.js";
import { dataRoot } from "./config.js";

let artifactWatcher: FSWatcher | null = null;

const IMAGE_CONTENT_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** The evidence files a reviewer or the developer writes for the console's "Preuves" tab, round archives included. */
const EVIDENCE_FILE = /^(qa|design|dev)-evidence(-round\d+)?\.json$/;

export async function readArtifact(artifactPath: string) {
  if (!ctx.state.id || !ctx.state.artifacts.includes(artifactPath)) throw new Error("Document introuvable pour ce run.");
  if (ctx.state.id.startsWith("demo-")) {
    const content = demoArtifactContents[artifactPath];
    if (content === undefined) throw new Error("Document de démonstration introuvable.");
    const demoContentType = IMAGE_CONTENT_TYPES[path.extname(artifactPath).toLowerCase()];
    if (demoContentType) return { path: artifactPath, content, encoding: "base64" as const, contentType: demoContentType };
    return { path: artifactPath, content };
  }
  const root = path.resolve(dataRoot, ctx.state.id, "artifacts");
  const target = resolveArtifactPath(root, artifactPath);
  if (!target) throw new Error("Chemin de document invalide.");
  const buffer = await readFile(target);
  if (buffer.byteLength > 2_000_000) throw new Error("Ce document dépasse la limite de prévisualisation de 2 Mo.");
  const contentType = IMAGE_CONTENT_TYPES[path.extname(target).toLowerCase()];
  if (contentType) return { path: artifactPath, content: buffer.toString("base64"), encoding: "base64" as const, contentType };
  return { path: artifactPath, content: buffer.toString("utf8") };
}

/**
 * A screenshot is only ever archived when a proof file names it: widening this
 * to every file under assets/ would pull in every Figma download and debug
 * capture, exactly what isRunDocument's extension filter was written to avoid.
 */
async function archiveEvidenceScreenshots(evidenceSource: string, taskRoot: string) {
  if (!ctx.state.id) return;
  let items: unknown;
  try { items = JSON.parse(await readFile(evidenceSource, "utf8")).items; } catch { return; }
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const screenshot = (item as { screenshot?: unknown } | null)?.screenshot;
    if (typeof screenshot !== "string" || !screenshot) continue;
    const source = path.resolve(taskRoot, screenshot);
    const relative = path.relative(taskRoot, source);
    if (relative.startsWith("..") || path.isAbsolute(relative) || ctx.state.artifacts.includes(relative)) continue;
    const target = path.join(dataRoot, ctx.state.id, "artifacts", relative);
    await mkdir(path.dirname(target), { recursive: true });
    const copied = await copyFile(source, target).then(() => true, () => false);
    if (copied && !ctx.state.artifacts.includes(relative)) {
      ctx.state.artifacts = [...ctx.state.artifacts, relative];
      activity("artifact", "Capture archivée", relative);
    }
  }
}

async function archiveArtifact(source: string, stats?: Stats) {
  if (!ctx.state.id) return;
  const writtenAt = stats?.mtimeMs ?? await stat(source).then(({ mtimeMs }) => mtimeMs, () => 0);
  if (!belongsToRun(writtenAt, ctx.state.startedAt)) return;
  const taskRoot = engine.taskDirectory(ctx.state.cwd);
  const relative = path.relative(taskRoot, source);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return;
  if (!isRunDocument(relative)) return;
  const target = path.join(dataRoot, ctx.state.id, "artifacts", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  if (!ctx.state.artifacts.includes(relative)) {
    ctx.state.artifacts = [...ctx.state.artifacts, relative];
    activity("artifact", "Nouvel artefact", relative);
  }
  if (EVIDENCE_FILE.test(path.basename(relative))) await archiveEvidenceScreenshots(source, taskRoot);
  // A document is the output of its step, so its arrival opens the next one.
  const completedPhase = phaseForArtifact(relative);
  if (completedPhase) ctx.state.phase = Math.max(ctx.state.phase, completedPhase + 1);
  publishState();
}

/**
 * The workflow's own last step cleans this directory, but only when it gets
 * there: a run stopped from the interface or one whose `claude` process
 * crashed never reaches it, and leaves a previous ticket's files for the next
 * run to misread as its own (`ticket-context.md`, `planner-output.json`, a
 * stale `developer-report-*.md`). Every run therefore starts from an empty
 * task directory itself, rather than trusting the previous one to have ended
 * cleanly.
 */
export async function clearTaskDirectory(cwd: string) {
  await rm(engine.taskDirectory(cwd), { recursive: true, force: true });
}

export async function startArtifactWatcher(cwd: string) {
  await artifactWatcher?.close();
  const taskRoot = engine.taskDirectory(cwd);
  // chokidar stays inert on a path that does not exist yet, and a checkout that
  // has never run the workflow has no task directory to watch.
  await mkdir(taskRoot, { recursive: true });
  artifactWatcher = chokidar.watch(taskRoot, { ignoreInitial: false, awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 80 } });
  artifactWatcher.on("add", (file, stats) => void archiveArtifact(file, stats));
  artifactWatcher.on("change", (file, stats) => void archiveArtifact(file, stats));
}

export async function closeArtifactWatcher() {
  await artifactWatcher?.close();
  artifactWatcher = null;
}
