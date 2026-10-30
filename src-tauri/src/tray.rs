//! Icône de la zone de notification : clic gauche → afficher la fenêtre,
//! clic droit → menu (Afficher / Quitter).

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use crate::i18n::{Lang, Text, t};

pub const ID: &str = "main";
pub const ID_SHOW: &str = "tray-show";

pub fn setup(app: &AppHandle, lang: Lang) -> tauri::Result<()> {
    let Some(icon) = app.default_window_icon().cloned() else {
        log::warn!("aucune icône de fenêtre : tray désactivé");
        return Ok(());
    };

    TrayIconBuilder::with_id(ID)
        .icon(icon)
        .tooltip(&app.package_info().name)
        .menu(&build_menu(app, lang)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| crate::menu::handle(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Met à jour les libellés après un changement de langue.
pub fn apply(app: &AppHandle, lang: Lang) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(ID) {
        tray.set_menu(Some(build_menu(app, lang)?))?;
    }
    Ok(())
}

fn build_menu(app: &AppHandle, lang: Lang) -> tauri::Result<Menu<tauri::Wry>> {
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, ID_SHOW, t(lang, Text::Show), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(t(lang, Text::Quit)))?,
        ],
    )
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Affiche la fenêtre si elle est masquée ou en arrière-plan, la masque sinon.
pub fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused {
        let _ = window.hide();
    } else {
        show_main_window(app);
    }
}
