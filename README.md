# Implementation Harness

Une interface locale pour lancer et suivre le workflow `/x-implement` dans le véritable Claude Code.

Le harnais affiche le terminal interactif, la progression du ticket, les sous-agents actifs, les appels d’outils et les artefacts produits par les revues. Il utilise la connexion Claude Code déjà présente sur la machine et ne fait aucun appel direct à l’API Anthropic.

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

Le navigateur s’ouvre sur <http://127.0.0.1:3210>. Dans l’interface :

1. coller l’URL du ticket GitLab;
2. vérifier le projet détecté ou renseigner son chemin;
3. ajouter si nécessaire une instruction propre à cette exécution;
4. lancer le workflow et répondre aux questions dans le terminal intégré.

Le harnais exécute Claude Code dans le projet sélectionné avec le plugin de ce dépôt. Les commandes et les agents restent dans le dépôt; aucun fichier n’est copié dans `~/.claude`.

## Configuration

L’installateur crée un `.env` local à partir de `.env.example`. Pour associer automatiquement les projets GitLab à leurs checkouts :

```dotenv
X_IMPLEMENT_REPOSITORIES='{"groupe/projet":"~/workspace/projet"}'
X_IMPLEMENT_SEARCH_ROOTS='~/workspace,~/code'
```

Le mapping exact est prioritaire. Sinon, le harnais inspecte les remotes Git des dossiers situés directement dans les racines de recherche. Le `.env` est ignoré par Git.

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

À la fin d’un run, le panneau de droite permet d’enregistrer un retour concret. Il est conservé localement avec l’identifiant du run et ses artefacts, puis traité avec :

```bash
ximpl improve
```

Cette commande lance Claude Code sur `/x-improve`. Il regroupe les retours en attente, vérifie les preuves du run, crée une branche `improve-rsi-*`, applique la plus petite amélioration durable, exécute les vérifications et crée un commit local. Il ne pousse rien et ne fusionne rien : le résultat reste inspectable et réversible.

Les tickets, logs et retours bruts restent sous `harness/data/` et ne sont jamais ajoutés au commit d’amélioration.

## Fonctionnement

Claude Code reste le moteur du workflow. Le harnais ajoute :

- un pseudo-terminal interactif relié à l’interface avec WebSocket;
- des hooks Claude Code pour suivre les agents, les outils et les demandes d’attention;
- une surveillance de `.claude/tasks/` pour suivre les étapes et conserver les rapports avant leur nettoyage.

Les données sont archivées dans `harness/data/runs/<run-id>/` :

- `run.json` contient l’état, les agents et l’activité;
- `terminal.log` contient la sortie brute du terminal;
- `artifacts/` contient les plans, rapports QA, revues et captures produits pendant le run.

Ce dossier est local et ignoré par Git. Il peut contenir des informations confidentielles provenant des tickets traités; il ne faut pas le partager.

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
