# Relay — client de bureau pour OpenRouter

Discutez avec tous les modèles disponibles via [OpenRouter](https://openrouter.ai) depuis une
application de bureau rapide et légère (**Windows / macOS / Linux**), construite avec Tauri 2.

## Fonctionnalités

- **Chat en streaming** avec affichage du raisonnement (modèles compatibles), arrêt, régénération, copie et suppression de messages.
- **Historique** local (SQLite) : conversations groupées par date, recherche, épinglage, renommage, titre automatique, export Markdown.
- **Catalogue de modèles** OpenRouter : recherche, favoris, modèles récents, prix par million de tokens, taille de contexte.
- **Paramètres de génération** : température, top-p, tokens max, instruction système (globale ou par conversation).
- **Coûts et tokens** affichés par réponse et par conversation ; **crédits** du compte dans les paramètres.
- **Clé API dans le trousseau système** (Gestionnaire d'identifiants Windows, Trousseau macOS, Secret Service Linux) : elle ne quitte jamais le processus Rust.
- Thème clair / sombre / système, **FR / EN**, barre de titre personnalisée, menu natif, icône de zone de notification, raccourci global, démarrage automatique, notification de fin de réponse, mises à jour automatiques.

| Couche      | Choix                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------- |
| Shell natif | Tauri 2 (Rust, édition 2024), `reqwest` pour l'API, `keyring` pour la clé                |
| UI          | React 19 + React Compiler, TypeScript 7, Vite 8, TanStack Router, react-markdown         |
| Styles      | Tailwind CSS 4 (tokens OKLCH compatibles shadcn/ui)                                      |
| État        | Zustand (préférences persistées via `tauri-plugin-store`), SQLite via `tauri-plugin-sql` |
| Qualité     | Biome 2, Vitest, Clippy, lefthook + commitlint, cargo-deny, Dependabot, release-please   |

## Démarrage

Prérequis : [Tauri](https://v2.tauri.app/start/prerequisites/) (Rust ≥ 1.90), Node.js ≥ 22, pnpm ≥ 10.

```bash
pnpm install
pnpm app:dev
```

Au premier lancement, ouvrez **Paramètres** et collez votre clé OpenRouter
(`sk-or-v1-…`, à créer sur [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)).
« Tester la connexion » affiche les crédits restants.

## Scripts

| Script                            | Rôle                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| `pnpm app:dev` / `pnpm app:build` | Développement / installeurs (`src-tauri/target/release/bundle`)    |
| `pnpm check`                      | Lint, types, tests frontend, Clippy, tests Rust                    |
| `pnpm rust:deny`                  | Audit sécurité et licences des crates (`cargo install cargo-deny`) |
| `pnpm app:icon`                   | Régénère les icônes depuis `src-tauri/icons/source.svg`            |

## Architecture

```
src/
├── router.tsx                 # / (nouvelle conversation), /chat/:id, /settings
├── pages/chat.tsx             # Écran de chat : messages, streaming, composer, export
├── pages/settings.tsx         # Clé API, crédits, valeurs par défaut, apparence, données
├── components/                # conversation-sidebar, model-picker, composer, message-bubble, markdown…
├── lib/chat-service.ts        # Orchestration d'un échange (persistance, streaming, titre auto)
├── lib/openrouter.ts          # Wrappers typés des commandes Rust + normalisation des modèles
├── lib/db.ts                  # Accès SQLite (conversations, messages, export)
├── stores/                    # settings, models (cache), conversations, chat (flux), api-key
└── i18n/locales/{fr,en}.json  # Traductions (clés typées)

src-tauri/src/
├── openrouter/mod.rs          # Client HTTP : modèles, crédits, complétion, streaming SSE annulable
├── openrouter/sse.rs          # Analyseur SSE incrémental (testé)
├── secrets.rs                 # Clé API dans le trousseau système
├── commands/                  # openrouter.rs, secrets.rs, app.rs (langue, menu, lancement)
├── db.rs                      # Migrations SQLite
└── menu.rs, tray.rs, shortcut.rs, i18n.rs
```

### Flux d'un message

1. `ChatPage` crée la conversation si besoin (`ensureConversation`) puis appelle `sendMessage`.
2. Le message utilisateur est écrit en base ; `runAssistant` invoque la commande Rust `stream_chat` avec l'historique.
3. Rust lit le flux SSE d'OpenRouter et relaie chaque fragment via un `Channel` (`delta`, `reasoning`, `usage`, `done`, `error`).
4. À la fin, la réponse est persistée avec tokens et coût, la conversation remonte dans l'historique, et un titre est généré pour le premier échange.

L'arrêt (`cancel_stream`) annule la requête côté Rust via un `CancellationToken` ; ce qui a déjà été reçu est conservé.

## Données et confidentialité

- Conversations : `relay.db` dans le dossier app-config de l'OS (`%APPDATA%\com.example.relay`, `~/Library/Application Support/com.example.relay`, `~/.config/com.example.relay`).
- Préférences et cache des modèles : `settings.json`, `models-cache.json` au même endroit.
- Clé API : trousseau système uniquement. Export JSON complet depuis Paramètres → Données.
- Seul `openrouter.ai` est contacté, depuis Rust (CSP du webview sans `connect-src` externe).

## Personnaliser

- **Identité** : `productName` / `identifier` dans `src-tauri/tauri.conf.json` (et `tauri.macos.conf.json`), `name` dans `package.json` et `Cargo.toml` (`relay_lib` dans `Cargo.toml` et `main.rs`), `SERVICE` dans `secrets.rs`, `REFERER` / `TITLE` dans `openrouter/mod.rs`.
- **Modèle par défaut** : `DEFAULT_MODEL` dans `src/stores/settings.ts` (`openrouter/auto` par défaut).
- **Schéma** : ajouter une migration dans `src-tauri/src/db.rs` et adapter `src/lib/db.ts`.

## Publication, mises à jour, CI

Hérité du template : CI sur PR (lint, types, tests, Clippy, cargo-deny, pnpm audit), **release-please** pour le changelog et le bump de version, **release multi-OS** sur tag, updater signé (secrets `TAURI_SIGNING_PRIVATE_KEY*`), signature macOS (secrets `APPLE_*`). Voir les commentaires dans `.github/workflows/*.yml`.

## Dépannage

- **Clé refusée (401)** : vérifiez la clé dans Paramètres ; les clés OpenRouter commencent par `sk-or-`.
- **Modèle indisponible (404 / 400)** : la liste est mise en cache 6 h, utilisez « Actualiser la liste » dans le sélecteur.
- **Linux, trousseau** : nécessite un Secret Service actif (GNOME Keyring, KWallet via bridge).
- **Windows, chemins longs** : placez le projet dans un chemin court (`C:\dev\relay`) si `link.exe` ou Vitest échouent.
