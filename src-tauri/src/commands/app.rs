//! Commandes liées au cycle de vie et à l'intégration native de l'application.

use tauri::{AppHandle, State};

use crate::AppResult;
use crate::i18n::Lang;
use crate::state::AppState;

/// Le frontend informe Rust de la langue active ; menus et tray sont reconstruits.
#[tauri::command]
pub fn set_language(app: AppHandle, state: State<'_, AppState>, lang: String) -> AppResult<Lang> {
    let lang = Lang::from_tag(&lang);
    state.set_lang(lang);
    #[cfg(desktop)]
    {
        crate::menu::apply(&app, lang)?;
        crate::tray::apply(&app, lang)?;
    }
    #[cfg(not(desktop))]
    let _ = app;
    log::debug!("langue : {lang:?}");
    Ok(lang)
}

/// `true` si l'app a été lancée avec `--minimized` (démarrage automatique).
#[tauri::command]
pub fn should_start_hidden(state: State<'_, AppState>) -> bool {
    state.start_hidden
}

/// Affiche le menu de l'application en popup (bouton ≡ de la barre de titre, Windows / Linux).
#[tauri::command]
pub fn show_app_menu(app: AppHandle, x: f64, y: f64) -> AppResult<()> {
    #[cfg(desktop)]
    crate::menu::popup(&app, x, y)?;
    #[cfg(not(desktop))]
    let _ = (app, x, y);
    Ok(())
}
