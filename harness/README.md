# X-Implement Harness

Interface locale pour piloter la commande `/x-implement` avec le véritable exécutable Claude Code. Le harnais n’utilise pas directement l’API Anthropic et ne demande aucune clé API.

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
claude --plugin-dir /chemin/vers/x-implement "/x-implement:x-implement <ticket>"
```

La commande et les agents restent dans le dossier `x-implement`; rien n’est installé dans `~/.claude`.

## Copier sur une autre machine

Copier ou cloner le dossier `x-implement` complet, puis exécuter les commandes d’installation ci-dessus dans `x-implement/harness`. Le chemin du dépôt traité est choisi dans l’interface, il peut donc être différent sur chaque machine.

## Données locales

Chaque exécution est conservée dans `harness/data/runs/<run-id>/` :

- `run.json` contient l’état, les agents et le journal d’activité;
- `terminal.log` contient la sortie brute du terminal;
- `artifacts/` reçoit une copie des rapports produits dans `.claude/tasks/` avant leur nettoyage.

Le dossier `data/` est ignoré par Git.
