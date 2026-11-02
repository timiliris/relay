//! Commandes du navigateur intégré (`src/browser.rs`) et de la lecture de pages pour le modèle
//! (`src/agent/web.rs`). Le webview `browser` est unique ; toutes les URL sont validées ici.

use tauri::AppHandle;

use crate::AppResult;
use crate::agent::web::{self, PageText};
use crate::browser::{self, Bounds};

/// Ouvre (ou réutilise) le webview enfant sur `url`, placé dans `bounds` si fourni.
#[tauri::command]
pub async fn browser_open(app: AppHandle, url: String, bounds: Option<Bounds>) -> AppResult<()> {
    let url = browser::parse_url(&url)?;
    browser::open(&app, url, bounds).await
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, url: String) -> AppResult<()> {
    let url = browser::parse_url(&url)?;
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
