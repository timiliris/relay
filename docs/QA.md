# Fiche de vérification — Relay 0.5.0

Dernière exécution complète : 31 octobre 2026, Windows 11, Rust 1.91, Node 24, pnpm 12.

## Automatisé (à chaque PR via la CI, reproductible avec `pnpm check`)

| Vérification                    | Commande                                | Résultat                                       |
| ------------------------------- | --------------------------------------- | ---------------------------------------------- |
| Lint et format                  | `pnpm lint` (Biome 2)                   | 0 erreur, 0 avertissement                      |
| Types                           | `pnpm typecheck` (TypeScript 7, strict) | OK                                             |
| Tests frontend                  | `pnpm test` (Vitest)                    | 31 tests, 9 fichiers                           |
| Tests Rust                      | `pnpm rust:test`                        | 12 tests (+ 2 tests réseau ignorés par défaut) |
| Clippy                          | `pnpm rust:lint` (`-D warnings`)        | OK                                             |
| Sécurité et licences des crates | `pnpm rust:deny` (cargo-deny)           | advisories, bans, licences, sources : OK       |
| Vulnérabilités npm              | `pnpm audit --audit-level high`         | aucune                                         |
| Parité des traductions          | script de comparaison FR / EN           | 308 clés identiques                            |

Couverture fonctionnelle des tests :

- **Arbre de messages** : chemin actif, versions, repli sur le dernier frère.
- **Orchestration du chat** (API et base simulées) : envoi et persistance (contenu, raisonnement, tokens, coût, durée, parent), erreur d'API sans message vide, édition créant une version active, régénération, continuation avec préremplissage.
- **Client Rust** contre un serveur SSE local : flux complet, annulation immédiate pendant un flux lent, erreur 401 mappée (statut + message), sérialisation des options OpenRouter et du contenu multimodal.
- **Pièces jointes** : détection des types, limites de taille, parties multimodales, inlining des fichiers texte.
- **Import** : exports ChatGPT (chemin actif de l'arbre), Claude, Relay.
- **Contexte** : estimation et seuils ; **personas** par défaut ; **migration** des données.

## Réel (exécuté manuellement, résultats observés)

| Scénario                                | Méthode                                                                                                  | Résultat                                                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Liste des modèles depuis l'API          | `cargo test -- --ignored fetch_models_live`                                                              | 456 modèles reçus                                                                                                                                                                                                  |
| Streaming réel avec la clé du trousseau | `cargo test -- --ignored stream_chat_live`                                                               | Réponse « OK » streamée par `dots-studio/dots-3-note-preview:free`, usage renvoyé ; trois modèles gratuits indisponibles (503, 429) correctement remontés avant                                                    |
| Lancement de l'app en développement     | `pnpm app:dev`                                                                                           | Migrations SQLite, trousseau, modèles, menus, tray, raccourci : OK (journal)                                                                                                                                       |
| Migration d'identifiant                 | restart de l'app après passage à `io.github.timiliris.relay`                                             | 14 fichiers repris, base intacte (2 migrations déjà appliquées), clé API déplacée dans le trousseau (journal de l'instance de développement)                                                                       |
| Build de release                        | `pnpm app:build`                                                                                         | `Relay_0.1.0_x64_en-US.msi` (6,6 Mo), `Relay_0.1.0_x64-setup.exe` (5,5 Mo)                                                                                                                                         |
| Signature des installeurs               | build avec `bundle.windows.signCommand` (signtool, certificat de test) puis `scripts/verify-release.ps1` | MSI et NSIS signés (signataire présent ; chaîne non approuvée car certificat de test)                                                                                                                              |
| Artefacts d'updater                     | build avec `TAURI_SIGNING_PRIVATE_KEY`                                                                   | `.sig` minisign produits pour le MSI et le NSIS                                                                                                                                                                    |
| Détection de mise à jour en production  | build signé avec endpoint local, `latest.json` 0.1.1 servi en HTTP local                                 | Démarrage en mode production (`tauri.localhost`), reprise des données, « Mise à jour disponible : 0.1.1 » dans le journal 3 s après le lancement                                                                   |
| Interface                               | audit dans le navigateur (données de démo) en clair et sombre, 1000 × 620                                | Accueil, conversation (code, tableau, LaTeX, Mermaid, pièces jointes, versions), menus en portail, modales intégrées, palette Ctrl+K, Paramètres, Comparer, Usage, Bienvenue : aucun défaut, aucune erreur console |

## Release de production (31 octobre 2026)

| Étape            | Résultat                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Dépôt            | `timiliris/relay` (créé privé, passé en public le 31 octobre), `main` poussé, secret `TAURI_SIGNING_PRIVATE_KEY` enregistré               |
| CI sur `main`    | Frontend (lint, types, tests, build), Rust (fmt, clippy, tests), Sécurité (cargo-deny, pnpm audit) : succès                               |
| Release `v0.1.0` | https://github.com/timiliris/relay/releases/tag/v0.1.0                                                                                    |
| Windows          | `Relay_0.1.0_x64_en-US.msi`, `Relay_0.1.0_x64-setup.exe` + `.sig`                                                                         |
| Linux            | `Relay_0.1.0_amd64.deb`, `Relay-0.1.0-1.x86_64.rpm`, `Relay_0.1.0_amd64.AppImage` + `.sig`                                                |
| macOS            | `Relay_0.1.0_aarch64.dmg`, `Relay_0.1.0_x64.dmg`, `Relay_aarch64.app.tar.gz`, `Relay_x64.app.tar.gz` + `.sig`                             |
| `latest.json`    | 11 cibles (windows, linux, darwin aarch64 et x86_64), signatures minisign dont l'identifiant de clé correspond à la clé publique de l'app |

Incident corrigé pendant la mise en production : une variable `APPLE_CERTIFICATE` vide faisait échouer la signature macOS ;
le workflow n'exporte désormais les secrets de signature que s'ils sont renseignés, et accepte une relance manuelle par tag.

Réglages effectués ensuite : dépôt passé en public (l'updater atteint `latest.json` sans jeton) et « Allow GitHub Actions
to create and approve pull requests » activé (release-please ouvrira sa PR au prochain commit `feat`/`fix`). Reste à la
charge de l'éditeur : les certificats de signature de production (différés).

## Mise à jour automatique réelle 0.1.0 → 0.1.1 (31 octobre 2026)

| Étape                     | Résultat                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release `v0.1.1`          | https://github.com/timiliris/relay/releases/tag/v0.1.1 — 17 artefacts (installeurs, `.sig`, `latest.json`) ; installation automatique des mises à jour activée dans l'app                          |
| Build témoin 0.1.0        | build de release local, identifiant `io.github.timiliris.relay.e2e`, même clé publique d'updater, endpoint de production `https://github.com/timiliris/relay/releases/latest/download/latest.json` |
| Lancement `--auto-update` | journal : « Mise à jour disponible : 0.1.1 » → « Téléchargement de la mise à jour 0.1.1 » → « Mise à jour 0.1.1 installée, redémarrage »                                                           |
| Vérification              | `C:\Program Files\Relay\relay.exe` en version produit 0.1.1 ; registre Windows `DisplayName: Relay`, `DisplayVersion: 0.1.1` ; signature minisign de `latest.json` acceptée                        |

Le build témoin et ses dossiers de données (`%LOCALAPPDATA%\io.github.timiliris.relay.e2e`, `%APPDATA%\io.github.timiliris.relay.e2e`) ont été supprimés après le test.

## Release 0.2.0 via release-please (1er novembre 2026)

| Étape         | Résultat                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR de release | `chore(main): release 0.2.0` ouverte automatiquement par release-please (changelog : Nouveautés, Corrections, Performances ; versions alignées dans `package.json`, `Cargo.toml`, `tauri.conf.json`)                                 |
| Fusion        | tag `v0.2.0` et release GitHub créés par release-please ; `release.yml` lancé par `workflow_dispatch` (un tag créé avec `GITHUB_TOKEN` ne déclenche aucun workflow, le lancement est désormais automatisé dans `release-please.yml`) |
| Builds        | Windows x64, Linux x64, macOS Intel et Apple Silicon : succès (tauri-action 1)                                                                                                                                                       |
| Artefacts     | https://github.com/timiliris/relay/releases/tag/v0.2.0 — 17 fichiers : MSI, NSIS, deb, rpm, AppImage, 2 dmg, 2 `.app.tar.gz` (nommés avec la version depuis tauri-action 1), 8 `.sig`, `latest.json`                                 |
| `latest.json` | version 0.2.0, 11 cibles, servi par `releases/latest/download/latest.json` : les installations 0.1.1 se mettront à jour au prochain lancement                                                                                        |

Dépendances mises à jour le même jour (8 PR Dependabot fusionnées, CI verte) : actions checkout 7, setup-node 7, pnpm/action-setup 6, release-please-action 5, tauri-action 1 ; Vitest 5, `@types/node` 26, jest-dom 7. Un lockfile rendu incohérent par deux fusions successives a été régénéré (`fix(deps)`).

## Release 0.3.0 (1er novembre 2026)

| Étape              | Résultat                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenu            | Nouveautés UI : jauge de contexte en dégradé, barres et tuiles d'Usage colorées, pastilles de personas, avatars teintés par modèle, accent violet par défaut (migration v3 du store de réglages)   |
| PR release-please  | `chore(main): release 0.3.0` : diff limité aux versions et au changelog (Biome formate désormais `tauri.conf.json` comme release-please, plus de lint rouge après fusion)                          |
| Lancement du build | Échec du lancement automatique : le job release-please n'a pas de checkout, `gh workflow run` exigeait un dépôt. Corrigé (`--repo "$GITHUB_REPOSITORY"`) ; build 0.3.0 lancé à la main entre-temps |
| Artefacts          | https://github.com/timiliris/relay/releases/tag/v0.3.0 — 17 fichiers, 4 builds réussis ; `latest.json` en 0.3.0 avec 11 cibles                                                                     |

## Personas : personnalité, jeu de rôle et mode 18+ (1er novembre 2026)

| Vérification                 | Méthode                                                                   | Résultat                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composition de l'instruction | `src/lib/persona.test.ts` (6 tests)                                       | Persona neutre → aucune instruction ; paliers des curseurs (≤ 15, ≤ 35, 36–64, ≥ 65, ≥ 85) ; ordre instructions libres → fiche de rôle → personnalité → bloc 18+ ; relecture JSON tolérante                                     |
| Application d'un persona     | `src/lib/apply-preset.test.ts` (4 tests, dépôt SQLite simulé)             | Jeu de rôle sans conversation → conversation dédiée + première réplique enregistrée comme réponse sans coût ; conversation déjà remplie → mise à jour sans réplique ; assistant classique → défauts globaux                     |
| Schéma                       | `cargo check`, migration v3 `ALTER TABLE presets ADD COLUMN persona TEXT` | Compile ; les anciennes lignes sans colonne sont relues comme personas neutres (`parsePersona(null)`)                                                                                                                           |
| Éditeur                      | navigateur (données de démo), persona « Maître du jeu »                   | Onglets Identité / Personnalité / Jeu de rôle / Avancé, curseurs avec palier en clair (« Plutôt détaillé », « Très imaginatif »), dialogue intégré de confirmation d'âge, aperçu de l'instruction composée                      |
| Fiches Character Card        | `src/lib/character-card.test.ts` (5 tests)                                | JSON V1/V2, PNG avec chunk `chara` ou `ccv3`, codes d'erreur, aller-retour export → import sans perte (persona complet dans `extensions.relay`) ; gabarits `{{char}}`/`{{user}}` remplis dans le prompt et la première réplique |
| Non vérifié hors Tauri       | —                                                                         | Enregistrement en base et insertion réelle de la première réplique (couverts par les tests simulés uniquement)                                                                                                                  |

## Release 0.4.0 (1er novembre 2026)

| Étape              | Résultat                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenu            | Personas : personnalité par curseurs, mode jeu de rôle, mode 18+ (migration SQLite v3)                                                                                       |
| PR release-please  | `chore(main): release 0.4.0` ; `Cargo.lock` aligné directement sur la branche de la PR (plus de commit de rattrapage après fusion) ; CI verte avant fusion                   |
| Lancement du build | **Automatique pour la première fois** : le job release-please a lancé `release.yml` (événement `workflow_dispatch`) grâce à `--repo "$GITHUB_REPOSITORY"`, sans intervention |
| Artefacts          | https://github.com/timiliris/relay/releases/tag/v0.4.0 — 17 fichiers, 4 builds réussis ; `latest.json` en 0.4.0 avec 11 cibles                                               |

## Chantiers parallèles fusionnés (1er novembre 2026)

Cinq branches développées en parallèle par des sessions séparées, fusionnées une à une dans `main` (conflits résolus à la main : i18n, `chat.tsx`, composeur, bulles, migrations), puis vérifiées ensemble.

| Chantier                         | Branche                               | Vérification par la session                                                                                                    |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Mémoire du personnage            | `claude/persona-memory-26eb98`        | Migration v4, injection dans `buildHistory`, volet Mémoire, action Mémoriser ; extraction par le modèle non exercée hors Tauri |
| Outils de jeu de rôle            | `claude/rp-tools-b54ed7`              | HRP, Jouer mon tour, dés ; tests du parseur de dés et du composeur                                                             |
| Génération d'images              | `claude/image-generation-35582e`      | Rust + frontend ; test réel : 1 image produite pour 0,067 $ ; parcours dans l'app Tauri non vérifié                            |
| Régénérer avec un autre modèle   | `claude/regenerate-with-model-17c882` | `modelOverride`, versions étiquetées ; test Vitest                                                                             |
| Raccourcis de prompt et épingles | `claude/snippets-and-pins-8ab03e`     | Menu « / », carte de gestion, migration v5, volet des épinglés                                                                 |

Après fusion : Biome propre, tsc propre, **109 tests Vitest** (21 fichiers), `cargo fmt`, `cargo clippy -D warnings`, 17 tests Rust ; conversation de démo RP affichée dans le navigateur avec badge RP, compteur de mémoire et outils RP. Trois tests ont dû être adaptés au type de retour `CompletionOutput` introduit par la génération d'images et à l'envoi asynchrone du composeur. Non vérifié : les migrations v4 et v5 sur une base existante et les parcours réseau dans l'app Tauri.

## Release 0.5.0 (1er novembre 2026)

| Étape              | Résultat                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenu            | Fiches Character Card, mémoire du personnage, outils de jeu de rôle, génération d'images, régénération ciblée, raccourcis de prompt, épingles |
| PR release-please  | `chore(main): release 0.5.0` ; `Cargo.lock` aligné sur la branche de la PR ; CI verte avant fusion                                            |
| Lancement du build | Automatique (seconde fois) : `release.yml` lancé par le job release-please via `workflow_dispatch`                                            |
| Artefacts          | https://github.com/timiliris/relay/releases/tag/v0.5.0 — 17 fichiers, 4 builds réussis ; `latest.json` en 0.5.0 avec 11 cibles                |

## Optimisations mesurées (0.1.1)

| Mesure                                   | Avant                       | Après                                                     |
| ---------------------------------------- | --------------------------- | --------------------------------------------------------- |
| Bundle JS principal (`vite build`)       | 1 037 Ko (gzip 322 Ko)      | 798 Ko (gzip 254 Ko) ; KaTeX chargé à la première formule |
| Application des fragments de flux        | un rendu React par fragment | regroupés par frame (`requestAnimationFrame`)             |
| Re-rendu Markdown d'une réponse en cours | à chaque fragment           | au plus toutes les 80 ms                                  |
| Catalogue des modèles (HTTP)             | non compressé               | gzip négocié côté Rust (≈ 5× moins d'octets)              |

## Procédure : tester l'updater en local

1. Construire avec une surcharge de configuration (identifiant distinct, endpoint `http://127.0.0.1:8787/latest.json`, `dangerousInsecureTransportProtocol: true`, `createUpdaterArtifacts: true`) et `TAURI_SIGNING_PRIVATE_KEY` défini :
   `pnpm tauri build --config <surcharge.json>`.
2. Copier l'installeur NSIS dans un dossier servi en HTTP et y écrire `latest.json` avec `version` supérieure, l'URL de l'installeur et le contenu du `.sig`.
3. Lancer `src-tauri/target/release/relay.exe` : le journal (`%LOCALAPPDATA%\<identifiant>\logs\app.log`) doit contenir « Mise à jour disponible », et la modale propose l'installation.

`dangerousInsecureTransportProtocol` ne doit jamais figurer dans la configuration distribuée : en production, l'updater refuse tout endpoint non HTTPS.

## Hors périmètre du dépôt

- Certificats de signature de production (Windows : Azure Trusted Signing ou certificat OV/EV ; macOS : compte développeur Apple). Le pipeline les consomme via les secrets décrits dans le README.
- Clé privée de l'updater : générée sur le poste de l'éditeur (`~/.tauri/relay.key`), à placer dans le secret `TAURI_SIGNING_PRIVATE_KEY` du dépôt GitHub une fois celui-ci créé.
