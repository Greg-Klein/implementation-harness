# Implementation Harness

Implementation Harness est une interface locale pour piloter Claude Code pendant l’implémentation d’un ticket GitLab. On colle l’URL du ticket, le harnais détecte le checkout correspondant, ouvre un terminal Claude Code et rend visibles la progression, les agents, les outils et les livrables.

Le dépôt contient un plugin Claude Code dont la commande `/x-implement` orchestre le travail : lecture du ticket, questions de clarification, planification, implémentation, tests, revues spécialisées et préparation de la merge request. Le harnais constitue la couche visuelle de cette commande. Il utilise la connexion Claude Code déjà présente sur la machine et ne fait aucun appel direct à l’API Anthropic.

## Installation en une commande

Prérequis :

- macOS ou Linux;
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installé et connecté;
- Node.js 22 ou plus récent;
- `git` et [`glab`](https://gitlab.com/gitlab-org/cli) installé et authentifié.

Exécuter :

```bash
curl -fsSL https://raw.githubusercontent.com/Greg-Klein/implementation-harness/main/install-remote.sh | bash
```

La même commande met à jour une installation existante avec un `git pull --ff-only`.

L’installateur télécharge les dépendances et crée deux commandes dans `~/.local/bin` :

- `ximpl`, l’alias court;
- `x-implement-ui`, le nom explicite.

Si `~/.local/bin` n’est pas encore dans `PATH`, l’installateur affiche la ligne à ajouter à la configuration du shell.

## Utilisation

```bash
ximpl
```

Pour découvrir l’interface sans ticket ni appel à Claude Code :

```bash
ximpl demo
```

Cette commande ouvre un scénario local simulé avec progression, agents, documents générés et décisions interactives. Chaque étape dure cinq secondes. La première review demande des corrections, renvoie le travail à l’agent d’implémentation, puis une seconde review valide les changements. Elle ne modifie aucun dépôt, ne contacte pas GitLab et n’alimente pas la boucle RSI. Le mode démo n’ajoute aucun contrôle à l’interface normale.

Le navigateur s’ouvre sur <http://127.0.0.1:3210>. Dans l’interface :

1. coller l’URL du ticket GitLab;
2. vérifier le projet détecté ou renseigner son chemin;
3. ajouter si nécessaire une instruction propre à cette exécution;
4. lancer le workflow et répondre aux décisions dans le panneau dédié ou échanger librement dans le terminal.

Le bouton **Documents générés** ouvre un lecteur intégré pour consulter le contexte du ticket, les plans, rapports de tests, reviews et descriptions de MR conservés pendant le run.

Le lecteur n’interrompt pas l’exécution. Si Claude Code pose une question pendant sa consultation, un bandeau signale la décision attendue et le bouton **Répondre** referme le lecteur pour afficher la carte de clarification.

Le harnais exécute Claude Code dans le projet sélectionné avec le plugin de ce dépôt. Les commandes et les agents restent dans le dépôt; aucun fichier n’est copié dans `~/.claude`.

Quand Claude Code utilise `AskUserQuestion`, le harnais présente les décisions dans un panneau dédié : les choix suggérés peuvent remplir la réponse, qui reste éditable dans un champ de texte avant son envoi. La réponse est transmise à Claude Code par le hook en attente. Le terminal intégré reste visible et interactif pendant toute l’exécution pour les échanges libres et les commandes qui ne passent pas par ce panneau.

## Configuration

L’installateur crée un `.env` local à partir de `.env.example`. Pour associer automatiquement les projets GitLab à leurs checkouts :

```dotenv
X_IMPLEMENT_REPOSITORIES='{"groupe/projet":"~/workspace/projet"}'
X_IMPLEMENT_SEARCH_ROOTS='~/workspace,~/code'
```

Le mapping exact est prioritaire. Sinon, le harnais inspecte les remotes Git des dossiers situés directement dans les racines de recherche. Après collage d’un ticket, le chemin détecté remplit le champ projet s’il est vide. Ce champ reste éditable et propose les dépôts du mapping `.env` pendant la saisie. Le `.env` est ignoré par Git.

### Port et navigateur

Changer le port par défaut :

```bash
X_IMPLEMENT_PORT=4321 ximpl
```

Lancer sans ouvrir automatiquement le navigateur :

```bash
X_IMPLEMENT_NO_OPEN=1 ximpl
```

## Boucle d’auto-amélioration

À la fin d’un run, le panneau de droite permet d’enregistrer un retour concret. Il est conservé localement avec l’identifiant du run et ses documents générés, puis traité avec :

```bash
ximpl improve
```

Cette commande lance Claude Code sur `/x-improve`. Il regroupe les retours en attente, vérifie les preuves du run, crée une branche `improve-rsi-*`, applique la plus petite amélioration durable, exécute les vérifications et crée un commit local. Il ne pousse rien et ne fusionne rien : le résultat reste inspectable et réversible.

Les tickets, logs et retours bruts restent sous `harness/data/` et ne sont jamais ajoutés au commit d’amélioration.

Le harnais peut également se critiquer sans retour humain. À la fin de chaque workflow, y compris après un échec ou un arrêt manuel, il enregistre un auto-audit portant sur les échecs, interventions, boucles de revue, documents manquants et vérifications incomplètes. En mode autonome, Claude Code traite cette preuve dans un worktree isolé. Un signal auto-généré doit apparaître sur au moins deux runs, sauf bug déterministe ou défaut de sécurité.

La politique se règle dans `.env` :

```dotenv
X_IMPLEMENT_RSI_AUTORUN='true'
X_IMPLEMENT_RSI_AUTO_APPLY='true'
```

`RSI_AUTORUN` lance l’analyse en arrière-plan à la fin du run. `RSI_AUTO_APPLY` fusionne uniquement un commit validé par fast-forward dans le checkout installé. Aucun changement n’est poussé sur GitHub. Les deux options valent `false` dans `.env.example`; il faut les activer consciemment. Après une promotion, redémarrer le harnais pour charger les changements du serveur local.

## Fonctionnement

Claude Code reste le moteur du workflow. Le harnais ajoute :

- un pseudo-terminal interactif relié à l’interface avec WebSocket;
- des hooks Claude Code pour suivre les agents et les outils, puis présenter et résoudre les questions structurées dans l’interface;
- une surveillance de `.claude/tasks/` pour suivre les étapes et conserver les rapports avant leur nettoyage.

Les données sont archivées dans `harness/data/runs/<run-id>/` :

- `run.json` contient l’état, les agents et l’activité;
- `terminal.log` contient la sortie brute du terminal;
- `artifacts/` contient les documents générés pendant le run : plans, rapports QA, reviews et captures.

Ce dossier est local et ignoré par Git. Il peut contenir des informations confidentielles provenant des tickets traités; il ne faut pas le partager.

## Tests

Depuis le dossier `harness/` :

```bash
npm run test:unit
npm run test:integration
```

Les tests unitaires utilisent Jest. Ils sont séparés par responsabilité dans `tests/unit/` et suivent la convention `describe(...)` puis `it("should ...")`.

Les tests d’intégration sont répartis par parcours dans `tests/integration/`. Ils utilisent Playwright avec Google Chrome et démarrent un serveur isolé sur le port `3211`. Pour observer leur exécution :

```bash
npm run test:integration:headed
```

## Développement

```bash
cd harness
npm install
npm run dev
```

Vérifications :

```bash
npm run typecheck
npm run build
```

Le front utilise Next.js, React, TypeScript, Tailwind CSS et xterm.js. Le serveur local utilise `node-pty`, WebSocket et les hooks Claude Code.

## Contenu du dépôt

```text
agents/       sous-agents Claude Code
commands/     commandes /x-implement, /x-review et /x-improve
hooks/        événements envoyés au harnais local
bin/          lanceur ximpl
harness/      interface Next.js et serveur PTY
install.sh    installation et création des commandes globales
install-remote.sh  clone ou mise à jour depuis la commande curl
```

Selon le ticket, `/x-implement` peut aussi utiliser Playwright et Figma. Un MCP absent réduit les vérifications correspondantes mais n’empêche pas le harnais de démarrer.
