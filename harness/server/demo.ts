import { ctx, activity, broadcast, emptyState, now, publishState } from "./context.js";
import { demoStepDuration } from "./config.js";

const demoTimers = new Set<ReturnType<typeof setTimeout>>();

function scheduleDemo(delay: number, callback: () => void) {
  const timer = setTimeout(() => { demoTimers.delete(timer); callback(); }, delay);
  demoTimers.add(timer);
}

export function clearDemoTimers() {
  for (const timer of demoTimers) clearTimeout(timer);
  demoTimers.clear();
}

function demoTerminal(message: string) {
  const line = `\r\n\x1b[38;5;108m●\x1b[0m ${message}\r\n`;
  ctx.terminalBuffer = (ctx.terminalBuffer + line).slice(-600_000);
  broadcast({ type: "terminal.output", data: line });
}

export function startDemoRun(isTerminalActive: boolean) {
  if (isTerminalActive || ctx.state.status === "running" || ctx.state.status === "starting" || ctx.state.status === "attention") throw new Error("Une session est déjà active.");
  clearDemoTimers();
  ctx.terminalBuffer = "";
  const id = `demo-${crypto.randomUUID().slice(0, 8)}`;
  ctx.state = {
    ...emptyState(), id, status: "running", phase: 1,
    cwd: "~/workspace/acme-dashboard", issueUrl: "ticket-simule://IH-42",
    instruction: "Mode démonstration — aucun dépôt ne sera modifié.", startedAt: now(),
  };
  activity("system", "Ticket simulé chargé", "IH-42 · Ajouter les préférences de notification");
  publishState();
  demoTerminal("Lecture du ticket GitLab simulé…");
  scheduleDemo(demoStepDuration, () => {
    ctx.state.artifacts = ["ticket-context.md"];
    activity("artifact", "Contexte du ticket consolidé", "ticket-context.md");
    publishState();
    demoTerminal("Critères d’acceptation et cas limites extraits.");
  });
  scheduleDemo(demoStepDuration * 2, () => {
    ctx.state.phase = 2;
    ctx.state.status = "attention";
    ctx.state.pendingQuestion = {
      id: `demo-question-${id}`,
      questions: [
        {
          header: "Branche de base",
          question: "Sur quelle branche faut-il construire cette implémentation ?",
          options: [
            { label: "develop", description: "Suit le flux d'intégration existant." },
            { label: "main", description: "Part directement de la branche stable." },
          ],
          multiSelect: false,
        },
        {
          header: "Notifications",
          question: "Quel comportement faut-il appliquer quand les notifications sont désactivées ?",
          options: [
            { label: "Tout masquer", description: "Aucune notification n'est présentée." },
            { label: "Garder les alertes critiques", description: "Les alertes de sécurité restent visibles." },
          ],
          multiSelect: false,
        },
      ],
    };
    activity("attention", "Deux décisions attendent ta réponse");
    publishState();
    demoTerminal("Claude attend tes décisions dans le panneau de droite.");
  });
}

export function continueDemoRun() {
  scheduleDemo(0, () => {
    ctx.state.phase = 3;
    activity("system", "Branche de démonstration préparée", "feat/ih-42-notification-preferences");
    publishState();
    demoTerminal("Branche et plan de travail préparés.");
  });
  scheduleDemo(demoStepDuration, () => {
    ctx.state.phase = 4;
    ctx.state.artifacts = [...ctx.state.artifacts, "implementation-plan.md"];
    activity("artifact", "Plan d’implémentation validé", "implementation-plan.md");
    publishState();
    demoTerminal("Plan découpé en composants, tests et migration de données.");
  });
  scheduleDemo(demoStepDuration * 2, () => {
    ctx.state.phase = 5;
    ctx.state.agents = [{ id: "demo-developer", name: "developer", status: "running", startedAt: now() }];
    activity("agent", "developer démarre");
    publishState();
    demoTerminal("Délégation de l'implémentation à l'agent developer…");
  });
  scheduleDemo(demoStepDuration * 3, () => {
    ctx.state.phase = 6;
    ctx.state.agents = [
      ...ctx.state.agents.map((agent) => ({ ...agent, status: "completed" as const, endedAt: now() })),
      { id: "demo-reviewer", name: "senior-reviewer", status: "running" as const, startedAt: now() },
    ];
    ctx.state.artifacts = [...ctx.state.artifacts, "developer-report.md", "test-report.json"];
    activity("agent", "Implémentation terminée, vérifications en cours");
    publishState();
    demoTerminal("Tests unitaires et contrôle TypeScript terminés. Passage en review…");
  });
  scheduleDemo(demoStepDuration * 4, () => {
    ctx.state.phase = 7;
    ctx.state.agents = ctx.state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "failed" as const, endedAt: now() } : agent);
    ctx.state.artifacts = [...ctx.state.artifacts, "senior-review-round-1.md"];
    activity("attention", "Review : corrections demandées", "Le fallback critique ignore le fuseau horaire · un test de régression manque");
    publishState();
    demoTerminal("Review 1/2 : changements demandés sur le fallback et sa couverture de test.");
  });
  scheduleDemo(demoStepDuration * 5, () => {
    ctx.state.phase = 5;
    ctx.state.agents = ctx.state.agents.map((agent) => agent.id === "demo-developer" ? { ...agent, status: "running" as const, startedAt: now(), endedAt: undefined } : agent);
    activity("agent", "developer reprend l’implémentation", "Application des deux retours de review");
    publishState();
    demoTerminal("Boucle vers l’implémentation : correction du fallback et ajout du test manquant…");
  });
  scheduleDemo(demoStepDuration * 6, () => {
    ctx.state.phase = 6;
    ctx.state.agents = ctx.state.agents.map((agent) => {
      if (agent.id === "demo-developer") return { ...agent, status: "completed" as const, endedAt: now() };
      if (agent.id === "demo-reviewer") return { ...agent, status: "running" as const, startedAt: now(), endedAt: undefined };
      return agent;
    });
    ctx.state.artifacts = [...ctx.state.artifacts, "test-report-round-2.json"];
    activity("agent", "Corrections vérifiées", "12 tests passent, dont le nouveau test de régression");
    publishState();
    demoTerminal("Corrections terminées. Les 12 tests passent, nouvelle review demandée.");
  });
  scheduleDemo(demoStepDuration * 7, () => {
    ctx.state.phase = 7;
    ctx.state.agents = ctx.state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "completed" as const, endedAt: now() } : agent);
    ctx.state.artifacts = [...ctx.state.artifacts, "senior-review-round-2.md", "qa-report.json"];
    activity("agent", "Review 2/2 approuvée", "Les retours du premier passage sont résolus");
    publishState();
    demoTerminal("Review 2/2 : approuvée. Les retours ont bien été pris en compte.");
  });
  scheduleDemo(demoStepDuration * 8, () => {
    ctx.state.phase = 8;
    ctx.state.artifacts = [...ctx.state.artifacts, "mr-description.md"];
    activity("artifact", "Merge request préparée", "mr-description.md");
    publishState();
    demoTerminal("Description et checklist de merge request générées.");
  });
  scheduleDemo(demoStepDuration * 9, () => {
    ctx.state.phase = 9;
    activity("system", "Rapport de review publié", "Review 2/2 · approuvée");
    publishState();
    demoTerminal("Rapport final publié dans la merge request simulée.");
  });
  scheduleDemo(demoStepDuration * 10, () => {
    ctx.state.phase = 10;
    ctx.state.status = "completed";
    ctx.state.endedAt = now();
    activity("system", "Démonstration terminée", "Aucun dépôt ni ticket n’a été modifié.");
    publishState();
    demoTerminal("Merge request simulée prête. Fin de la démonstration.");
  });
  scheduleDemo(demoStepDuration * 11, () => {
    const worktreeName = `demo-rsi-${crypto.randomUUID().slice(0, 8)}`;
    ctx.state.pendingRsiReview = { worktreeName, runId: ctx.state.id ?? "" };
    activity("agent", "Améliorations RSI prêtes — en attente de validation");
    publishState();
    demoTerminal("Auto-audit RSI terminé. Des améliorations sont proposées dans le panneau de droite.");
  });
}
