//! Commandes du navigateur intégré (`src/browser.rs`) et de la lecture de pages pour le modèle
//! (`src/agent/web.rs`). Le webview `browser` est unique ; toutes les URL sont validées ici
//! (`http(s)`, ou `file://` dans un dossier de travail enregistré).

use tauri::{AppHandle, State};

use crate::AppResult;
use crate::agent::WorkspaceState;
use crate::agent::web::{self, PageText};
use crate::browser::{self, Bounds, EvalOutcome, Loaded};

/// Ouvre (ou réutilise) le webview enfant sur `url`, placé dans `bounds` si fourni.
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    workspaces: State<'_, WorkspaceState>,
    url: String,
    bounds: Option<Bounds>,
) -> AppResult<()> {
    let url = browser::parse_url(&url, &workspaces.roots())?;
    browser::open(&app, url, bounds).await
}

#[tauri::command]
pub fn browser_navigate(
    app: AppHandle,
    workspaces: State<'_, WorkspaceState>,
    url: String,
) -> AppResult<()> {
    let url = browser::parse_url(&url, &workspaces.roots())?;
    browser::navigate(&app, url)
}

#[tauri::command]
pub fn browser_back(app: AppHandle) -> AppResult<()> {
    browser::back(&app)
}

#[tauri::command]
pub fn browser_forward(app: AppHandle) -> AppResult<()> {
    browser::forward(&app)
}

#[tauri::command]
pub fn browser_reload(app: AppHandle) -> AppResult<()> {
    browser::reload(&app)
}

/// Position et taille en pixels logiques, relatives à la zone cliente de la fenêtre principale.
#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    browser::set_bounds(
        &app,
        Bounds {
            x,
            y,
            width,
            height,
        },
    )
}

#[tauri::command]
pub fn browser_close(app: AppHandle) -> AppResult<()> {
    browser::close(&app)
}

/// Télécharge une page publique et la convertit en texte lisible (outil `fetch_url` de l'agent).
#[tauri::command]
pub async fn fetch_url(url: String, max_chars: Option<usize>) -> AppResult<PageText> {
    web::fetch_url(&url, max_chars).await
}

/// Valide une URL pour l'agent avant d'ouvrir le volet ; renvoie sa forme normalisée.
#[tauri::command]
pub fn browser_validate_url(
    workspaces: State<'_, WorkspaceState>,
    url: String,
) -> AppResult<String> {
    Ok(browser::parse_url(&url, &workspaces.roots())?.to_string())
}

/// Attend la fin du chargement de la page (outils de l'agent) ; voir `browser::wait_load`.
#[tauri::command]
pub async fn browser_wait_load(
    app: AppHandle,
    timeout_ms: Option<u64>,
    settle_ms: Option<u64>,
) -> AppResult<Loaded> {
    let settle = std::time::Duration::from_millis(settle_ms.unwrap_or(0).min(5_000));
    Ok(browser::wait_load(&app, browser::clamp_timeout(timeout_ms), settle).await)
}

/// Exécute un script dans la page courante et renvoie sa valeur en JSON (outils de l'agent).
#[tauri::command]
pub async fn browser_eval(
    app: AppHandle,
    script: String,
    timeout_ms: Option<u64>,
) -> AppResult<EvalOutcome> {
    browser::eval(&app, &script, browser::clamp_timeout(timeout_ms)).await
}
