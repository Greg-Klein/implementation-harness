import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export type PromptGroup = "system" | "command" | "agent" | "skill";
export interface PromptEntry {
  /** The prompt's path inside the plugin, which is also where its override is kept. */
  id: string;
  group: PromptGroup;
  name: string;
  description: string;
  modified: boolean;
  /** The plugin's own version changed after this override was written. */
  drifted: boolean;
}
export interface PromptDocument extends PromptEntry { content: string; original: string; revision: string }
export type PromptSaveResult = { ok: true; prompt: PromptDocument } | { ok: false; message: string; conflict?: boolean };

/** What Claude Code reads from a plugin, copied whole into a run's customized plugin. */
const PLUGIN_DIRECTORIES = [".claude-plugin", "agents", "commands", "hooks", "skills"];
const SYSTEM_PROMPT = "system.md";
const MANIFEST = "manifest.json";
const MAX_LENGTH = 512 * 1024;

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const readText = (file: string) => { try { return readFileSync(file, "utf8"); } catch { return undefined; } };

function frontmatter(source: string) {
  const block = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (block === undefined) return undefined;
  const field = (key: string) => block.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  return { name: field("name"), description: field("description") };
}

function markdownFiles(directory: string) {
  try { return readdirSync(directory).filter((file) => file.endsWith(".md")).sort(); } catch { return []; }
}

function catalog(pluginRoot: string) {
  const skills = (() => { try { return readdirSync(path.join(pluginRoot, "skills"), { withFileTypes: true }); } catch { return []; } })()
    .filter((entry) => entry.isDirectory() && existsSync(path.join(pluginRoot, "skills", entry.name, "SKILL.md")))
    .map((entry) => entry.name).sort();
  return [
    { id: SYSTEM_PROMPT, group: "system" as const },
    ...markdownFiles(path.join(pluginRoot, "commands")).map((file) => ({ id: `commands/${file}`, group: "command" as const })),
    ...markdownFiles(path.join(pluginRoot, "agents")).map((file) => ({ id: `agents/${file}`, group: "agent" as const })),
    ...skills.map((skill) => ({ id: `skills/${skill}/SKILL.md`, group: "skill" as const })),
  ];
}

/**
 * Overrides live outside the plugin: the packaged one is read-only, and a harness
 * checkout must stay clean for the self-improvement loop to branch from it.
 */
export function createPromptStore({ pluginRoot, promptsRoot }: { pluginRoot: () => string; promptsRoot: string }) {
  const manifestFile = path.join(promptsRoot, MANIFEST);
  const readManifest = (): Record<string, { base: string }> => { try { return JSON.parse(readFileSync(manifestFile, "utf8")); } catch { return {}; } };

  function writeAtomically(file: string, text: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, text, { flag: "wx" }); renameSync(temporary, file); }
    finally { try { unlinkSync(temporary); } catch { /* Rename already removed it. */ } }
  }

  function locate(id: unknown) {
    const entry = catalog(pluginRoot()).find((candidate) => candidate.id === id);
    if (!entry) throw new Error("Ce prompt n’existe pas dans le plugin.");
    return entry;
  }

  function document(entry: ReturnType<typeof catalog>[number]): PromptDocument {
    const original = entry.group === "system" ? "" : readText(path.join(pluginRoot(), entry.id)) ?? "";
    const override = readText(path.join(promptsRoot, entry.id));
    const content = override ?? original;
    const metadata = frontmatter(original);
    const recorded = readManifest()[entry.id]?.base;
    return {
      id: entry.id, group: entry.group,
      name: entry.group === "system" ? "Instructions système" : metadata?.name || path.basename(entry.id, ".md"),
      description: entry.group === "system" ? "Ajoutées au prompt système de chaque session de run." : metadata?.description ?? "",
      modified: override !== undefined,
      drifted: override !== undefined && recorded !== undefined && recorded !== hash(original),
      content, original, revision: hash(override ?? "\0original"),
    };
  }

  function validate(entry: ReturnType<typeof catalog>[number], content: string, original: string) {
    if (content.length > MAX_LENGTH || content.includes("\0")) return "Ce prompt est trop long ou contient des caractères invalides.";
    if (entry.group === "system") return undefined;
    const metadata = frontmatter(content);
    if (!metadata) return "Le prompt doit commencer par son en-tête YAML, entre deux lignes « --- ».";
    const expected = frontmatter(original)?.name;
    if (expected && metadata.name !== expected) return `Le champ « name » doit rester « ${expected} » : le workflow y fait référence.`;
    if (!metadata.description) return "Le champ « description » de l’en-tête est obligatoire.";
    return undefined;
  }

  function list(): PromptEntry[] {
    return catalog(pluginRoot()).map((entry) => {
      const { content: _content, original: _original, revision: _revision, ...summary } = document(entry);
      return summary;
    });
  }

  function read(id: unknown) { return document(locate(id)); }

  function save(request: { id?: unknown; content?: unknown; revision?: unknown }): PromptSaveResult {
    const entry = locate(request?.id);
    const current = document(entry);
    if (request.revision !== current.revision) return { ok: false, conflict: true, message: "Ce prompt a été modifié ailleurs. Recharge-le avant d’enregistrer." };
    if (typeof request.content !== "string") return { ok: false, message: "Prompt invalide." };
    const content = request.content;
    const manifest = readManifest();
    try {
      if (content === current.original || (entry.group === "system" && !content.trim())) {
        rmSync(path.join(promptsRoot, entry.id), { force: true });
        delete manifest[entry.id];
      } else {
        const invalid = validate(entry, content, current.original);
        if (invalid) return { ok: false, message: invalid };
        writeAtomically(path.join(promptsRoot, entry.id), content);
        manifest[entry.id] = { base: hash(current.original) };
      }
      writeAtomically(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    } catch {
      return { ok: false, message: "Impossible d’enregistrer ce prompt. Vérifie les droits d’accès au dossier de données." };
    }
    return { ok: true, prompt: document(entry) };
  }

  function reset(request: { id?: unknown; revision?: unknown }) {
    return save({ id: request?.id, revision: request?.revision, content: document(locate(request?.id)).original });
  }

  /**
   * The plugin a run is launched with. Without any override it is the plugin
   * itself; otherwise a copy kept in the run's own directory, so a run keeps the
   * prompts it started with whatever is edited while it goes on.
   */
  function sessionPlugin(directory: string) {
    const root = pluginRoot();
    const systemPrompt = readText(path.join(promptsRoot, SYSTEM_PROMPT))?.trim() || undefined;
    const overrides = catalog(root).filter((entry) => entry.group !== "system" && existsSync(path.join(promptsRoot, entry.id)));
    const customized = [...(systemPrompt ? [SYSTEM_PROMPT] : []), ...overrides.map((entry) => entry.id)];
    if (!overrides.length) return { pluginDir: root, systemPrompt, customized };
    rmSync(directory, { recursive: true, force: true });
    for (const name of PLUGIN_DIRECTORIES) {
      if (existsSync(path.join(root, name))) cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
    }
    for (const entry of overrides) copyFileSync(path.join(promptsRoot, entry.id), path.join(directory, entry.id));
    return { pluginDir: directory, systemPrompt, customized };
  }

  return { list, read, save, reset, sessionPlugin };
}
