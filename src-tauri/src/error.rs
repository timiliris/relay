//! Erreur unique de l'application.
//!
//! Toute commande renvoie `AppResult<T>`. Côté frontend, `invoke` rejette avec
//! un objet `{ kind, code, message }`. Le `code` (stable, en snake_case) permet
//! au frontend de traduire le message (clé `errors.<code>`).

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Entrée invalide ou pré-requis manquant : le paramètre est le code d'erreur.
    #[error("validation error: {0}")]
    Validation(&'static str),

    /// Réponse d'erreur de l'API OpenRouter.
    #[error("{message} (HTTP {status})")]
    Api { status: u16, message: String },

    #[error(transparent)]
    Http(#[from] reqwest::Error),

    #[error(transparent)]
    Keyring(#[from] keyring::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type AppResult<T> = Result<T, AppError>;

/// Forme envoyée au frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload<'a> {
    kind: &'a str,
    code: Option<&'a str>,
    status: Option<u16>,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let (kind, code, status) = match self {
            AppError::Validation(code) => ("validation", Some(*code), None),
            AppError::Api { status, .. } => ("api", None, Some(*status)),
            AppError::Http(_) => ("http", Some("network"), None),
            AppError::Keyring(_) => ("keyring", Some("keyring"), None),
            AppError::Io(_) => ("io", None, None),
            AppError::Tauri(_) => ("tauri", None, None),
            AppError::Json(_) => ("json", None, None),
        };
        ErrorPayload {
            kind,
            code,
            status,
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}
