//! Commandes du mode agent : dossier de travail et outils (fichiers, recherche, commandes).
//! Chaque commande vérifie que `workspace` est une racine enregistrée et que les chemins y restent.

use tauri::State;

use crate::AppResult;
use crate::agent::exec::{self, CommandOutput};
use crate::agent::fs::{self, Change, ChangePreview, FileContent, ListResult};
use crate::agent::git::{self, GitBranch, GitCommit, GitDiff, GitLogEntry, GitStatus};
use crate::agent::search::{self, SearchResult};
use crate::agent::{WorkspaceInfo, WorkspaceState};

/// Enregistre un dossier choisi par l'utilisateur comme racine autorisée.
#[tauri::command]
pub fn register_workspace(
    state: State<'_, WorkspaceState>,
    path: String,
) -> AppResult<WorkspaceInfo> {
    state.register(&path)
}

/// Liste fichiers et dossiers sous `path` (relatif au dossier de travail), jusqu'à `depth` niveaux.
#[tauri::command]
pub async fn tool_list_files(
    state: State<'_, WorkspaceState>,
    workspace: String,
    path: String,
    depth: u8,
) -> AppResult<ListResult> {
    let root = state.root(&workspace)?;
    tokio::task::spawn_blocking(move || fs::list_files(&root, &path, depth))
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))?
}

/// Lit un fichier texte, avec `offset` (1-based) et `limit` en lignes.
#[tauri::command]
pub async fn tool_read_file(
    state: State<'_, WorkspaceState>,
    workspace: String,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> AppResult<FileContent> {
    let root = state.root(&workspace)?;
    tokio::task::spawn_blocking(move || fs::read_file(&root, &path, offset, limit))
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))?
}

/// Diff d'une écriture ou d'une édition, sans toucher au disque.
#[tauri::command]
pub async fn tool_preview_change(
    state: State<'_, WorkspaceState>,
    workspace: String,
    path: String,
    change: Change,
) -> AppResult<ChangePreview> {
    let root = state.root(&workspace)?;
    tokio::task::spawn_blocking(move || fs::change_file(&root, &path, &change, false))
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))?
}

/// Applique une écriture ou une édition et renvoie son diff.
#[tauri::command]
pub async fn tool_apply_change(
    state: State<'_, WorkspaceState>,
    workspace: String,
    path: String,
    change: Change,
) -> AppResult<ChangePreview> {
    let root = state.root(&workspace)?;
    tokio::task::spawn_blocking(move || fs::change_file(&root, &path, &change, true))
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))?
}

/// Recherche une expression régulière dans les fichiers texte (`.gitignore` respecté).
#[tauri::command]
pub async fn tool_search(
    state: State<'_, WorkspaceState>,
    workspace: String,
    pattern: String,
    glob: Option<String>,
    max_results: usize,
) -> AppResult<SearchResult> {
    let root = state.root(&workspace)?;
    tokio::task::spawn_blocking(move || {
        search::search(&root, &pattern, glob.as_deref(), max_results)
    })
    .await
    .map_err(|e| std::io::Error::other(e.to_string()))?
}

/// Exécute une commande shell dans le dossier de travail ; annulable via `cancel_tool(id)`.
#[tauri::command]
pub async fn tool_run_command(
    state: State<'_, WorkspaceState>,
    id: String,
    workspace: String,
    command: String,
    timeout_secs: u64,
) -> AppResult<CommandOutput> {
    let root = state.root(&workspace)?;
    let cancel = state.track(&id);
    let result = exec::run_command(&root, &command, timeout_secs, cancel).await;
    state.untrack(&id);
    result
}

#[tauri::command]
pub fn cancel_tool(state: State<'_, WorkspaceState>, id: String) {
    state.cancel(&id);
}

// ---- Panneau Git du dossier de travail (manuel, indépendant de l'agent) ----

/// Branche, suivi distant, avance/retard et fichiers modifiés (`git status --porcelain=v2`).
#[tauri::command]
pub async fn git_status(
    state: State<'_, WorkspaceState>,
    workspace: String,
) -> AppResult<GitStatus> {
    let root = state.root(&workspace)?;
    git::status(&root).await
}

/// Diff d'un fichier (ou de tout le dépôt sans `path`), de l'index si `staged`.
#[tauri::command]
pub async fn git_diff(
    state: State<'_, WorkspaceState>,
    workspace: String,
    path: Option<String>,
    staged: bool,
) -> AppResult<GitDiff> {
    let root = state.root(&workspace)?;
    git::diff(&root, path.as_deref(), staged).await
}

/// Indexe (`stage: true`) ou désindexe des chemins relatifs au dossier de travail.
#[tauri::command]
pub async fn git_stage(
    state: State<'_, WorkspaceState>,
    workspace: String,
    paths: Vec<String>,
    stage: bool,
) -> AppResult<()> {
    let root = state.root(&workspace)?;
    git::stage(&root, &paths, stage).await
}

/// Commit de l'index avec `message` ; renvoie le hash et le sujet.
#[tauri::command]
pub async fn git_commit(
    state: State<'_, WorkspaceState>,
    workspace: String,
    message: String,
) -> AppResult<GitCommit> {
    let root = state.root(&workspace)?;
    git::commit(&root, &message).await
}

/// Les `limit` derniers commits (vide sans commit).
#[tauri::command]
pub async fn git_log(
    state: State<'_, WorkspaceState>,
    workspace: String,
    limit: usize,
) -> AppResult<Vec<GitLogEntry>> {
    let root = state.root(&workspace)?;
    git::log(&root, limit).await
}

/// Branches locales, la courante marquée.
#[tauri::command]
pub async fn git_branches(
    state: State<'_, WorkspaceState>,
    workspace: String,
) -> AppResult<Vec<GitBranch>> {
    let root = state.root(&workspace)?;
    git::branches(&root).await
}

/// Bascule sur une branche locale existante.
#[tauri::command]
pub async fn git_checkout(
    state: State<'_, WorkspaceState>,
    workspace: String,
    branch: String,
) -> AppResult<()> {
    let root = state.root(&workspace)?;
    git::checkout(&root, &branch).await
}

/// `git init` dans le dossier de travail.
#[tauri::command]
pub async fn git_init(state: State<'_, WorkspaceState>, workspace: String) -> AppResult<()> {
    let root = state.root(&workspace)?;
    git::init(&root).await
}
