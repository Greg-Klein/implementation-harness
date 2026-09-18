import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { expandHome, schema, splitRoots } from "../../bin/env-schema.mjs";
import { applyEdits, serializeValue, unterminatedKeys } from "../../bin/env-file.mjs";

const keys = ["IMPL_SEARCH_ROOTS", "IMPL_MAX_CONCURRENT_RUNS", "IMPL_REMOTE_CONTROL", "IMPL_SELF_IMPROVEMENT_AUTORUN", "IMPL_DEMO_STEP_MS", "IMPL_PLUGIN_ROOT"];
const descriptors = schema.filter((entry) => keys.includes(entry.key));
const defaults = Object.fromEntries(descriptors.map((entry) => [entry.key, entry.fallback]));
defaults.IMPL_PLUGIN_ROOT = "";
const revisionOf = (text) => createHash("sha256").update(text).digest("hex");

/** Only the desktop's editable settings cross IPC; unrelated .env values never do. */
export function createSettingsStore({ envFile, environment = process.env, bundledPlugin = false }) {
  let applied;

  function readText() {
    try { return readFileSync(envFile, "utf8"); }
    catch (error) {
      if (error.code === "ENOENT") return "";
      throw new Error("Impossible de lire les réglages enregistrés. Vérifie les droits d’accès au fichier de configuration.");
    }
  }

  function snapshot() {
    const text = readText();
    const stored = parseEnv(text);
    const values = {};
    const sources = {};
    const warnings = {};
    for (const key of keys) {
      values[key] = environment[key] ?? stored[key] ?? defaults[key];
      sources[key] = environment[key] !== undefined ? "environment" : stored[key] !== undefined ? "file" : "default";
    }
    for (const descriptor of descriptors) {
      const messages = descriptor.validate(values[descriptor.key]).map((issue) => issue.message);
      if (messages.length) warnings[descriptor.key] = messages;
    }
    return { values, sources, warnings, revision: revisionOf(text), restartRequired: Boolean(applied && keys.some((key) => values[key] !== applied[key])) };
  }

  function save(request) {
    if (!request || typeof request !== "object" || !request.values || typeof request.values !== "object" || Array.isArray(request.values)) {
      return { ok: false, message: "Réglages invalides." };
    }
    const text = readText();
    if (request.revision !== revisionOf(text)) return { ok: false, conflict: true, message: "Les réglages ont été modifiés ailleurs. Recharge-les avant d’enregistrer." };
    if (unterminatedKeys(text).length) return { ok: false, message: "La configuration contient une valeur multiligne ou un guillemet non fermé. Elle ne peut pas être modifiée automatiquement." };
    const current = snapshot();
    const edits = {};
    const errors = {};
    for (const [key, raw] of Object.entries(request.values)) {
      if (!keys.includes(key)) return { ok: false, message: "Ce réglage n’est pas modifiable depuis l’application." };
      if (typeof raw !== "string" || raw.length > 8192 || /[\r\n\0]/.test(raw)) { errors[key] = "Valeur invalide."; continue; }
      if (current.sources[key] === "environment") {
        if (raw !== current.values[key]) errors[key] = "Ce réglage est imposé au lancement de l’application.";
        continue;
      }
      let value = raw.trim();
      if (key === "IMPL_SEARCH_ROOTS") value = [...new Set(splitRoots(value))].join(",");
      if (key === "IMPL_PLUGIN_ROOT" && value) value = path.resolve(expandHome(value));
      const descriptor = descriptors.find((entry) => entry.key === key);
      const invalid = descriptor?.validate(value).find((issue) => issue.severity === "erreur");
      if (invalid) { errors[key] = invalid.message; continue; }
      if (key === "IMPL_PLUGIN_ROOT" && value && (!existsSync(path.join(value, ".git")) || !existsSync(path.join(value, ".claude-plugin", "plugin.json")))) {
        errors[key] = "Choisis un checkout Git d’Implementation Harness contenant son plugin.";
        continue;
      }
      try { serializeValue(value); } catch { errors[key] = "Ce chemin contient une combinaison de caractères non prise en charge."; continue; }
      if (value !== current.values[key]) edits[key] = value;
    }
    const next = { ...current.values, ...edits };
    if (bundledPlugin && next.IMPL_SELF_IMPROVEMENT_AUTORUN === "true" && !next.IMPL_PLUGIN_ROOT.trim()) {
      errors.IMPL_PLUGIN_ROOT = "Choisis le dépôt du harnais pour activer l’auto-audit.";
    }
    if (Object.keys(errors).length) return { ok: false, message: "Vérifie les champs indiqués.", errors };
    if (!Object.keys(edits).length) return { ok: true, snapshot: current };
    const temporary = `${envFile}.${randomUUID()}.tmp`;
    try {
      mkdirSync(path.dirname(envFile), { recursive: true });
      const mode = existsSync(envFile) ? statSync(envFile).mode & 0o777 : 0o600;
      writeFileSync(temporary, applyEdits(text, edits, descriptors), { mode, flag: "wx" });
      renameSync(temporary, envFile);
    } catch {
      return { ok: false, message: "Impossible d’enregistrer les réglages. Vérifie les droits d’accès au dossier de configuration." };
    } finally { try { unlinkSync(temporary); } catch { /* Rename already removed it. */ } }
    return { ok: true, snapshot: snapshot() };
  }

  return { snapshot, save, markApplied() { applied = { ...snapshot().values }; } };
}
