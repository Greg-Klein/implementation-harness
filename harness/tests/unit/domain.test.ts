import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { activeAgents } from "../../lib/run-state";
import { normalizeQuestion, resolveArtifactPath } from "../../server/domain";

test("normalizeQuestion nettoie une question Claude Code valide", () => {
  assert.deepEqual(normalizeQuestion({
    question: "  Quelle branche ?  ",
    header: "  Git  ",
    multiSelect: false,
    options: [
      { label: "  develop  ", description: "  Branche d’intégration.  " },
      { label: "" },
      null,
    ],
  }), {
    question: "Quelle branche ?",
    header: "Git",
    multiSelect: false,
    options: [{ label: "develop", description: "Branche d’intégration." }],
  });
});

test("normalizeQuestion rejette les entrées sans question", () => {
  assert.equal(normalizeQuestion(null), undefined);
  assert.equal(normalizeQuestion({ question: "   " }), undefined);
  assert.equal(normalizeQuestion({ header: "Git" }), undefined);
});

test("resolveArtifactPath accepte uniquement les fichiers contenus dans le dossier du run", () => {
  const root = path.resolve("/tmp/x-implement-run/artifacts");
  assert.equal(resolveArtifactPath(root, "reviews/senior.md"), path.join(root, "reviews/senior.md"));
  assert.equal(resolveArtifactPath(root, "../run.json"), undefined);
  assert.equal(resolveArtifactPath(root, "/tmp/secret.txt"), undefined);
});

test("activeAgents ne conserve que les agents en cours", () => {
  const agents = [
    { id: "developer", status: "completed" },
    { id: "reviewer", status: "running" },
    { id: "qa", status: "failed" },
  ];
  assert.deepEqual(activeAgents(agents), [{ id: "reviewer", status: "running" }]);
});
