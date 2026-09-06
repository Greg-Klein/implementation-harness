import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { imageMimeType, phaseForArtifact, resolveArtifactPath } from "./domain.js";
import { ctx, activity, publishState } from "./context.js";
import { demoArtifactContents } from "./demo-data.js";
import { dataRoot } from "./config.js";

let artifactWatcher: FSWatcher | null = null;

export async function readArtifact(artifactPath: string) {
  if (!ctx.state.id || !ctx.state.artifacts.includes(artifactPath)) throw new Error("Document introuvable pour ce run.");
  if (ctx.state.id.startsWith("demo-")) {
    const content = demoArtifactContents[artifactPath];
    if (content === undefined) throw new Error("Document de démonstration introuvable.");
    return { path: artifactPath, kind: "text", content };
  }
  const root = path.resolve(dataRoot, ctx.state.id, "artifacts");
  const target = resolveArtifactPath(root, artifactPath);
  if (!target) throw new Error("Chemin de document invalide.");
  const buffer = await readFile(target);
  if (buffer.byteLength > 2_000_000) throw new Error("Ce document dépasse la limite de prévisualisation de 2 Mo.");
  const imageType = imageMimeType(target);
  if (imageType) return { path: artifactPath, kind: "image", content: `data:${imageType};base64,${buffer.toString("base64")}` };
  return { path: artifactPath, kind: "text", content: buffer.toString("utf8") };
}

async function archiveArtifact(source: string) {
  if (!ctx.state.id) return;
  const taskRoot = path.join(ctx.state.cwd, ".claude", "tasks");
  const relative = path.relative(taskRoot, source);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return;
  const target = path.join(dataRoot, ctx.state.id, "artifacts", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  if (!ctx.state.artifacts.includes(relative)) {
    ctx.state.artifacts = [...ctx.state.artifacts, relative];
    activity("artifact", "Nouvel artefact", relative);
  }
  ctx.state.phase = Math.max(ctx.state.phase, phaseForArtifact(relative));
  publishState();
}

export async function startArtifactWatcher(cwd: string) {
  await artifactWatcher?.close();
  const taskRoot = path.join(cwd, ".claude", "tasks");
  artifactWatcher = chokidar.watch(taskRoot, { ignoreInitial: false, awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 80 } });
  artifactWatcher.on("add", (file) => void archiveArtifact(file));
  artifactWatcher.on("change", (file) => void archiveArtifact(file));
}

export async function closeArtifactWatcher() {
  await artifactWatcher?.close();
  artifactWatcher = null;
}
