//! Commandes exposant le client OpenRouter au frontend.

use tauri::State;
use tauri::ipc::Channel;

use crate::openrouter::{self, ChatRequest, Credits, OpenRouterState, StreamEvent};
use crate::{AppError, AppResult, secrets};

fn api_key() -> AppResult<String> {
    secrets::get_api_key()?.ok_or(AppError::Validation("api_key_missing"))
}

#[tauri::command]
pub async fn fetch_models(state: State<'_, OpenRouterState>) -> AppResult<serde_json::Value> {
    openrouter::models(&state).await
}

#[tauri::command]
pub async fn fetch_credits(state: State<'_, OpenRouterState>) -> AppResult<Credits> {
    openrouter::credits(&state, &api_key()?).await
}

/// Complétion non streamée (titre automatique d'une conversation, par exemple).
#[tauri::command]
pub async fn complete_chat(
    state: State<'_, OpenRouterState>,
    request: ChatRequest,
) -> AppResult<String> {
    openrouter::complete(&state, &api_key()?, &request).await
}

/// Complétion en streaming. Les fragments arrivent sur `on_event` ; la commande
/// se termine quand le flux est clos, en erreur ou annulé via `cancel_stream`.
#[tauri::command]
pub async fn stream_chat(
    state: State<'_, OpenRouterState>,
    request_id: String,
    request: ChatRequest,
    on_event: Channel<StreamEvent>,
) -> AppResult<()> {
    let api_key = api_key()?;
    let cancel = state.register(&request_id);
    let result = openrouter::stream(&state, &api_key, &request, cancel, |event| {
        if let Err(err) = on_event.send(event) {
            log::warn!("envoi d'un événement de streaming impossible : {err}");
        }
    })
    .await;
    state.finish(&request_id);
    result
}

#[tauri::command]
pub fn cancel_stream(state: State<'_, OpenRouterState>, request_id: String) {
    state.cancel(&request_id);
}
