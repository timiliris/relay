//! Gestion de la clé API OpenRouter (trousseau système). Le frontend ne reçoit
//! jamais la clé complète, seulement un indice masqué.

use crate::{AppResult, secrets};

/// Enregistre la clé et renvoie son indice masqué.
#[tauri::command]
pub fn set_api_key(key: String) -> AppResult<String> {
    secrets::set_api_key(&key)?;
    Ok(secrets::hint(key.trim()))
}

/// `None` si aucune clé n'est enregistrée.
#[tauri::command]
pub fn get_api_key_hint() -> AppResult<Option<String>> {
    Ok(secrets::get_api_key()?.map(|key| secrets::hint(&key)))
}

#[tauri::command]
pub fn clear_api_key() -> AppResult<()> {
    secrets::clear_api_key()
}
