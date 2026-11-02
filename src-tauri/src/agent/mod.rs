//! Mode agent : outils exécutés par Rust dans un dossier de travail choisi par l'utilisateur.
//!
//! Un dossier doit d'abord être enregistré (`register`) ; chaque outil résout ensuite ses
//! chemins avec `resolve`, qui refuse tout ce qui sort d'une racine enregistrée (`..`, chemins
//! absolus étrangers, liens symboliques vers l'extérieur). Rien n'est exécuté hors de ces racines.

pub mod exec;
pub mod fs;
pub mod git;
pub mod search;

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::{AppError, AppResult};

/// Racines autorisées et commandes en cours (annulables), partagées entre les commandes Tauri.
#[derive(Default)]
pub struct WorkspaceState {
    roots: Mutex<HashSet<PathBuf>>,
    running: Mutex<HashMap<String, CancellationToken>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub root: String,
    pub name: String,
    pub git: bool,
}

impl WorkspaceState {
    /// Canonicalise le dossier, vérifie qu'il existe et l'ajoute aux racines autorisées.
    pub fn register(&self, path: &str) -> AppResult<WorkspaceInfo> {
        let root = canonical(Path::new(path))?;
        if !root.is_dir() {
            return Err(AppError::Validation("workspace_denied"));
        }
        self.roots
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(root.clone());
        Ok(WorkspaceInfo {
            name: root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| root.to_string_lossy().into_owned()),
            git: root.join(".git").exists(),
            root: root.to_string_lossy().into_owned(),
        })
    }

    /// Racine enregistrée correspondant à `workspace`, sinon refus.
    pub fn root(&self, workspace: &str) -> AppResult<PathBuf> {
        let wanted = canonical(Path::new(workspace))?;
        let roots = self.roots.lock().unwrap_or_else(|e| e.into_inner());
        roots
            .contains(&wanted)
            .then_some(wanted)
            .ok_or(AppError::Validation("workspace_denied"))
    }

    pub fn track(&self, id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_string(), token.clone());
        token
    }

    pub fn untrack(&self, id: &str) {
        self.running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
    }

    pub fn cancel(&self, id: &str) {
        if let Some(token) = self
            .running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
        {
            token.cancel();
        }
    }
}

/// Canonicalisation sans le préfixe `\\?\` de Windows (lisible dans l'UI et le prompt).
pub fn canonical(path: &Path) -> AppResult<PathBuf> {
    Ok(dunce::canonicalize(path)?)
}

/// Résout `relative` dans `root` en garantissant que le résultat reste sous `root`.
///
/// Le chemin est d'abord normalisé lexicalement (refus de `..` qui remonte au-dessus de la
/// racine), puis l'ancêtre existant le plus proche est canonicalisé pour déjouer les liens
/// symboliques ; le fichier lui-même peut ne pas exister encore (création).
pub fn resolve(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let requested = Path::new(relative.trim());
    let joined = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        root.join(requested)
    };
    let mut normalized = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(AppError::Validation("workspace_denied"));
                }
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    if !normalized.starts_with(root) {
        return Err(AppError::Validation("workspace_denied"));
    }
    // Liens symboliques : la partie existante doit elle aussi rester sous la racine.
    let mut existing = normalized.clone();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name() else {
            return Err(AppError::Validation("workspace_denied"));
        };
        tail.push(name.to_os_string());
        existing.pop();
    }
    let mut real = canonical(&existing)?;
    if !real.starts_with(root) {
        return Err(AppError::Validation("workspace_denied"));
    }
    for name in tail.into_iter().rev() {
        real.push(name);
    }
    Ok(real)
}

/// Chemin relatif à la racine, en séparateurs `/`, pour les réponses au modèle.
pub fn display_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
pub(crate) mod testing {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    /// Dossier temporaire unique, supprimé à la destruction.
    pub struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new(label: &str) -> Self {
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir()
                .join(format!("relay-agent-{label}-{}-{n}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(super::canonical(&dir).unwrap())
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::TempDir;
    use super::*;

    #[test]
    fn registers_a_folder_and_rejects_files_or_missing_paths() {
        let dir = TempDir::new("register");
        let state = WorkspaceState::default();
        let info = state.register(dir.0.to_str().unwrap()).unwrap();
        assert_eq!(info.root, dir.0.to_string_lossy());
        assert!(!info.git);
        assert!(state.root(dir.0.to_str().unwrap()).is_ok());

        std::fs::write(dir.0.join("f.txt"), "x").unwrap();
        assert!(
            state
                .register(dir.0.join("f.txt").to_str().unwrap())
                .is_err()
        );
        assert!(
            state
                .register(dir.0.join("absent").to_str().unwrap())
                .is_err()
        );
        assert!(state.root(std::env::temp_dir().to_str().unwrap()).is_err());
    }

    #[test]
    fn resolve_keeps_paths_inside_the_root() {
        let dir = TempDir::new("resolve");
        std::fs::create_dir_all(dir.0.join("src")).unwrap();
        std::fs::write(dir.0.join("src/a.rs"), "fn a() {}").unwrap();

        assert_eq!(
            resolve(&dir.0, "src/a.rs").unwrap(),
            dir.0.join("src").join("a.rs")
        );
        assert_eq!(
            resolve(&dir.0, "./src/../src/a.rs").unwrap(),
            dir.0.join("src").join("a.rs")
        );
        // Fichier à créer dans un dossier inexistant : accepté, chemin construit.
        assert_eq!(
            resolve(&dir.0, "new/dir/b.rs").unwrap(),
            dir.0.join("new").join("dir").join("b.rs")
        );
        // Chemin absolu à l'intérieur de la racine : accepté.
        assert!(resolve(&dir.0, dir.0.join("src").to_str().unwrap()).is_ok());
    }

    #[test]
    fn resolve_rejects_escapes() {
        let dir = TempDir::new("escape");
        assert!(resolve(&dir.0, "../outside.txt").is_err());
        assert!(resolve(&dir.0, "src/../../outside.txt").is_err());
        assert!(resolve(&dir.0, std::env::temp_dir().join("x").to_str().unwrap()).is_err());
        #[cfg(windows)]
        assert!(resolve(&dir.0, "C:\\Windows\\System32").is_err());
        #[cfg(not(windows))]
        assert!(resolve(&dir.0, "/etc/passwd").is_err());
    }

    #[test]
    fn display_relative_uses_forward_slashes() {
        // Indépendant de la plateforme : la racine et le chemin sont construits avec le séparateur natif.
        let root = std::env::temp_dir();
        let path = root.join("src").join("a.rs");
        assert_eq!(display_relative(&root, &path), "src/a.rs");
    }
}
