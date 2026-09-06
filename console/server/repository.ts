import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { gitLabProjectPath, parseRepositoryMappings } from "./domain.js";
import type { RepositoryOption } from "./types.js";

export function expandHome(value: string) {
  return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export function findExecutable(name: string) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function repositoryMappings(): Record<string, string> {
  return parseRepositoryMappings(process.env.IMPL_REPOSITORIES);
}

export function configuredRepositories(): RepositoryOption[] {
  return Object.entries(repositoryMappings())
    .map(([project, repositoryPath]) => {
      const resolvedPath = path.resolve(expandHome(repositoryPath));
      return { project, path: repositoryPath, resolvedPath, exists: existsSync(resolvedPath) };
    })
    .sort((left, right) => left.project.localeCompare(right.project));
}

export async function discoverProjectDirectory(project: string) {
  const roots = (process.env.IMPL_SEARCH_ROOTS ?? "~/workspace")
    .split(",")
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => path.resolve(expandHome(root)));
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, entry.name);
      try {
        const config = await readFile(path.join(candidate, ".git", "config"), "utf8");
        if (config.includes(project)) return candidate;
      } catch { /* Not a git checkout. */ }
    }
  }
  return undefined;
}

export async function detectProjectDirectory(issueUrl: string) {
  const project = gitLabProjectPath(issueUrl);
  if (!project) return undefined;
  const mapped = repositoryMappings()[project];
  if (mapped) {
    const resolvedPath = path.resolve(expandHome(mapped));
    if (existsSync(resolvedPath)) return { project, path: mapped, resolvedPath, exists: true, source: "env" as const };
  }
  const discovered = await discoverProjectDirectory(project);
  if (discovered) return { project, path: discovered, resolvedPath: discovered, exists: true, source: "git" as const };
  return undefined;
}

export async function resolveProjectDirectory(input: string, issueUrl: string) {
  if (input.trim()) {
    const explicit = path.resolve(expandHome(input.trim()));
    if (!existsSync(explicit)) throw new Error("Le répertoire du projet n'existe pas.");
    return explicit;
  }
  const project = gitLabProjectPath(issueUrl);
  if (!project) throw new Error("L'URL du ticket GitLab n'est pas reconnue.");
  const detected = await detectProjectDirectory(issueUrl);
  if (detected) return detected.resolvedPath;
  throw new Error(`Aucun checkout trouvé pour ${project}. Renseigne son chemin ou ajoute-le à IMPL_REPOSITORIES.`);
}
