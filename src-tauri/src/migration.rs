//! Reprise des données d'une installation faite sous l'ancien identifiant
//! d'application (`com.example.relay`) : base SQLite, préférences, cache des
//! modèles, état de fenêtre et journaux. Seuls ces fichiers connus sont
//! repris, jamais les caches du WebView ni les fichiers inconnus ; les fichiers
//! déjà présents dans la nouvelle installation ne sont pas écrasés et l'ancien
//! dossier est laissé intact.
//!
//! La reprise n'a lieu qu'une fois par dossier : un marqueur
//! [`MIGRATED_MARKER`] est posé dans le nouveau dossier après une reprise
//! réussie et fait sortir immédiatement aux lancements suivants.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

pub const LEGACY_IDENTIFIER: &str = "com.example.relay";

/// Fichier vide posé dans le nouveau dossier une fois la reprise faite.
pub const MIGRATED_MARKER: &str = ".legacy-migrated";

/// Fichiers repris à la racine du dossier, s'ils existent dans l'ancienne installation.
const DATA_FILES: &[&str] = &[
    "relay.db",
    "relay.db-wal",
    "relay.db-shm",
    "settings.json",
    ".window-state.json",
    "models-cache.json",
];

/// Dossiers repris récursivement.
const DATA_DIRS: &[&str] = &["logs"];

/// Fichier dont la présence dans le nouveau dossier prouve qu'une reprise
/// (ou une utilisation) a déjà eu lieu avant l'introduction du marqueur.
const ALREADY_MIGRATED_WITNESS: &str = "relay.db";

/// Résultat de la reprise pour un dossier.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Rien à faire : pas d'ancienne installation, ou marqueur déjà posé.
    Nothing,
    /// Une reprise avait déjà eu lieu avant cette version ; marqueur posé sans copie.
    AlreadyMigrated,
    /// Reprise effectuée, avec le nombre de fichiers copiés.
    Migrated(usize),
}

pub fn migrate_legacy_data(app: &AppHandle) {
    let resolver = app.path();
    let dirs: BTreeSet<PathBuf> = [
        resolver.app_config_dir(),
        resolver.app_data_dir(),
        resolver.app_local_data_dir(),
    ]
    .into_iter()
    .flatten()
    .collect();

    for dir in dirs {
        let Some(parent) = dir.parent() else { continue };
        let legacy = parent.join(LEGACY_IDENTIFIER);
        if legacy == dir {
            continue;
        }
        match migrate_dir(&legacy, &dir) {
            Ok(Outcome::Nothing) => {}
            Ok(Outcome::AlreadyMigrated) => log::info!(
                "données de l'ancienne installation {} déjà reprises",
                legacy.display()
            ),
            Ok(Outcome::Migrated(count)) => log::info!(
                "{count} fichier(s) repris depuis l'ancienne installation {}",
                legacy.display()
            ),
            Err(err) => log::warn!(
                "reprise des données depuis {} impossible : {err}",
                legacy.display()
            ),
        }
    }
}

/// Reprend les données utiles de `legacy` dans `dir`, une seule fois.
///
/// Sort sans rien faire si `legacy` n'existe pas ou si le marqueur est déjà
/// posé dans `dir`. Si `dir` contient déjà la base (reprise antérieure à cette
/// version), pose le marqueur sans copier. Le marqueur n'est posé qu'après une
/// reprise réussie : en cas d'erreur, la reprise sera retentée au lancement suivant.
pub fn migrate_dir(legacy: &Path, dir: &Path) -> std::io::Result<Outcome> {
    if !legacy.is_dir() || dir.join(MIGRATED_MARKER).exists() {
        return Ok(Outcome::Nothing);
    }

    let outcome = if dir.join(ALREADY_MIGRATED_WITNESS).is_file() {
        Outcome::AlreadyMigrated
    } else {
        Outcome::Migrated(copy_selected(legacy, dir)?)
    };

    fs::create_dir_all(dir)?;
    fs::write(dir.join(MIGRATED_MARKER), b"")?;
    Ok(outcome)
}

/// Copie les fichiers de [`DATA_FILES`] et les dossiers de [`DATA_DIRS`]
/// absents de `to`. Tout autre contenu de `from` est ignoré. Renvoie le nombre
/// de fichiers copiés.
fn copy_selected(from: &Path, to: &Path) -> std::io::Result<usize> {
    fs::create_dir_all(to)?;
    let mut copied = 0;

    for name in DATA_FILES {
        let source = from.join(name);
        let target = to.join(name);
        if source.is_file() && !target.exists() {
            fs::copy(&source, &target)?;
            copied += 1;
        }
    }

    for name in DATA_DIRS {
        let source = from.join(name);
        if source.is_dir() {
            copied += copy_missing(&source, &to.join(name))?;
        }
    }

    Ok(copied)
}

/// Copie récursivement ce qui n'existe pas encore dans `to`. Renvoie le nombre de fichiers copiés.
fn copy_missing(from: &Path, to: &Path) -> std::io::Result<usize> {
    fs::create_dir_all(to)?;
    let mut copied = 0;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copied += copy_missing(&entry.path(), &target)?;
        } else if !target.exists() {
            fs::copy(entry.path(), &target)?;
            copied += 1;
        }
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{MIGRATED_MARKER, Outcome, copy_missing, migrate_dir};

    /// Dossier temporaire propre à chaque test (les tests tournent en parallèle).
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(name: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("relay-migration-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).unwrap();
            Self(root)
        }

        fn legacy(&self) -> PathBuf {
            self.0.join("com.example.relay")
        }

        fn new_dir(&self) -> PathBuf {
            self.0.join("io.github.timiliris.relay")
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: PathBuf, content: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    /// Ancienne installation complète : données utiles, caches WebView et fichiers inconnus.
    fn populate_legacy(legacy: &Path) {
        write(legacy.join("relay.db"), "base");
        write(legacy.join("relay.db-wal"), "wal");
        write(legacy.join("relay.db-shm"), "shm");
        write(legacy.join("settings.json"), "{}");
        write(legacy.join(".window-state.json"), "{}");
        write(legacy.join("models-cache.json"), "[]");
        write(legacy.join("logs/app.log"), "log");
        write(legacy.join("logs/app.log.2026-01-01"), "vieux log");
        write(
            legacy.join("EBWebView/Default/Cache/data_0"),
            "cache webview",
        );
        write(legacy.join("Cache/blob"), "cache");
        write(legacy.join("inconnu.txt"), "inconnu");
        write(legacy.join("autre/profond.json"), "inconnu");
    }

    #[test]
    fn copies_only_known_data_files() {
        let tmp = TempRoot::new("filtrage");
        populate_legacy(&tmp.legacy());

        let outcome = migrate_dir(&tmp.legacy(), &tmp.new_dir()).unwrap();

        assert_eq!(outcome, Outcome::Migrated(8), "6 fichiers + 2 journaux");
        let new_dir = tmp.new_dir();
        for name in [
            "relay.db",
            "relay.db-wal",
            "relay.db-shm",
            "settings.json",
            ".window-state.json",
            "models-cache.json",
            "logs/app.log",
            "logs/app.log.2026-01-01",
        ] {
            assert!(new_dir.join(name).is_file(), "{name} doit être repris");
        }
        for name in ["EBWebView", "Cache", "inconnu.txt", "autre"] {
            assert!(
                !new_dir.join(name).exists(),
                "{name} ne doit pas être repris"
            );
        }
        assert!(new_dir.join(MIGRATED_MARKER).is_file(), "marqueur posé");
    }

    #[test]
    fn skips_absent_optional_files_and_dirs() {
        let tmp = TempRoot::new("partiel");
        write(tmp.legacy().join("relay.db"), "base");
        write(tmp.legacy().join("settings.json"), "{}");

        let outcome = migrate_dir(&tmp.legacy(), &tmp.new_dir()).unwrap();

        assert_eq!(outcome, Outcome::Migrated(2));
        assert!(!tmp.new_dir().join("logs").exists());
        assert!(tmp.new_dir().join(MIGRATED_MARKER).is_file());
    }

    #[test]
    fn second_call_does_nothing() {
        let tmp = TempRoot::new("idempotent");
        populate_legacy(&tmp.legacy());
        assert_eq!(
            migrate_dir(&tmp.legacy(), &tmp.new_dir()).unwrap(),
            Outcome::Migrated(8)
        );

        // L'ancienne installation évolue encore : rien ne doit plus être repris.
        write(tmp.legacy().join("logs/app.log.nouveau"), "nouveau");
        std::fs::remove_file(tmp.new_dir().join("settings.json")).unwrap();

        let outcome = migrate_dir(&tmp.legacy(), &tmp.new_dir()).unwrap();

        assert_eq!(outcome, Outcome::Nothing);
        assert!(!tmp.new_dir().join("logs/app.log.nouveau").exists());
        assert!(!tmp.new_dir().join("settings.json").exists());
    }

    #[test]
    fn marks_without_copying_when_already_migrated_before_marker() {
        let tmp = TempRoot::new("anterieur");
        populate_legacy(&tmp.legacy());
        write(tmp.new_dir().join("relay.db"), "nouvelle base");

        let outcome = migrate_dir(&tmp.legacy(), &tmp.new_dir()).unwrap();

        assert_eq!(outcome, Outcome::AlreadyMigrated);
        assert_eq!(
            std::fs::read(tmp.new_dir().join("relay.db")).unwrap(),
            b"nouvelle base"
        );
        assert!(!tmp.new_dir().join("settings.json").exists());
        assert!(!tmp.new_dir().join("logs").exists());
        assert!(tmp.new_dir().join(MIGRATED_MARKER).is_file());
        assert_eq!(
            migrate_dir(&tmp.legacy(), &tmp.new_dir()).unwrap(),
            Outcome::Nothing
        );
    }

    #[test]
    fn nothing_without_legacy_install() {
        let tmp = TempRoot::new("sans-legacy");
        std::fs::create_dir_all(tmp.new_dir()).unwrap();

        let outcome = migrate_dir(&tmp.legacy(), &tmp.new_dir()).unwrap();

        assert_eq!(outcome, Outcome::Nothing);
        assert!(
            !tmp.new_dir().join(MIGRATED_MARKER).exists(),
            "pas de marqueur"
        );
    }

    #[test]
    fn never_overwrites_existing_files() {
        let tmp = TempRoot::new("ecrasement");
        write(tmp.legacy().join("settings.json"), "ancien");
        write(tmp.legacy().join("logs/app.log"), "ancien log");
        write(tmp.new_dir().join("settings.json"), "nouveau");
        write(tmp.new_dir().join("logs/app.log"), "nouveau log");

        let outcome = migrate_dir(&tmp.legacy(), &tmp.new_dir()).unwrap();

        assert_eq!(outcome, Outcome::Migrated(0));
        assert_eq!(
            std::fs::read(tmp.new_dir().join("settings.json")).unwrap(),
            b"nouveau"
        );
        assert_eq!(
            std::fs::read(tmp.new_dir().join("logs/app.log")).unwrap(),
            b"nouveau log"
        );
        assert!(tmp.new_dir().join(MIGRATED_MARKER).is_file());
    }

    #[test]
    fn copies_only_missing_files_recursively() {
        let tmp = TempRoot::new("copy-missing");
        let from = tmp.0.join("from");
        let to = tmp.0.join("to");
        write(from.join("relay.db"), "ancienne base");
        write(from.join("sub/state.json"), "{}");
        write(to.join("relay.db"), "nouvelle base");

        let copied = copy_missing(&from, &to).unwrap();

        assert_eq!(copied, 1, "seul le fichier absent est copié");
        assert_eq!(
            std::fs::read(to.join("relay.db")).unwrap(),
            b"nouvelle base"
        );
        assert_eq!(std::fs::read(to.join("sub/state.json")).unwrap(), b"{}");
    }
}
