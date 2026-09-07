import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(value) {
  if (value === "~") return os.homedir();
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export function splitRoots(value) {
  return value.split(",").map((root) => root.trim()).filter(Boolean);
}

function issue(severity, message) {
  return { severity, message };
}

function validateRoots(value) {
  const roots = splitRoots(value);
  if (roots.length === 0) return [issue("erreur", "au moins une racine de recherche est attendue")];
  return roots.flatMap((root) =>
    existsSync(path.resolve(expandHome(root))) ? [] : [issue("avertissement", `racine introuvable : ${root}`)]);
}

function validateEnum(allowed) {
  return (value) => (allowed.includes(value) ? [] : [issue("erreur", `valeur attendue : ${allowed.join(" ou ")}`)]);
}

function validateInteger(min, max) {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return [issue("erreur", `entier attendu entre ${min} et ${max}`)];
    }
    return [];
  };
}

function validateText(value) {
  return value.trim() ? [] : [issue("erreur", "une valeur non vide est attendue")];
}

export const schema = [
  {
    key: "IMPL_SEARCH_ROOTS",
    label: "Racines de recherche des dépôts",
    comment: "Comma-separated directories scanned, up to two levels deep, for the checkout of a GitLab issue.",
    help: "Répertoires parcourus, jusqu'à deux niveaux, pour retrouver le checkout d'un ticket. Séparés par des virgules.",
    fallback: "~/workspace",
    kind: "list",
    readBy: "console",
    validate: validateRoots,
  },
  {
    key: "IMPL_SELF_IMPROVEMENT_AUTORUN",
    label: "Auto-audit à la fin de chaque run",
    comment: "Run a Claude Code self-audit after every completed workflow.",
    help: "Lance une auto-analyse Claude Code après chaque workflow terminé.",
    fallback: "false",
    kind: "boolean",
    readBy: "console",
    validate: validateEnum(["true", "false"]),
  },
  {
    key: "IMPL_PORT",
    label: "Port d'écoute",
    comment: "Port the local server and the browser use.",
    help: "Port du serveur local et de l'interface.",
    fallback: "3210",
    kind: "port",
    readBy: "both",
    validate: validateInteger(1, 65535),
  },
  {
    key: "IMPL_HOST",
    label: "Interface d'écoute",
    comment: "Network interface the local server binds to.",
    help: "Interface réseau du serveur local.",
    fallback: "127.0.0.1",
    kind: "text",
    readBy: "console",
    validate: validateText,
  },
  {
    key: "IMPL_NO_OPEN",
    label: "Démarrer sans ouvrir le navigateur",
    comment: "Set to 1 to start without opening the browser.",
    help: "1 pour démarrer sans ouvrir le navigateur.",
    fallback: "0",
    kind: "flag",
    readBy: "launcher",
    validate: validateEnum(["0", "1"]),
  },
  {
    key: "IMPL_DEMO_STEP_MS",
    label: "Durée d'une étape du mode démo, en millisecondes",
    comment: "Duration of each step of the simulated scenario, in milliseconds.",
    help: "Durée de chaque étape du scénario simulé, en millisecondes.",
    fallback: "5000",
    kind: "duration",
    readBy: "console",
    validate: validateInteger(1, 3_600_000),
  },
];

export function descriptorFor(key) {
  return schema.find((entry) => entry.key === key);
}

/** Anything the console reads only reaches it through a restart. */
export function needsRestart(descriptor) {
  return descriptor.readBy !== "launcher";
}
