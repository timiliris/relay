//! Navigateur intégré : une page web affichée **dans la fenêtre principale**.
//!
//! Voie retenue : le webview enfant de Tauri 2 (`Window::add_child`, feature `unstable` de la
//! crate `tauri`). Le frontend mesure la zone de contenu du volet « Navigateur » et envoie sa
//! position et sa taille (pixels logiques, relatifs à la zone cliente de la fenêtre) ; Rust place
//! le webview `browser` dans ce rectangle et le suit à chaque redimensionnement.
//!
//! Effet de bord de la feature `unstable` : le webview principal est lui aussi créé en mode
//! « enfant » par `tauri-runtime-wry`. Sous Windows, le gestionnaire de redimensionnement des
//! fenêtres sans décorations n'est alors plus attaché à la création : `setup` le rétablit.
//!
//! Sécurité : seuls `http(s)` sont acceptés (`file://`, `tauri://`, `ipc:`… refusés avant
//! navigation et dans `on_navigation`). Le webview `browser` n'apparaît dans aucune capacité
//! (`capabilities/default.json` ne vise que `main`) : les pages chargées n'ont aucun accès IPC.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Url, Webview, WebviewUrl,
};

use crate::{AppError, AppResult};

/// Libellé du webview enfant.
pub const LABEL: &str = "browser";
/// Fenêtre (et webview) principale qui héberge le navigateur et reçoit ses événements.
pub const MAIN: &str = "main";
/// Événement émis vers `main` à chaque changement de page ou de titre.
pub const NAVIGATED_EVENT: &str = "browser://navigated";

/// Dernière URL connue du webview `browser` (mise à jour au début de chaque chargement).
static CURRENT_URL: Mutex<String> = Mutex::new(String::new());

/// Rectangle en pixels logiques, relatif au coin supérieur gauche de la zone cliente.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Bounds {
    /// Un webview de taille nulle est refusé par certaines plateformes : 1 px minimum.
    fn clamped(self) -> Self {
        Self {
            x: self.x.max(0.0),
            y: self.y.max(0.0),
            width: self.width.max(1.0),
            height: self.height.max(1.0),
        }
    }
}

/// Charge utile de `browser://navigated` ; `title` est `null` tant que la page ne l'a pas fourni.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Navigated {
    pub url: String,
    pub title: Option<String>,
}

/// Analyse une URL destinée au navigateur : `http` ou `https` avec un hôte, rien d'autre.
pub fn parse_url(input: &str) -> AppResult<Url> {
    let url = Url::parse(input.trim()).map_err(|_| AppError::Validation("browser_invalid_url"))?;
    if !is_allowed(&url) {
        return Err(AppError::Validation("browser_scheme_denied"));
    }
    Ok(url)
}

/// Schémas que le webview peut suivre de lui-même (liens, redirections).
fn is_allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
}

/// Correctif Windows décrit en tête de module : réattache le redimensionnement par les bords.
pub fn setup<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(windows)]
    if let Some(window) = app.get_window(MAIN)
        && let Err(err) = window.set_resizable(true)
    {
        log::warn!("redimensionnement de la fenêtre principale : {err}");
    }
    #[cfg(not(windows))]
    let _ = app;
}

fn webview<R: Runtime>(app: &AppHandle<R>) -> AppResult<Webview<R>> {
    app.get_webview(LABEL)
        .ok_or(AppError::Validation("browser_closed"))
}

fn emit<R: Runtime>(app: &AppHandle<R>, url: String, title: Option<String>) {
    if let Err(err) = app.emit_to(MAIN, NAVIGATED_EVENT, Navigated { url, title }) {
        log::warn!("événement {NAVIGATED_EVENT} : {err}");
    }
}

fn remember(url: &Url) {
    *CURRENT_URL.lock().unwrap_or_else(|e| e.into_inner()) = url.to_string();
}

fn current_url() -> String {
    CURRENT_URL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// Ouvre le navigateur sur `url` : crée le webview enfant s'il n'existe pas, sinon y navigue.
///
/// `add_child` attend le fil principal : sous Windows il bloquerait une commande synchrone
/// (voir la documentation de Tauri), d'où l'exécution dans `spawn_blocking`.
pub async fn open<R: Runtime>(
    app: &AppHandle<R>,
    url: Url,
    bounds: Option<Bounds>,
) -> AppResult<()> {
    if let Ok(existing) = webview(app) {
        if let Some(bounds) = bounds {
            set_bounds(app, bounds)?;
        }
        remember(&url);
        existing.navigate(url)?;
        existing.show()?;
        return Ok(());
    }

    let window = app
        .get_window(MAIN)
        .ok_or(AppError::Validation("browser_window_missing"))?;
    remember(&url);

    let on_new_window = app.clone();
    let on_page_load = app.clone();
    let on_title = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        .on_navigation(|url| is_allowed(url) || url.scheme() == "about")
        // `target="_blank"` : la page s'ouvre dans le même webview plutôt qu'une nouvelle fenêtre.
        .on_new_window(move |url, _| {
            if is_allowed(&url)
                && let Some(webview) = on_new_window.get_webview(LABEL)
            {
                remember(&url);
                if let Err(err) = webview.navigate(url) {
                    log::warn!("navigation depuis window.open : {err}");
                }
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| {
            if payload.event() == PageLoadEvent::Started {
                remember(payload.url());
                emit(&on_page_load, payload.url().to_string(), None);
            }
        })
        .on_document_title_changed(move |_, title| emit(&on_title, current_url(), Some(title)))
        .zoom_hotkeys_enabled(true);

    let bounds = bounds
        .unwrap_or(Bounds {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        })
        .clamped();
    tokio::task::spawn_blocking(move || {
        window.add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
    })
    .await
    .map_err(|e| std::io::Error::other(e.to_string()))??;
    Ok(())
}

pub fn navigate<R: Runtime>(app: &AppHandle<R>, url: Url) -> AppResult<()> {
    let webview = webview(app)?;
    remember(&url);
    webview.navigate(url)?;
    Ok(())
}

pub fn back<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    webview(app)?.eval("history.back()")?;
    Ok(())
}

pub fn forward<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    webview(app)?.eval("history.forward()")?;
    Ok(())
}

pub fn reload<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    webview(app)?.reload()?;
    Ok(())
}

/// Déplace et redimensionne le webview (appelé par le frontend à chaque `ResizeObserver`).
pub fn set_bounds<R: Runtime>(app: &AppHandle<R>, bounds: Bounds) -> AppResult<()> {
    let webview = webview(app)?;
    let bounds = bounds.clamped();
    webview.set_position(LogicalPosition::new(bounds.x, bounds.y))?;
    webview.set_size(LogicalSize::new(bounds.width, bounds.height))?;
    Ok(())
}

/// Ferme le webview ; sans effet s'il n'existe pas.
pub fn close<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    if let Some(webview) = app.get_webview(LABEL) {
        webview.close()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_http_and_https_with_a_host() {
        assert_eq!(
            parse_url(" https://example.com/a?b=1 ").unwrap().as_str(),
            "https://example.com/a?b=1"
        );
        assert!(parse_url("http://localhost:1420/").is_ok());
        for denied in [
            "file:///C:/Windows/system.ini",
            "tauri://localhost/index.html",
            "ipc://localhost",
            "javascript:alert(1)",
            "data:text/html,hi",
            "about:blank",
            "ftp://example.com",
            "example.com",
            "",
        ] {
            assert!(
                matches!(parse_url(denied), Err(AppError::Validation(_))),
                "{denied} should be refused"
            );
        }
    }

    #[test]
    fn bounds_never_collapse_to_zero() {
        let b = Bounds {
            x: -3.0,
            y: 10.0,
            width: 0.0,
            height: -1.0,
        }
        .clamped();
        assert_eq!(
            b,
            Bounds {
                x: 0.0,
                y: 10.0,
                width: 1.0,
                height: 1.0
            }
        );
    }
}
