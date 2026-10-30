//! Reprise des données d'une installation faite sous l'ancien identifiant
//! d'application (`com.example.relay`) : base SQLite, préférences, cache des
//! modèles, état de fenêtre. Ne copie que les fichiers absents de la nouvelle
//! installation ; l'ancien dossier est laissé intact.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

pub const LEGACY_IDENTIFIER: &str = "com.example.relay";

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
        if legacy == dir || !legacy.is_dir() {
            continue;
        }
        match copy_missing(&legacy, &dir) {
            Ok(0) => {}
            Ok(count) => log::info!(
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
    use super::copy_missing;

    #[test]
    fn copies_only_missing_files_recursively() {
        let root = std::env::temp_dir().join(format!("relay-migration-{}", std::process::id()));
        let from = root.join("from");
        let to = root.join("to");
        std::fs::create_dir_all(from.join("sub")).unwrap();
        std::fs::create_dir_all(&to).unwrap();
        std::fs::write(from.join("relay.db"), b"ancienne base").unwrap();
        std::fs::write(from.join("sub/state.json"), b"{}").unwrap();
        std::fs::write(to.join("relay.db"), b"nouvelle base").unwrap();

        let copied = copy_missing(&from, &to).unwrap();

        assert_eq!(copied, 1, "seul le fichier absent est copié");
        assert_eq!(
            std::fs::read(to.join("relay.db")).unwrap(),
            b"nouvelle base"
        );
        assert_eq!(std::fs::read(to.join("sub/state.json")).unwrap(), b"{}");
        let _ = std::fs::remove_dir_all(root);
    }
}
