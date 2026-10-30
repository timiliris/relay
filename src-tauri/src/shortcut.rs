//! Raccourci clavier global : affiche ou masque la fenêtre principale.
//!
//! Doit rester aligné avec `SHORTCUT` affiché dans `src/pages/settings.tsx`.

use tauri::AppHandle;
use tauri::plugin::TauriPlugin;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const SHORTCUT: &str = "CmdOrCtrl+Shift+Space";

pub fn init() -> TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                crate::tray::toggle_main_window(app);
            }
        })
        .build()
}

/// L'échec (raccourci déjà pris par une autre application) n'est pas bloquant.
pub fn register(app: &AppHandle) {
    if let Err(err) = app.global_shortcut().register(SHORTCUT) {
        log::warn!("raccourci global {SHORTCUT} indisponible : {err}");
    }
}
