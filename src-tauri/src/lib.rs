//! Point d'entrée de la partie Rust de l'application.
//!
//! Organisation :
//! - `commands/` : fonctions exposées au frontend via `invoke`.
//! - `error.rs`  : type d'erreur unique, sérialisable vers le frontend.
//! - `state.rs`  : état partagé géré par Tauri (`app.manage`).
//! - `i18n.rs`   : libellés natifs (menus, tray) en FR / EN.
//! - `menu.rs`, `tray.rs`, `shortcut.rs` : intégration desktop.
//! - `db.rs`     : migrations SQLite (conversations, messages).
//! - `openrouter/` : client HTTP OpenRouter (modèles, crédits, streaming SSE).
//! - `secrets.rs` : clé API dans le trousseau système.

mod commands;
mod db;
mod error;
mod i18n;
#[cfg(desktop)]
mod menu;
mod migration;
mod openrouter;
mod secrets;
#[cfg(desktop)]
mod shortcut;
mod state;
#[cfg(desktop)]
mod tray;

pub use error::{AppError, AppResult};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `--minimized` est passé par le lanceur de démarrage automatique (plugin autostart).
    let args: Vec<String> = std::env::args().collect();
    let start_hidden = args.iter().any(|arg| arg == "--minimized");
    // `--auto-update` installe les mises à jour sans confirmation (déploiements pilotés, tests).
    let auto_update = args.iter().any(|arg| arg == "--auto-update");

    let builder = tauri::Builder::default();

    // Plugins et intégrations disponibles uniquement sur desktop.
    #[cfg(desktop)]
    let builder = {
        use tauri_plugin_autostart::MacosLauncher;
        use tauri_plugin_window_state::StateFlags;

        builder
            // Une seule instance : relancer l'app ramène la fenêtre existante au premier plan.
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                tray::show_main_window(app);
            }))
            // Mémorise taille et position de la fenêtre entre deux lancements.
            // La visibilité est exclue : le frontend affiche la fenêtre après le premier rendu.
            .plugin(
                tauri_plugin_window_state::Builder::new()
                    .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                    .build(),
            )
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_autostart::init(
                MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ))
            .plugin(shortcut::init())
            .manage(menu::MenuState::default())
    };

    builder
        .plugin(build_log_plugin())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(db::init())
        .manage(state::AppState::new(start_hidden, auto_update))
        .manage(openrouter::OpenRouterState::new())
        .invoke_handler(tauri::generate_handler![
            commands::app::set_language,
            commands::app::should_start_hidden,
            commands::app::should_auto_update,
            commands::app::show_app_menu,
            commands::openrouter::fetch_models,
            commands::openrouter::fetch_credits,
            commands::openrouter::complete_chat,
            commands::openrouter::stream_chat,
            commands::openrouter::cancel_stream,
            commands::secrets::set_api_key,
            commands::secrets::get_api_key_hint,
            commands::secrets::clear_api_key,
        ])
        .setup(|app| {
            let info = app.package_info();
            log::info!("{} v{} démarrée", info.name, info.version);

            // Installation précédente sous l'ancien identifiant : données et clé reprises.
            migration::migrate_legacy_data(app.handle());
            secrets::migrate_legacy_entry();

            #[cfg(desktop)]
            {
                let lang = app.state::<state::AppState>().lang();
                menu::apply(app.handle(), lang)?;
                tray::setup(app.handle(), lang)?;
                shortcut::register(app.handle());
                app.on_menu_event(|app, event| menu::handle(app, event.id().as_ref()));
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}

/// Journalisation : terminal, fichier dans le dossier de logs de l'OS et console du webview.
fn build_log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

    let level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    tauri_plugin_log::Builder::new()
        .level(level)
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir {
                file_name: Some("app".into()),
            }),
            Target::new(TargetKind::Webview),
        ])
        .max_file_size(2 * 1024 * 1024)
        .rotation_strategy(RotationStrategy::KeepOne)
        .build()
}
