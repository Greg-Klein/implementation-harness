# Implementation Harness

Implementation Harness est une interface locale pour piloter Claude Code pendant l’implémentation d’un ticket GitLab. On colle l’URL du ticket, le harnais détecte le checkout correspondant, ouvre un terminal Claude Code et rend visibles la progression, les agents, les outils et les livrables.

Le dépôt contient un plugin Claude Code dont la commande `/implementation-harness:implement` orchestre le travail : lecture du ticket, questions de clarification, planification, implémentation, tests, revues spécialisées et préparation de la merge request. Le harnais constitue la couche visuelle de cette commande. Il utilise la connexion Claude Code déjà présente sur la machine et ne fait aucun appel direct à l’API Anthropic.

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

La même commande met à jour une installation existante avec un `git pull --ff-only`. L’installation compile l’interface Next.js, puis `impl` lance cette version de production.

L’installateur télécharge les dépendances et crée deux commandes dans `~/.local/bin` :

- `impl`, l’alias court;
- `implementation-harness`, le nom explicite.

Si `~/.local/bin` n’est pas encore dans `PATH`, l’installateur affiche la ligne à ajouter à la configuration du shell.

## Utilisation

```bash
impl
```

| Commande | Effet |
|---|---|
| `impl` | démarre l’interface et ouvre le navigateur |
| `impl demo` | démarre l’interface sur un scénario simulé |
| `impl restart` | arrête le serveur en cours puis relance la version compilée |
| `impl stop` | arrête le serveur en cours |
| `impl status` | indique si un serveur écoute et s’il sert le build sur disque |
| `impl config` | lit et modifie la configuration locale |
| `impl improve` | traite les retours d’auto-amélioration avec Claude Code |
| `impl help` | affiche l’aide |

Une commande inconnue est refusée avec l’aide et un code de sortie non nul, plutôt que de démarrer le serveur en silence.

`impl status` ne se contente pas de chercher un processus. Il interroge `/api/state`, puis demande au serveur chaque ressource `/_next/static/` que la page référence. Un serveur qui tourne encore sur un build précédent répond avec un manifeste dont les fichiers ont été effacés par la recompilation, et c’est ce qui produit une page sans style. Ses codes de sortie : `0` en écoute et cohérent, `1` en écoute mais incohérent, `3` arrêté.

```console
$ impl status
Serveur   : en écoute sur http://127.0.0.1:3210 (PID 76579)
Build     : caiz9bak8t_BsOXSZHCmN sur disque
API       : répond
Ressources: 11 servies, build à jour
```

Pour découvrir l’interface sans ticket ni appel à Claude Code :

```bash
impl demo
```

Cette commande ouvre un scénario local simulé avec progression, agents, documents générés et décisions interactives. Chaque étape dure cinq secondes. La première review demande des corrections, renvoie le travail à l’agent d’implémentation, puis une seconde review valide les changements. Elle ne modifie aucun dépôt, ne contacte pas GitLab et n’alimente pas la boucle d’auto-amélioration. Le mode démo n’ajoute aucun contrôle à l’interface normale : la validation des améliorations et le champ de retour sont affichés comme en usage réel, marqués `démo`, et leurs actions restent simulées.

Pour redémarrer un serveur déjà lancé :

```bash
impl restart
```

`impl` détecte un harnais déjà en écoute et se contente d’ouvrir le navigateur. Après une recompilation de l’interface, le serveur en cours sert encore l’ancien manifeste Next.js et les feuilles de style renvoient une erreur : la page s’affiche alors sans aucun style. `impl restart` arrête le serveur du port courant, attend la libération du port et relance la version compilée. Il se combine avec le mode démo (`impl restart demo`) et n’arrête rien si son argument est invalide.

Le navigateur s’ouvre sur <http://127.0.0.1:3210>. Dans l’interface :

1. coller l’URL du ticket GitLab;
2. vérifier le projet détecté ou renseigner son chemin;
3. ajouter si nécessaire une instruction propre à cette exécution;
4. lancer le workflow et répondre aux décisions dans le panneau dédié ou échanger librement dans le terminal.

Le bouton **Documents générés** ouvre un lecteur intégré pour consulter le contexte du ticket, les plans, rapports de tests, reviews et descriptions de MR conservés pendant le run.

Le lecteur n’interrompt pas l’exécution. Si Claude Code pose une question pendant sa consultation, un bandeau signale la décision attendue et le bouton **Répondre** referme le lecteur pour afficher la carte de clarification.

Le panneau de progression récapitule le livrable du run : le ticket, la branche de travail dès que le workflow la crée, et la merge request dès qu’elle est ouverte. Le ticket et la merge request sont cliquables, la branche est là pour être relue. La merge request est lue dans la sortie de la commande qui l’ouvre, donc elle apparaît sans que le workflow ait à la déclarer.

Un run dure longtemps et n’a pas à être surveillé. Le titre de l’onglet et son icône suivent l’état du run, et le navigateur envoie une notification système quand une décision attend une réponse, quand la session réclame de l’attention et quand le run se termine. La permission est demandée au premier lancement, et une notification ne part que si la page n’est pas au premier plan : tant qu’elle est visible, l’interface suffit.

Le bouton haut-parleur de l’en-tête ajoute un signal sonore aux mêmes trois moments : une montée à deux notes quand quelque chose est attendu de toi, une résolution à trois notes quand le run est fini. Il est **coupé par défaut** et le réglage est mémorisé dans le navigateur. L’activer joue le signal tout de suite, pour que le réglage se prouve sans attendre un run.

Le son vient de l’interface, pas du modèle, et c’est ce qui le rend juste : il part à l’instant exact où la question devient bloquante, alors qu’un son demandé au modèle arrivait en avance et pouvait être oublié. Deux réserves à connaître : un navigateur interdit à une page d’émettre du son avant une interaction, donc le tout premier signal d’une session ouverte sans un clic reste muet, et deux onglets ouverts sur le harnais sonnent deux fois.

Le harnais exécute Claude Code dans le projet sélectionné avec le plugin de ce dépôt. Les commandes et les agents restent dans le dépôt; aucun fichier n’est copié dans `~/.claude`.

Quand Claude Code utilise `AskUserQuestion`, le harnais présente les décisions dans un panneau dédié : les choix suggérés peuvent remplir la réponse, qui reste éditable dans un champ de texte avant son envoi. La réponse est transmise à Claude Code par le hook en attente. Le terminal intégré reste visible et interactif pendant toute l’exécution pour les échanges libres et les commandes qui ne passent pas par ce panneau.

## Configuration

Tout se règle avec une seule commande, sans savoir où vit le fichier :

```bash
impl config
```

L’assistant parcourt chaque réglage, affiche la valeur courante entre crochets, garde cette valeur si on appuie sur Entrée, refuse une saisie invalide et propose de redémarrer le serveur quand un changement l’exige. Il écrit un `.env` local, ignoré par Git.

Pour les usages rapides ou scriptés :

| Commande | Effet |
|---|---|
| `impl config list` | valeur effective de chaque réglage et sa provenance |
| `impl config get CLÉ` | une valeur seule, sur la sortie standard |
| `impl config set CLÉ=VALEUR` | écrit un réglage sans passer par l’assistant |
| `impl config path` | chemin du `.env` |
| `impl config edit` | ouvre le `.env` dans `$EDITOR`, puis le vérifie |
| `impl config check` | vérifie la configuration, sort en 1 si elle est cassée |

Les réglages disponibles :

| Variable | Effet | Défaut |
|---|---|---|
| `IMPL_SEARCH_ROOTS` | racines où chercher les checkouts, séparées par des virgules | `~/workspace` |
| `IMPL_SELF_IMPROVEMENT_AUTORUN` | auto-audit à la fin de chaque run | `false` |
| `IMPL_PORT` | port d’écoute | `3210` |
| `IMPL_HOST` | interface d’écoute | `127.0.0.1` |
| `IMPL_NO_OPEN` | `1` pour démarrer sans ouvrir le navigateur | `0` |
| `IMPL_DEMO_STEP_MS` | durée d’une étape du mode démo | `5000` |

Une variable posée dans le shell l’emporte sur le `.env`, qui l’emporte sur le défaut. Un réglage ponctuel ne demande donc aucune écriture :

```bash
IMPL_PORT=4321 impl
IMPL_NO_OPEN=1 impl
```

### Détection du projet

Le harnais parcourt les racines de recherche jusqu’à deux niveaux de profondeur, lit le `.git/config` de chaque dossier et en déduit le projet GitLab. Après collage d’un ticket, le chemin détecté remplit le champ projet s’il est vide. Ce champ reste éditable et propose les checkouts découverts pendant la saisie. Un dépôt qui vit ailleurs se rend visible en ajoutant son dossier parent à `IMPL_SEARCH_ROOTS`.

## Boucle d’auto-amélioration

À la fin d’un run, le panneau de droite permet d’enregistrer un retour concret. Il est conservé localement avec l’identifiant du run et ses documents générés, puis traité avec :

```bash
impl improve
```

Cette commande lance Claude Code sur `/implementation-harness:improve`. Il regroupe les retours en attente, vérifie les preuves du run, crée une branche `self-improvement-*`, applique la plus petite amélioration durable, exécute les vérifications et crée un commit local. Il ne pousse rien et ne fusionne rien : le résultat reste inspectable et réversible.

Les tickets, logs et retours bruts restent sous `console/data/` et ne sont jamais ajoutés au commit d’amélioration.

Le harnais peut également se critiquer sans retour humain. À la fin de chaque workflow, y compris après un échec ou un arrêt manuel, il enregistre un auto-audit portant sur les échecs, interventions, boucles de revue, documents manquants et vérifications incomplètes. En mode autonome, Claude Code traite cette preuve dans un worktree isolé. Un signal auto-généré doit apparaître sur au moins deux runs, sauf bug déterministe ou défaut de sécurité.

La politique se règle avec `impl config`, ou directement :

```bash
impl config set IMPL_SELF_IMPROVEMENT_AUTORUN=true
```

Elle lance l’analyse en arrière-plan à la fin du run. L’option vaut `false` par défaut; il faut l’activer consciemment.

L’agent travaille dans un worktree isolé et laisse toujours son commit sur sa branche `self-improvement-*`. Rien n’est fusionné automatiquement et rien n’est poussé sur GitHub. Le panneau de droite affiche le diff : c’est la seule porte de promotion. Après une fusion, redémarrer le harnais avec `impl restart` pour charger les changements du serveur local.

## Fonctionnement

Claude Code reste le moteur du workflow. Le harnais ajoute :

- un pseudo-terminal interactif relié à l’interface avec WebSocket;
- des hooks Claude Code pour suivre les agents et les outils, puis présenter et résoudre les questions structurées dans l’interface;
- une surveillance de `.claude/tasks/` pour suivre les étapes et conserver les rapports avant leur nettoyage.

### La couche moteur

Tout ce qui est propre à Claude Code, l’exécutable, le vocabulaire de hooks, le format du transcript, la façon de soumettre une instruction, vit dans `console/server/engine/`. Le reste du serveur raisonne en runs, phases, agents et documents, sans savoir quel agent tourne dessous.

Il y a une implémentation aujourd’hui, `claude-code`, et c’est délibéré : l’intérêt de la frontière n’est pas d’en avoir deux, c’est qu’en écrire une deuxième soit un fichier et non une réécriture. Le mécanisme le plus spécifique du harnais, la question qui bloque l’agent jusqu’à la réponse de l’utilisateur, a été prouvé portable avant que cette couche soit écrite.

`console/server/engine/README.md` documente le contrat membre par membre, le chemin complet d’une question bloquante, et ce qui reste couplé en dehors du serveur.

Les données sont archivées dans `console/data/runs/<run-id>/` :

- `run.json` contient l’état, les agents et l’activité;
- `terminal.log` contient la sortie brute du terminal;
- `artifacts/` contient les documents générés pendant le run : plans, rapports QA, reviews et captures.

Ce dossier est local et ignoré par Git. Il peut contenir des informations confidentielles provenant des tickets traités; il ne faut pas le partager.

## Tests

Depuis le dossier `console/` :

```bash
npm run test:unit
npm run test:integration
```

Les tests unitaires utilisent Jest. Ils sont séparés par responsabilité dans `tests/unit/` et suivent la convention `describe(...)` puis `it("should ...")`.

Les tests d’intégration sont répartis par parcours dans `tests/integration/`. Ils utilisent Playwright avec Google Chrome et démarrent un serveur isolé sur le port `3211`. Pour observer leur exécution :

```bash
npm run test:integration:headed
```

GitHub Actions exécute le contrôle TypeScript, les tests unitaires, le build de production et les tests d’intégration à chaque pull request et à chaque push sur `main`.

## Développement

```bash
cd console
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
commands/     commandes /implementation-harness:implement, /implementation-harness:review et /implementation-harness:improve
hooks/        événements envoyés au harnais local
bin/          lanceur impl et commande impl config
console/      interface Next.js et serveur PTY
console/server/engine/  la couche qui isole l'agent piloté, une implémentation : claude-code
install.sh    installation et création des commandes globales
install-remote.sh  clone ou mise à jour depuis la commande curl
```

Selon le ticket, `/implementation-harness:implement` peut aussi utiliser Playwright et Figma. Un MCP absent réduit les vérifications correspondantes mais n’empêche pas le harnais de démarrer.

## Licence

Implementation Harness est distribué sous [licence MIT](LICENSE). Copyright © 2026 Gregory Klein.
