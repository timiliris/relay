# Relay — client de bureau pour OpenRouter

Discutez avec tous les modèles disponibles via [OpenRouter](https://openrouter.ai) depuis une
application de bureau rapide et légère (**Windows / macOS / Linux**), construite avec Tauri 2.

## Fonctionnalités

**Chat**

- Réponses en **streaming** avec raisonnement repliable (modèles compatibles), arrêt, **régénération** et **continuation** d'une réponse coupée.
- **Édition d'un message** envoyé et **versions** alternatives navigables (« 2/3 ») : chaque conversation est un arbre, le chemin actif est affiché.
- **Pièces jointes** : images (collage, glisser-déposer, sélecteur) pour les modèles vision, PDF, fichiers texte et code inlinés dans le prompt.
- **Jauge de contexte** (estimation vs fenêtre du modèle), avertissements, **résumé automatique** des anciens messages à la demande.
- Rendu Markdown complet : coloration syntaxique, **LaTeX** (KaTeX), **diagrammes Mermaid** (chargés à la demande), copie des blocs de code.
- **Génération d'images** avec les modèles à sortie image d'OpenRouter : images affichées dans la bulle, conservées avec la conversation, enregistrables.
- **Régénérer avec un autre modèle** depuis une bulle : les versions restent côte à côte, chacune étiquetée par son modèle.
- Temps de réponse, tokens/seconde, tokens et coût par réponse, coût total par conversation ; **sauvegarde progressive** du texte pendant le flux (rien n'est perdu si l'app se ferme).

**Organisation**

- Historique SQLite groupé par date, **dossiers**, épinglage, **archivage**, renommage, titre automatique.
- **Recherche globale** (Ctrl+K) dans les titres et le contenu des messages, avec mise en évidence du message trouvé.
- **Personas** : instructions, modèle et paramètres appliqués en un clic (par conversation ou par défaut), plus une personnalité réglée par six curseurs (chaleur, humour, registre, longueur, créativité, initiative), un mode **jeu de rôle** (fiche de personnage, scénario, rôle du joueur, première réplique, narration, format) et un mode **18+** derrière une confirmation d'âge. Le tout est compilé en une instruction système lisible, visible en aperçu avant d'enregistrer ; neuf personas fournis au premier lancement (dont un maître du jeu), restaurables. Import de fiches **Character Card** V1/V2/V3 (JSON ou PNG, le format de SillyTavern) et export en V2 ; les gabarits `{{char}}` et `{{user}}` sont remplis automatiquement. Un pack de six personas 18+ (fiction pour adultes) s'ajoute depuis les paramètres, après confirmation d'âge, jamais automatiquement.
- **Mémoire du personnage** : un carnet de faits par persona (bouton « Mémoriser » sur une bulle, extraction par le modèle), injecté dans l'instruction système de chaque conversation qui l'utilise.
- **Outils de jeu de rôle** dans le composeur : bascule **HRP** (hors rôle), « **Jouer mon tour** » qui fait écrire la réplique du joueur par le modèle pour relecture, et **jets de dés** (d4 à d100, notation `2d6+3`).
- **Raccourcis de prompt** déclenchés par `/` (`/résume`, `/traduis`…, gabarits `{{selection}}` et `{{clipboard}}`, gérés dans les paramètres) et **messages épinglés** avec volet de navigation.
- **Comparaison** : même question envoyée à deux ou trois modèles côte à côte.
- Page **Usage** : dépenses et tokens par jour et par modèle.
- **Import** d'exports ChatGPT, Claude ou Relay ; export Markdown par conversation, export JSON complet.

**Modèles et OpenRouter**

- Catalogue complet avec recherche, filtres (favoris, vision, gratuits, raisonnement), favoris, modèles récents, prix par million de tokens.
- **Recherche web** (plugin OpenRouter) par conversation, **routage** par prix / débit / latence, fournisseurs exclus, refus des fournisseurs qui conservent les données.
- Paramètres de génération globaux ou **propres à chaque conversation**.
- Clé API dans le **trousseau système** (Windows Credential Manager, Keychain macOS, Secret Service Linux) : elle ne quitte jamais le processus Rust.

**Confort**

- Assistant de premier lancement, thème clair / sombre / système, **FR / EN**, taille de texte, couleur d'accent, densité, barre latérale redimensionnable, barres de défilement discrètes, animations (désactivées avec `prefers-reduced-motion`), dialogues intégrés (aucune boîte native).
- Raccourcis : Ctrl+N nouvelle conversation, Ctrl+K recherche, Ctrl+, paramètres, Échap pour arrêter, ↑ pour reprendre le dernier message.
- Barre de titre personnalisée, menu natif, icône de zone de notification, raccourci global, démarrage automatique, notification de fin de réponse, mises à jour automatiques.

| Couche      | Choix                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Shell natif | Tauri 2 (Rust, édition 2024), `reqwest` pour l'API, `keyring` pour la clé                        |
| UI          | React 19 + React Compiler, TypeScript 7, Vite 8, TanStack Router, react-markdown, KaTeX, Mermaid |
| Styles      | Tailwind CSS 4 (tokens OKLCH compatibles shadcn/ui)                                              |
| État        | Zustand (préférences persistées via `tauri-plugin-store`), SQLite via `tauri-plugin-sql`         |
| Qualité     | Biome 2, Vitest, Clippy, lefthook + commitlint, cargo-deny, Dependabot, release-please           |

## Démarrage

Prérequis : [Tauri](https://v2.tauri.app/start/prerequisites/) (Rust ≥ 1.90), Node.js ≥ 22, pnpm ≥ 10.

```bash
pnpm install
pnpm app:dev
```

Au premier lancement, l'assistant demande votre clé OpenRouter (`sk-or-v1-…`, à créer sur
[openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)) et le modèle par défaut.

## Scripts

| Script                                                         | Rôle                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm app:dev` / `pnpm app:build`                              | Développement / installeurs (`src-tauri/target/release/bundle`)    |
| `pnpm check`                                                   | Lint, types, tests frontend, Clippy, tests Rust                    |
| `pnpm rust:deny`                                               | Audit sécurité et licences des crates (`cargo install cargo-deny`) |
| `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored` | Test réseau réel contre l'API OpenRouter                           |

## Architecture

```
src/
├── router.tsx                 # /, /chat/:id, /compare, /usage, /settings, /welcome
├── pages/                     # chat, compare, usage, settings, onboarding
├── components/                # conversation-sidebar, composer, message-bubble, model-picker,
│                              # generation-params, preset-picker, search-palette, markdown, toaster, ui/
├── lib/chat-service.ts        # Envoi, édition, régénération, continuation, résumé, titre auto
├── lib/tree.ts                # Chemin actif dans l'arbre de messages (versions)
├── lib/attachments.ts         # Lecture des fichiers et parties de message multimodales
├── lib/context.ts             # Estimation de la taille du contexte
├── lib/import.ts              # Parsers ChatGPT / Claude / Relay
├── lib/openrouter.ts          # Wrappers typés des commandes Rust + normalisation des modèles
├── lib/db.ts                  # Accès SQLite (conversations, messages, dossiers, personas, recherche, usage)
├── stores/                    # settings, models (cache), conversations, chat (flux), api-key, toast
└── i18n/locales/{fr,en}.json  # Traductions (clés typées)

src-tauri/src/
├── openrouter/mod.rs          # Client HTTP : modèles, crédits, complétion, streaming SSE annulable,
│                              # options de routage et plugins (recherche web)
├── openrouter/sse.rs          # Analyseur SSE incrémental (testé)
├── secrets.rs                 # Clé API dans le trousseau système
├── commands/                  # openrouter.rs, secrets.rs, app.rs (langue, menu, lancement)
├── db.rs                      # Migrations SQLite (v1 conversations/messages, v2 arbre, dossiers, personas, v3 personnalité, v4 mémoire, v5 épingles)
└── menu.rs, tray.rs, shortcut.rs, i18n.rs
```

### Flux d'un message

1. `ChatPage` crée la conversation si besoin (`ensureConversation`) puis appelle `sendMessage`.
2. Le message utilisateur (texte + pièces jointes) est écrit en base sous le dernier message du chemin actif ;
   un message assistant vide est créé immédiatement (`finish_reason = streaming`).
3. `stream_chat` (Rust) lit le flux SSE d'OpenRouter et relaie chaque fragment via un `Channel`
   (`delta`, `reasoning`, `usage`, `done`, `error`) ; le texte partiel est sauvegardé toutes les 800 ms.
4. À la fin, la réponse est finalisée avec tokens, coût et durée ; un titre est généré pour le premier échange.

Éditer un message crée un **frère** (même parent) qui devient actif ; régénérer crée un frère de la réponse.
« Continuer » renvoie l'historique terminé par la réponse partielle, que le modèle prolonge.
L'arrêt (`cancel_stream`) annule la requête côté Rust ; ce qui a déjà été reçu est conservé.

## Données et confidentialité

- Conversations : `relay.db` dans le dossier app-config de l'OS (`%APPDATA%\io.github.timiliris.relay`,
  `~/Library/Application Support/io.github.timiliris.relay`, `~/.config/io.github.timiliris.relay`). Les pièces jointes
  (images, PDF en base64, texte) sont stockées dans la base.
- Préférences et cache des modèles : `settings.json`, `models-cache.json` au même endroit.
- Clé API : trousseau système uniquement. Export / import JSON depuis Paramètres → Données.
- Seul `openrouter.ai` est contacté, depuis Rust (CSP du webview sans `connect-src` externe).

## Personnaliser

- **Identité** : `productName` / `identifier` dans `src-tauri/tauri.conf.json` (et `tauri.macos.conf.json`), `name` dans `package.json` et `Cargo.toml` (`relay_lib` dans `Cargo.toml` et `main.rs`), `SERVICE` dans `secrets.rs`, `REFERER` / `TITLE` dans `openrouter/mod.rs`.
- **Modèle par défaut** : `DEFAULT_MODEL` dans `src/stores/settings.ts` (`openrouter/auto`).
- **Schéma** : ajouter une migration dans `src-tauri/src/db.rs` et adapter `src/lib/db.ts`.
- **Limites** : taille des pièces jointes (`MAX_ATTACHMENT_BYTES`) et extensions acceptées dans `src/lib/attachments.ts`.

## Distribution : identité, mises à jour, signature

- **Identifiant d'application** : `io.github.timiliris.relay` (dossiers de données, entrée du trousseau, instance unique). Les installations faites sous l'identifiant provisoire `com.example.relay` sont reprises automatiquement au premier lancement : base, préférences, cache des modèles, état de fenêtre et clé API (`src-tauri/src/migration.rs`, `secrets.rs`).
- **Mises à jour automatiques** : la clé publique de l'updater est en place dans `tauri.conf.json` et pointe sur les releases GitHub `timiliris/relay`. La clé privée correspondante est `~/.tauri/relay.key` sur le poste qui l'a générée : ajoutez son contenu dans le secret `TAURI_SIGNING_PRIVATE_KEY` du dépôt (clé sans mot de passe, laissez `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` vide) et conservez-la en lieu sûr, sans quoi les mises à jour ne pourront plus être signées.
- **Signature macOS** : secrets `APPLE_CERTIFICATE` (`.p12` en base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (mot de passe d'application), `APPLE_TEAM_ID` ; le CLI Tauri signe et notarise.
- **Signature Windows** : via [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) ; secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `TRUSTED_SIGNING_ENDPOINT`, `TRUSTED_SIGNING_ACCOUNT`, `TRUSTED_SIGNING_PROFILE`. Le workflow installe `trusted-signing-cli` et signe les installeurs quand ces secrets sont présents.

Sans secrets de signature, la release se construit quand même : les installeurs ne sont simplement pas signés (avertissement SmartScreen / Gatekeeper à l'installation).

## Vérification de bout en bout

La fiche complète des vérifications (automatisées et réelles, avec résultats) est dans [docs/QA.md](docs/QA.md).
`powershell -NoProfile -File scripts/verify-release.ps1` contrôle les signatures Authenticode et les artefacts d'updater d'un build.

- `pnpm test` couvre l'orchestration complète côté frontend (envoi, erreur d'API, édition avec versions, régénération, continuation) avec l'API et la base simulées.
- `cargo test` couvre le client Rust contre un serveur SSE local : flux complet, annulation immédiate, erreurs d'API mappées.
- `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored` exécute deux tests réels : liste des modèles, puis une réponse streamée par un modèle gratuit avec la clé lue dans le trousseau du système (la clé ne sort jamais du processus Rust).
- `RELAY_OPENROUTER_BASE_URL` permet de viser un autre serveur (proxy, environnement de test).

## Publication, mises à jour, CI

Hérité du template : CI sur PR (lint, types, tests, Clippy, cargo-deny, pnpm audit), **release-please** pour le changelog et le bump de version, **release multi-OS** sur tag, updater signé (secrets `TAURI_SIGNING_PRIVATE_KEY*`), signature macOS (secrets `APPLE_*`). Voir les commentaires dans `.github/workflows/*.yml`.

Le dépôt `timiliris/relay` est public et autorise les workflows à ouvrir des PR : release-please et l'updater
(qui lit `latest.json` sur la dernière release GitHub) fonctionnent sans réglage supplémentaire. La mise à jour
automatique 0.1.0 → 0.1.1 a été vérifiée de bout en bout sur Windows (voir `docs/QA.md`).

Cycle de publication : fusionner la PR « chore(main): release X.Y.Z » ouverte par release-please crée le tag et la
release GitHub, puis lance `release.yml` (via `workflow_dispatch`, car un tag créé avec `GITHUB_TOKEN` ne déclenche
aucun workflow). Reconstruire une release existante depuis `main` : `gh workflow run release.yml -f tag=vX.Y.Z`.

## Dépannage

- **Clé refusée (401)** : vérifiez la clé dans Paramètres ; les clés OpenRouter commencent par `sk-or-`.
- **Fournisseur indisponible (503 / 429)** : fréquent sur les modèles gratuits ; l'erreur s'affiche sous le composer, « Régénérer » relance, ou changez de modèle.
- **Modèle indisponible (404 / 400)** : la liste est mise en cache 6 h, utilisez « Actualiser la liste » dans le sélecteur.
- **« Continuer » repart de zéro** : certains fournisseurs ignorent le préremplissage de la réponse ; régénérez ou changez de modèle.
- **Images refusées** : le modèle n'accepte pas les images (filtre « Vision » dans le sélecteur).
- **Linux, trousseau** : nécessite un Secret Service actif (GNOME Keyring, KWallet via bridge).
- **Windows, chemins longs** : placez le projet dans un chemin court (`C:\dev\relay`) si `link.exe` ou Vitest échouent.
