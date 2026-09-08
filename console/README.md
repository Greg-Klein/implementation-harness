# Implementation Harness

Interface locale pour piloter la commande `/implementation-harness:implement` avec le véritable exécutable Claude Code. Le harnais n’utilise pas directement l’API Anthropic et ne demande aucune clé API.

## Prérequis

- Claude Code installé et connecté (`claude --version`)
- Node.js 22 ou plus récent
- `glab` installé et authentifié pour accéder aux tickets et merge requests GitLab
- les MCP utilisés par le workflow, notamment Playwright et Figma quand un ticket contient une maquette

`node-pty` est un module natif. Sur une nouvelle machine, son installation peut nécessiter les outils de compilation du système, par exemple Xcode Command Line Tools sur macOS.

## Lancer l’application

Depuis ce dossier :

```bash
npm install
npm run dev
```

Puis ouvrir <http://127.0.0.1:3210>.

Renseigner le chemin local du projet et l’URL du ticket. Le harnais démarre Claude Code dans ce projet avec le plugin voisin :

```bash
claude --plugin-dir /chemin/vers/implementation-harness "/implementation-harness:implement <ticket>"
```

La commande et les agents restent dans le dossier `implementation-harness`; rien n’est installé dans `~/.claude`.

## Ce que montrent les panneaux

Le panneau de discussion est lu dans le transcript de la session, et Claude Code n’y écrit un message qu’une fois revenue l’action qui l’a suivi. Un paragraphe peut donc y arriver avec une minute de retard sur le terminal, qui est la seule vue vraiment live. Tant que la session produit de la sortie, le panneau affiche « Claude écrit… » pour dire que le dernier message visible n’est pas le dernier état du run.

Le flux d’activité ne garde que les jalons du workflow : agents, documents, branche, merge request, décisions attendues. Le détail des commandes reste dans le terminal.

Le harnais ne réclame l’attention que quand il est vraiment arrêté : une décision attendue, une demande de permission, un tour terminé sans agent en cours, la fin ou l’échec du run.

## Architecture du serveur

| Module | Rôle |
|---|---|
| `server/index.ts` | serveur HTTP et WebSocket, cycle de vie du run |
| `server/engine/` | **la seule partie qui sait quel agent est piloté** (voir son README) |
| `server/hooks.ts` | applique les événements du moteur à l’état du run |
| `server/transcript.ts` | suit le fichier de dialogue de la session |
| `server/artifacts.ts` | archive les documents produits avant leur nettoyage |
| `server/self-improvement.ts` | retours, auto-audit et boucle d’amélioration |
| `server/domain.ts` | logique pure, sans agent ni système de fichiers |

`server/domain.ts` et `server/engine/` sont les deux endroits testables sans rien lancer, et c’est là que vit l’essentiel de la logique.

## Copier sur une autre machine

Copier ou cloner le dossier `implementation-harness` complet, puis exécuter les commandes d’installation ci-dessus dans `implementation-harness/console`. Le chemin du dépôt traité est choisi dans l’interface, il peut donc être différent sur chaque machine.

## Données locales

Chaque exécution est conservée dans `console/data/runs/<run-id>/` :

- `run.json` contient l’état, les agents et le journal d’activité;
- `terminal.log` contient la sortie brute du terminal;
- `artifacts/` reçoit une copie des documents produits dans `.claude/tasks/` avant leur nettoyage. Seuls les documents lisibles y sont copiés : les captures et les assets téléchargés restent dans le dépôt, sous `.claude/tasks/assets/`.

Le dossier `data/` est ignoré par Git.
