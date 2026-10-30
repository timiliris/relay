//! Menu natif de l'application.
//!
//! - macOS : barre de menu système classique (`app.set_menu`).
//! - Windows / Linux : la fenêtre n'a pas de décorations natives ; le menu est
//!   affiché en popup depuis le bouton ≡ de la barre de titre personnalisée
//!   (commande `show_app_menu`).
//!
//! Les libellés sont traduits (`i18n.rs`) et reconstruits à chaque changement de langue.

use std::sync::Mutex;

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::i18n::{Lang, Text, t};

pub const ID_DOCS: &str = "docs";
pub const ID_CHECK_UPDATES: &str = "check-updates";
pub const DOCS_URL: &str = "https://openrouter.ai/docs";

/// Menu courant (Windows / Linux), conservé pour le popup.
#[derive(Default)]
pub struct MenuState(pub Mutex<Option<Menu<tauri::Wry>>>);

/// Construit le menu dans la langue donnée et l'installe.
pub fn apply(app: &AppHandle, lang: Lang) -> tauri::Result<()> {
    let menu = build(app, lang)?;
    if cfg!(target_os = "macos") {
        app.set_menu(menu)?;
    } else {
        *app.state::<MenuState>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(menu);
    }
    Ok(())
}

/// Affiche le menu en popup à la position donnée (coordonnées logiques de la fenêtre).
pub fn popup(app: &AppHandle, x: f64, y: f64) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let state = app.state::<MenuState>();
    let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(menu) = guard.as_ref() {
        use tauri::menu::ContextMenu;
        menu.popup_at(
            window.as_ref().window(),
            tauri::Position::Logical(tauri::LogicalPosition { x, y }),
        )?;
    }
    Ok(())
}

/// Traite un clic sur un élément de menu (barre de menu, popup ou tray).
pub fn handle<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        ID_DOCS => {
            use tauri_plugin_opener::OpenerExt;
            if let Err(err) = app.opener().open_url(DOCS_URL, None::<&str>) {
                log::error!("ouverture de la documentation impossible : {err}");
            }
        }
        ID_CHECK_UPDATES => {
            let _ = app.emit("menu://check-updates", ());
        }
        crate::tray::ID_SHOW => crate::tray::show_main_window(app),
        _ => {}
    }
}

fn edit_menu(app: &AppHandle, lang: Lang) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_items(
        app,
        t(lang, Text::Edit),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(t(lang, Text::Undo)))?,
            &PredefinedMenuItem::redo(app, Some(t(lang, Text::Redo)))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(t(lang, Text::Cut)))?,
            &PredefinedMenuItem::copy(app, Some(t(lang, Text::Copy)))?,
            &PredefinedMenuItem::paste(app, Some(t(lang, Text::Paste)))?,
            &PredefinedMenuItem::select_all(app, Some(t(lang, Text::SelectAll)))?,
        ],
    )
}

fn about_item(app: &AppHandle, lang: Lang) -> tauri::Result<PredefinedMenuItem<tauri::Wry>> {
    let info = app.package_info();
    let metadata = AboutMetadataBuilder::new()
        .name(Some(info.name.clone()))
        .version(Some(info.version.to_string()))
        .website(Some(DOCS_URL))
        .build();
    let label = if cfg!(target_os = "macos") {
        format!("{} {}", t(lang, Text::About), info.name)
    } else {
        t(lang, Text::About).to_string()
    };
    PredefinedMenuItem::about(app, Some(&label), Some(metadata))
}

fn help_items(
    app: &AppHandle,
    lang: Lang,
) -> tauri::Result<Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>>> {
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = vec![
        Box::new(MenuItem::with_id(
            app,
            ID_DOCS,
            t(lang, Text::Docs),
            true,
            None::<&str>,
        )?),
        Box::new(MenuItem::with_id(
            app,
            ID_CHECK_UPDATES,
            t(lang, Text::CheckUpdates),
            true,
            None::<&str>,
        )?),
    ];
    if !cfg!(target_os = "macos") {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        items.push(Box::new(about_item(app, lang)?));
    }
    Ok(items)
}

#[cfg(target_os = "macos")]
fn build(app: &AppHandle, lang: Lang) -> tauri::Result<Menu<tauri::Wry>> {
    let name = app.package_info().name.clone();
    let app_menu = Submenu::with_items(
        app,
        &name,
        true,
        &[
            &about_item(app, lang)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(t(lang, Text::Services)))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&format!("{} {name}", t(lang, Text::Hide))))?,
            &PredefinedMenuItem::hide_others(app, Some(t(lang, Text::HideOthers)))?,
            &PredefinedMenuItem::show_all(app, Some(t(lang, Text::ShowAll)))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(&format!("{} {name}", t(lang, Text::Quit))))?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        t(lang, Text::File),
        true,
        &[&PredefinedMenuItem::close_window(
            app,
            Some(t(lang, Text::CloseWindow)),
        )?],
    )?;
    let window = Submenu::with_items(
        app,
        t(lang, Text::Window),
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(t(lang, Text::Minimize)))?,
            &PredefinedMenuItem::maximize(app, Some(t(lang, Text::Zoom)))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some(t(lang, Text::Fullscreen)))?,
        ],
    )?;
    let help_items = help_items(app, lang)?;
    let help_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        help_items.iter().map(|i| i.as_ref()).collect();
    let help = Submenu::with_items(app, t(lang, Text::Help), true, &help_refs)?;

    Menu::with_items(
        app,
        &[&app_menu, &file, &edit_menu(app, lang)?, &window, &help],
    )
}

#[cfg(not(target_os = "macos"))]
fn build(app: &AppHandle, lang: Lang) -> tauri::Result<Menu<tauri::Wry>> {
    let file = Submenu::with_items(
        app,
        t(lang, Text::File),
        true,
        &[&PredefinedMenuItem::quit(app, Some(t(lang, Text::Quit)))?],
    )?;
    let help_items = help_items(app, lang)?;
    let help_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        help_items.iter().map(|i| i.as_ref()).collect();
    let help = Submenu::with_items(app, t(lang, Text::Help), true, &help_refs)?;

    Menu::with_items(app, &[&file, &edit_menu(app, lang)?, &help])
}
