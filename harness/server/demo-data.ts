export const demoArtifactContents: Record<string, string> = {
  "ticket-context.md": `# IH-42 · Préférences de notification

## Objectif
Permettre à chaque utilisateur de choisir les notifications reçues tout en conservant les alertes critiques.

## Critères d’acceptation
- Les préférences sont enregistrées par utilisateur.
- Les alertes critiques restent actives.
- Le réglage est pris en compte sans rechargement de la page.`,
  "implementation-plan.md": `# Plan d’implémentation

1. Ajouter le modèle de préférences.
2. Créer le panneau de réglages.
3. Connecter l’enregistrement optimiste.
4. Ajouter les tests du fallback critique.
5. Vérifier l’accessibilité et les états d’erreur.`,
  "developer-report.md": `# Rapport d’implémentation

- Modèle de préférences ajouté.
- Formulaire connecté au serveur.
- Mise à jour optimiste avec restauration en cas d’échec.
- Tests unitaires ajoutés.

Statut : prêt pour review.`,
  "test-report.json": `{
  "status": "passed",
  "tests": 11,
  "passed": 11,
  "failed": 0
}`,
  "senior-review-round-1.md": `# Review 1/2 · Changements demandés

## Retours
1. Le fallback des alertes critiques ignore le fuseau horaire de l’utilisateur.
2. Aucun test ne couvre ce cas de régression.

Décision : corrections requises avant approbation.`,
  "test-report-round-2.json": `{
  "status": "passed",
  "tests": 12,
  "passed": 12,
  "failed": 0,
  "regressionTest": "critical-alert-timezone"
}`,
  "senior-review-round-2.md": `# Review 2/2 · Approuvée

Les deux retours du premier passage sont résolus :

- le fallback utilise désormais le fuseau horaire de l’utilisateur ;
- un test de régression couvre ce comportement.

Décision : approuvé.`,
  "qa-report.json": `{
  "status": "passed",
  "accessibility": "passed",
  "typecheck": "passed",
  "unitTests": "12/12"
}`,
  "mr-description.md": `# IH-42 · Ajouter les préférences de notification

## Changements
- Ajout du panneau de préférences.
- Enregistrement optimiste des réglages.
- Conservation des alertes critiques.
- Prise en compte des retours de review sur le fuseau horaire.

## Validation
- 12 tests passent.
- Review senior approuvée au second passage.
- QA validée.`,
};

