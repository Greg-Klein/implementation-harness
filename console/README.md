# Implementation Harness

Interface locale pour piloter la commande `/implementation-harness:implement` avec le véritable exécutable Claude Code. Le harnais n’utilise pas directement l’API Anthropic et ne demande aucune clé API. Le [README principal](../README.md#application-de-bureau-electron) présente l’installation et l’usage quotidien de l’application de bureau.

## Prérequis

- Claude Code installé et connecté (`claude --version`)
- Node.js 22.12 ou plus récent
- `glab` installé et authentifié pour accéder aux tickets et merge requests GitLab
- les MCP utilisés par le workflow, notamment Playwright et Figma quand un ticket contient une maquette

`node-pty` est un module natif. Sur une nouvelle machine, son installation peut nécessiter les outils de compilation du système, par exemple Xcode Command Line Tools sur macOS.

## Application Electron

Depuis ce dossier :

```bash
npm install
npm run desktop:dev
```

Electron démarre le serveur Next.js et les WebSockets dans son propre processus Node, puis ouvre la fenêtre. Le serveur écoute uniquement sur `127.0.0.1`, sur un port libre. Aucun serveur ni navigateur n’est à lancer séparément. Les modifications de l’interface sont rechargées en développement ; après une modification du serveur ou du code Electron, relancer `desktop:dev`.

Sur macOS, les commandes `desktop:dev` et `desktop:start` préparent au premier lancement une copie locale du moteur dans `.desktop-runtime/`, avec le nom **Implementation Harness** dans la barre des menus. Cette copie est signée ad hoc pour le développement et recréée lors d’une mise à jour d’Electron ; elle ne demande aucun compte Apple et ne fait pas partie du paquet distribué. Le profil et les données de développement restent distincts de l’application installée.

Pour tester la version de production et fabriquer une application installable :

```bash
npm run desktop:build
npm run desktop:start
npm run desktop:pack       # application dans release/, sans installateur
npm run desktop:dist       # DMG et ZIP sur macOS, cible de la plateforme ailleurs
```

La version macOS est prévue pour macOS 13 ou plus récent. Construire sur l’architecture cible ; les cibles Windows et Linux sont configurées mais ne remplacent pas une validation sur ces systèmes. Node 22.12+ (24 LTS recommandé) est nécessaire pour développer ; l’application empaquetée embarque son runtime. Claude Code, Git, Node (pour les hooks du plugin), `glab` et les MCP restent des outils de la machine. Le PATH du shell de connexion est récupéré pour les lancements depuis le Finder.

Fonctions natives :

- « Parcourir les dossiers… » ouvre le sélecteur de dossier macOS/Windows/Linux.
- Les notifications système signalent les décisions et fins de runs lorsque la fenêtre n’a pas le focus ; cliquer ramène au run concerné. Les signaux sonores sont émis par l’interface selon son réglage, désactivé par défaut.
- Le badge du Dock compte les runs en attente d’attention ; la barre de progression indique une activité sur les systèmes qui la prennent en charge.
- `⌘N` / `Ctrl+N` ouvre un nouveau run. **Réglages…** (`⌘,` / `Ctrl+,`) ouvre une fenêtre dédiée avec les dossiers de recherche, le son, le parallélisme, Remote Control, l’auto-audit et les options avancées. Les menus donnent aussi accès aux données, au zoom et aux outils de développement.
- La taille, la position de fenêtre et le réglage sonore sont conservés. Une deuxième ouverture ramène à l’instance existante.
- Sur macOS, fermer la fenêtre la masque et laisse les runs continuer. « Quitter » propose d’arrêter les sessions encore ouvertes, ferme les terminaux et garde la file pour le prochain démarrage.

Dans l’application empaquetée, les données sont dans le dossier utilisateur Electron : sur macOS, `~/Library/Application Support/Implementation Harness/data/`. Le menu de l’application permet d’ouvrir ce dossier. La fenêtre **Réglages…** enregistre la configuration dans le `.env` voisin, sans ouvrir d’éditeur. Les journaux de démarrage sont dans `logs/server.log`. En développement, les données restent dans `console/data/`, la configuration dans le `.env` du dépôt, et les préférences Electron utilisent un profil séparé.

**Enregistrer** vérifie les valeurs et préserve les clés et commentaires existants. **Redémarrer l’application** applique les changements après confirmation si des sessions sont ouvertes ; le son est appliqué immédiatement. Les valeurs imposées dans l’environnement de lancement sont verrouillées. Une modification externe du fichier est détectée avant toute écriture, et les modifications non enregistrées sont signalées à la fermeture. Les valeurs étrangères aux réglages de l’application ne sont jamais transmises à la fenêtre.

Les variables d’environnement de lancement `IMPL_DATA_DIR` et `IMPL_ENV_FILE` permettent de choisir d’autres chemins absolus. `IMPL_DESKTOP_USER_DATA` permet d’isoler le profil Electron. Le plugin est livré avec l’application ; l’auto-amélioration de son code nécessite toutefois un dépôt Git modifiable, à désigner avec `IMPL_PLUGIN_ROOT`. Sans ce dépôt, les retours sont enregistrés mais aucun auto-audit ne modifie le paquet installé. Les réglages de port et d’interface réseau de la console web ne s’appliquent pas à Electron.

Le renderer est sandboxé, sans Node, avec isolation de contexte. Le preload n’expose que les fonctions natives nécessaires et les appels sont contrôlés côté processus principal. Les liens HTTP(S) externes s’ouvrent dans le navigateur par défaut. Les données locales, `.env`, fichiers de tests et caches ne font pas partie du paquet.

### Signature Developer ID et notarisation

Avec un certificat **Developer ID Application** et sa clé privée dans le trousseau :

```bash
security find-identity -v -p codesigning
npm run desktop:dist:signed
```

Cette commande exige une signature valide et produit un DMG et un ZIP avec Hardened Runtime. `CSC_NAME` permet de choisir un certificat si plusieurs sont disponibles. Sans profil de notarisation, le résultat est signé mais pas notarisé.

Pour enregistrer les identifiants Apple dans le trousseau, utiliser l’invite interactive de `notarytool` dans son propre terminal (ne pas mettre de secret dans `.env`, le dépôt ou une conversation) :

```bash
xcrun notarytool store-credentials "implementation-harness"
IMPL_NOTARY_PROFILE="implementation-harness" npm run desktop:dist:signed
```

Le hook envoie l’application signée à Apple, attend le statut `Accepted`, puis agrafe et valide le ticket avant la création des installateurs. Un rejet fait échouer la construction. Les signatures et le ticket peuvent être vérifiés avec `codesign --verify --deep --strict` et `xcrun stapler validate` sur le chemin du `.app`.

### Tests Electron

```bash
npm run test:desktop:policy
npm run desktop:build
npm run test:desktop
# Facultatif : tester le .app empaqueté au lieu des sources.
IMPL_DESKTOP_EXECUTABLE="/chemin/Implementation Harness.app/Contents/MacOS/Implementation Harness" npm run test:desktop
```

Les tests utilisent des données temporaires et un faux exécutable Claude : aucun vrai ticket n’est traité. Ils vérifient le choix natif d’un dossier, les préférences, les réglages (validation, sauvegarde, conflit, fermeture et redémarrage), le parcours de démonstration, les notifications cliquables, un vrai PTY avec retour de hook et la fermeture du serveur. Les notifications sont interceptées dans le test ; leur autorisation d’affichage reste gérée par macOS pour l’application installée.

## Lancer la console web

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

Au démarrage, le serveur referme tout run resté sur un statut non terminal (`starting`, `running`, `attention`) : `ctx.state` repart vide à chaque lancement, donc un run que le processus précédent n'a pas pu clore lui-même (arrêt brutal, `impl restart`) resterait sinon marqué "running" indéfiniment. Il est reclassé "failed" avec un message l'expliquant, distinct d'un échec de l'agent.
