# Changelog

Généré par [release-please](https://github.com/googleapis/release-please) à partir des Conventional Commits.

## [0.12.0](https://github.com/timiliris/relay/compare/v0.11.0...v0.12.0) (2026-11-03)


### Nouveautés

* **personas:** Léa en petite voix dans le pack 18+ (Jules second personnage) ([be31620](https://github.com/timiliris/relay/commit/be316208e009537637213a15ed88d357269b1787))

## [0.11.0](https://github.com/timiliris/relay/compare/v0.10.0...v0.11.0) (2026-11-02)


### Nouveautés

* **agent:** bloc « Environment » dans l'instruction et consigne de ne pas sonder le poste ([e65e606](https://github.com/timiliris/relay/commit/e65e6064e103585a4365c93f20fa3b50271b671b))
* **agent:** outils navigateur pour le modèle (navigate, read, click, type, eval) ([7617617](https://github.com/timiliris/relay/commit/7617617f3dc1ebe4267ab7f98222afc80cc64626))
* **agent:** relevé de l'environnement du poste et installation de Playwright côté Rust ([c3cc252](https://github.com/timiliris/relay/commit/c3cc2522d862a9fb1033130aa1c432ba3672e1ab))
* **agent:** sortie des commandes diffusée, arrière-plan et registre des processus ([5740068](https://github.com/timiliris/relay/commit/5740068a5b7bdcc2a318ad698c901bfaaef51b6d))
* **chat:** volet Processus et sortie en direct des commandes de l'agent ([5e62bca](https://github.com/timiliris/relay/commit/5e62bcae32ff619342f8adc0f9376de99d72e495))
* **personas:** conversation de démo petite voix et fiches des seconds personnages ([5f981ab](https://github.com/timiliris/relay/commit/5f981abeb8550fffbb9a126fc0465aa79966fc29))
* **personas:** deux petites voix par défaut (premier rendez-vous, entretien) ([6c55743](https://github.com/timiliris/relay/commit/6c5574329d545091b93b0dff17168f0a373c1a13))
* **personas:** éditeur, badges, application et fiches pour la petite voix ([d28da40](https://github.com/timiliris/relay/commit/d28da409a903a295b95d8db22909395164d1bfdf))
* **personas:** mode « petite voix » dans le modèle, le prompt et les gabarits ([0fbb329](https://github.com/timiliris/relay/commit/0fbb329d7307acf2ff7fea2f409d195540a02304))
* **settings:** groupe Environnement avec outils détectés et installation de Playwright ([c6cf443](https://github.com/timiliris/relay/commit/c6cf4433fed234f19dcd843527267bf844d386d5))


### Corrections

* **agent:** attendre l'événement terminal du flux avant de persister les appels d'outils ([b6bff6b](https://github.com/timiliris/relay/commit/b6bff6b65c73bb2e2fecda6264455f80f3773019))

## [0.10.0](https://github.com/timiliris/relay/compare/v0.9.0...v0.10.0) (2026-11-02)


### Nouveautés

* **agent:** aperçu du diff avant approbation et refus motivé ([fcc062e](https://github.com/timiliris/relay/commit/fcc062ed4476d1d11d5390343ef709a6f2255308))
* **agent:** carte d'outil avec diff replié, commande complète et suivi de la boucle ([5c263b1](https://github.com/timiliris/relay/commit/5c263b130cda02541050f72cf66ac40047b4d89a))
* **agent:** commandes Git du dossier de travail (status, diff, index, commit, journal, branches) ([19d8497](https://github.com/timiliris/relay/commit/19d84979c888f0b4ebe484b5d5a880f47301d6b9))
* **agent:** contexte de projet construit, mis en cache et injecté en tête de conversation ([ebcc034](https://github.com/timiliris/relay/commit/ebcc034cda4ee30a61866fcfc0d343e6753e7fd1))
* **agent:** mentions [@fichier](https://github.com/fichier) et bouton « Ajouter au message » dans le volet Fichiers ([56dce5e](https://github.com/timiliris/relay/commit/56dce5eb9978a9821479cd8e2dde154c913b928d))
* **browser:** navigateur intégré et lecture de pages web par l'agent ([ff71c23](https://github.com/timiliris/relay/commit/ff71c235a5610f0804dd0ab0e6f54d20f8cab48e))
* **chat:** volet Git du dossier de travail ([f90cb39](https://github.com/timiliris/relay/commit/f90cb39d6ea97fcf4779732a794f94a7e2fdb40e))
* **explorer:** éditeur CodeMirror 6 à la place de la zone de texte du volet Fichiers ([f0cafbd](https://github.com/timiliris/relay/commit/f0cafbd443c340b345c693a2950e2753e98dc9a1))
* **settings:** réglage « Contexte de projet au démarrage » dans la section Développement ([87a53fc](https://github.com/timiliris/relay/commit/87a53fcabea9b42f7fa817ef035af34ce06ea32d))


### Corrections

* **browser:** un seul browser_open à l'ouverture du volet ([740cb41](https://github.com/timiliris/relay/commit/740cb414b8d76e9ff8d59f70eaa18ab8aba183f6))

## [0.9.0](https://github.com/timiliris/relay/compare/v0.8.0...v0.9.0) (2026-11-02)


### Nouveautés

* **agent:** volet Fichiers du dossier de travail et appels d'outils incomplets ([74130b8](https://github.com/timiliris/relay/commit/74130b8d23a3735872494689bb04ce197a78534b))

## [0.8.0](https://github.com/timiliris/relay/compare/v0.7.0...v0.8.0) (2026-11-02)


### Nouveautés

* **agent:** exécuteurs d'outils Rust dans un dossier de travail ([c42fdf0](https://github.com/timiliris/relay/commit/c42fdf0d4df3ef714ce0a0d77113ff411686384a))
* **agent:** mode développement — boucle d'agent, cartes d'outils, dossier de travail ([80dbf92](https://github.com/timiliris/relay/commit/80dbf92e4b45a1e74d8d38e3b6f08042002b96f1))
* **openrouter:** appels d'outils (tools, tool_calls, rôle tool) et migration v6 ([320543b](https://github.com/timiliris/relay/commit/320543ba0b64a13c4c280f47fd9a10f0e7833ddc))


### Corrections

* **agent:** arrêt des commandes et test de chemin portables sous Linux ([7a39ab5](https://github.com/timiliris/relay/commit/7a39ab5c9bd98bfe6de64728987fe3a5a269140d))

## [0.7.0](https://github.com/timiliris/relay/compare/v0.6.2...v0.7.0) (2026-11-02)


### Nouveautés

* **settings:** page réorganisée en sections avec sommaire ([36ba853](https://github.com/timiliris/relay/commit/36ba8535cc1315e70e7a1ebb814f3ec3fc2b859c))

## [0.6.2](https://github.com/timiliris/relay/compare/v0.6.1...v0.6.2) (2026-11-02)


### Corrections

* **app:** l'assistant de bienvenue ne revient plus à chaque lancement ([4b050b5](https://github.com/timiliris/relay/commit/4b050b53f495c60f285b5cec8bb333e45b4c5025))

## [0.6.1](https://github.com/timiliris/relay/compare/v0.6.0...v0.6.1) (2026-11-02)


### Corrections

* **migration:** reprise des anciennes données ciblée et exécutée une seule fois ([c24e0ad](https://github.com/timiliris/relay/commit/c24e0ad65198638300431e8dca1bb98064a158ab))

## [0.6.0](https://github.com/timiliris/relay/compare/v0.5.0...v0.6.0) (2026-11-01)


### Nouveautés

* **personas:** pack de six personas 18+ ajouté sur demande ([78e3e09](https://github.com/timiliris/relay/commit/78e3e09b5a0b972f50c29dfb4f632fbec33acbd7))

## [0.5.0](https://github.com/timiliris/relay/compare/v0.4.0...v0.5.0) (2026-11-01)


### Nouveautés

* **chat:** génération d'images avec les modèles à sortie image d'OpenRouter ([69a10fe](https://github.com/timiliris/relay/commit/69a10fe7b4e6eb69589dbb4c970cf24b88dbadca))
* **chat:** messages épinglés dans une conversation ([1db9832](https://github.com/timiliris/relay/commit/1db983254322a6de3c78a6b269d6ce9a9d2866f9))
* **chat:** régénérer une réponse avec un autre modèle ([07b3c2d](https://github.com/timiliris/relay/commit/07b3c2d615b40743aba07185e0b6fced99f75eda))
* **composer:** outils de jeu de rôle (HRP, jouer mon tour, jets de dés) ([8ee9bef](https://github.com/timiliris/relay/commit/8ee9bef1f4705d30ebe49cb980554a2e11f65846))
* **composer:** raccourcis de prompt déclenchés par « / » ([9701af2](https://github.com/timiliris/relay/commit/9701af21062f124ded0d24b2a7af0eefaa621459))
* **db:** migration v4 persona_memories et dépôt personaMemories ([725fae8](https://github.com/timiliris/relay/commit/725fae813e17fbda0fd1c6e6a02d1609c6e2e772))
* **personas:** import/export de fiches Character Card et gabarits {{char}}/{{user}} ([0293cf1](https://github.com/timiliris/relay/commit/0293cf1c4830991bf5a69aec946441399c09ed49))
* **personas:** mémoire par persona injectée dans l'instruction système ([bc168d2](https://github.com/timiliris/relay/commit/bc168d2b098634e3161b2d06dcecb6a8206d6d9b))
* **rp:** `impersonate` écrit la réplique du joueur pour relecture ([5232996](https://github.com/timiliris/relay/commit/5232996f04e19bc380190e7c907caf6d873fc789))
* **rp:** parseur et lanceur de dés en notation NdM±K ([bc26ff3](https://github.com/timiliris/relay/commit/bc26ff31648aab5f442d64981145a5bc2fbfc8b2))

## [0.4.0](https://github.com/timiliris/relay/compare/v0.3.0...v0.4.0) (2026-11-01)


### Nouveautés

* **personas:** personnalité par curseurs, mode jeu de rôle et mode 18+ ([e03483f](https://github.com/timiliris/relay/commit/e03483fd37f2ea0596b74d291f146be4b07ea134))

## [0.3.0](https://github.com/timiliris/relay/compare/v0.2.0...v0.3.0) (2026-11-01)


### Nouveautés

* **ui:** plus de couleur — jauges, barres d'usage, personas, avatars et accent violet par défaut ([42b21e8](https://github.com/timiliris/relay/commit/42b21e8d758a1c223a6bd707a5b8e0653913b4ca))

## [0.2.0](https://github.com/timiliris/relay/compare/v0.1.1...v0.2.0) (2026-11-01)

### Nouveautés

- **ux:** reprise de la dernière conversation au lancement, bouton Réessayer sur ([5d202f6](https://github.com/timiliris/relay/commit/5d202f60257df51e9707268db1586c60101c806c))


### Corrections

- **deps:** lockfile cohérent après les fusions Dependabot ([e1e3f8e](https://github.com/timiliris/relay/commit/e1e3f8eeaa5da4ac5de8453ed8c2018c8db60ce9))


### Performances

- **ui:** streaming regroupé par frame, Markdown throttlé, KaTeX différé, gzip HTTP ([5d202f6](https://github.com/timiliris/relay/commit/5d202f60257df51e9707268db1586c60101c806c))

## 0.1.1 (2026-10-31)

### Nouveautés

- Installation automatique des mises à jour : réglage dans Paramètres et drapeau de lancement `--auto-update`.

### Corrections

- Release : les secrets de signature ne sont exportés que s'ils sont renseignés ; relance manuelle par tag.

## 0.1.0 (2026-10-31)

Première version publiée : chat en streaming, historique, personas, pièces jointes, comparaison, usage, import.
