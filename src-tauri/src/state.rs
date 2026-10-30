//! État partagé de l'application, accessible dans les commandes via `tauri::State`.

use std::sync::Mutex;

use crate::i18n::Lang;

pub struct AppState {
    /// Lancée avec `--minimized` (démarrage automatique) : la fenêtre reste masquée.
    pub start_hidden: bool,
    lang: Mutex<Lang>,
}

impl AppState {
    pub fn new(start_hidden: bool) -> Self {
        Self {
            start_hidden,
            lang: Mutex::new(Lang::default()),
        }
    }

    pub fn lang(&self) -> Lang {
        *self.lang.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set_lang(&self, lang: Lang) {
        *self.lang.lock().unwrap_or_else(|e| e.into_inner()) = lang;
    }
}
