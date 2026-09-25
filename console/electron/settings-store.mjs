import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { expandHome, schema, splitRoots } from "../../bin/env-schema.mjs";
import { applyEdits, serializeValue, unterminatedKeys } from "../../bin/env-file.mjs";

const keys = ["IMPL_SEARCH_ROOTS", "IMPL_MAX_CONCURRENT_RUNS", "IMPL_PERMISSION_MODE", "IMPL_REMOTE_CONTROL", "IMPL_SELF_IMPROVEMENT_AUTORUN", "IMPL_DEMO_STEP_MS", "IMPL_PLUGIN_ROOT"];
const descriptors = schema.filter((entry) => keys.includes(entry.key));
const defaults = Object.fromEntries(descriptors.map((entry) => [entry.key, entry.fallback]));
defaults.IMPL_PLUGIN_ROOT = "";
const revisionOf = (text) => createHash("sha256").update(text).digest("hex");
const MAX_DEPTH = 2;
const DETECTION_TTL_MS = 5_000;

function isHarnessCheckout(directory) {
  if (!existsSync(path.join(directory, ".git"))) return false;
  try { return JSON.parse(readFileSync(path.join(directory, ".claude-plugin", "plugin.json"), "utf8")).name === "implementation-harness"; }
  catch { return false; }
}

function findHarnessCheckout(directory, depth = 0) {
  if (isHarnessCheckout(directory)) return directory;
  if (depth >= MAX_DEPTH) return "";
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return ""; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const found = findHarnessCheckout(path.join(directory, entry.name), depth + 1);
    if (found) return found;
  }
  return "";
}

/** Only the desktop's editable settings cross IPC; unrelated .env values never do. */
export function createSettingsStore({ envFile, environment = process.env, bundledPlugin = false }) {
  let applied;
  let detection;

  // The packaged plugin cannot improve itself, so the self-audit needs the
  // harness checkout. Nobody should have to point at it by hand when it sits in
  // the directories already scanned for ticket checkouts. The snapshot is read
  // often, hence the short cache, as for the repository scan of the server.
  function detectedHarness(searchRoots) {
    if (detection?.roots === searchRoots && Date.now() - detection.at < DETECTION_TTL_MS) return detection.found;
    let found = "";
    for (const root of splitRoots(searchRoots)) {
      found = findHarnessCheckout(path.resolve(expandHome(root)));
      if (found) break;
    }
    detection = { roots: searchRoots, at: Date.now(), found };
    return found;
  }

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
    if (bundledPlugin && sources.IMPL_PLUGIN_ROOT === "default") values.IMPL_PLUGIN_ROOT = detectedHarness(values.IMPL_SEARCH_ROOTS);
    for (const descriptor of descriptors) {
      const messages = descriptor.validate(values[descriptor.key]).map((issue) => issue.message);
      if (messages.length) warnings[descriptor.key] = messages;
    }
    if (bundledPlugin && values.IMPL_SELF_IMPROVEMENT_AUTORUN === "true" && !values.IMPL_PLUGIN_ROOT.trim()) {
      warnings.IMPL_PLUGIN_ROOT = [...(warnings.IMPL_PLUGIN_ROOT ?? []), "Aucun dépôt du harnais trouvé dans les dossiers de recherche : l’auto-audit reste inactif tant qu’il n’est pas choisi."];
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
    // Only a save that turns the audit on or clears the checkout is refused:
    // with the audit on by default, refusing every save while no checkout is
    // found would lock the other settings.
    const touchesAudit = "IMPL_SELF_IMPROVEMENT_AUTORUN" in edits || "IMPL_PLUGIN_ROOT" in edits;
    if (bundledPlugin && touchesAudit && next.IMPL_SELF_IMPROVEMENT_AUTORUN === "true" && !next.IMPL_PLUGIN_ROOT.trim()) {
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
