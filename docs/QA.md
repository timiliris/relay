# Fiche de vérification — Relay 0.1.0

Dernière exécution complète : 30 octobre 2026, Windows 11, Rust 1.91, Node 24, pnpm 12.

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

## Procédure : tester l'updater en local

1. Construire avec une surcharge de configuration (identifiant distinct, endpoint `http://127.0.0.1:8787/latest.json`, `dangerousInsecureTransportProtocol: true`, `createUpdaterArtifacts: true`) et `TAURI_SIGNING_PRIVATE_KEY` défini :
   `pnpm tauri build --config <surcharge.json>`.
2. Copier l'installeur NSIS dans un dossier servi en HTTP et y écrire `latest.json` avec `version` supérieure, l'URL de l'installeur et le contenu du `.sig`.
3. Lancer `src-tauri/target/release/relay.exe` : le journal (`%LOCALAPPDATA%\<identifiant>\logs\app.log`) doit contenir « Mise à jour disponible », et la modale propose l'installation.

`dangerousInsecureTransportProtocol` ne doit jamais figurer dans la configuration distribuée : en production, l'updater refuse tout endpoint non HTTPS.

## Hors périmètre du dépôt

- Certificats de signature de production (Windows : Azure Trusted Signing ou certificat OV/EV ; macOS : compte développeur Apple). Le pipeline les consomme via les secrets décrits dans le README.
- Clé privée de l'updater : générée sur le poste de l'éditeur (`~/.tauri/relay.key`), à placer dans le secret `TAURI_SIGNING_PRIVATE_KEY` du dépôt GitHub une fois celui-ci créé.
