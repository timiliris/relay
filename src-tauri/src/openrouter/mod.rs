//! Client OpenRouter : liste des modèles, crédits, complétion (streaming ou non).
//!
//! Toutes les requêtes partent de Rust : la clé API ne quitte jamais le trousseau
//! système pour le webview. Le streaming est relayé au frontend via un `Channel`.

pub mod sse;

use std::collections::HashMap;
use std::sync::Mutex;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::{AppError, AppResult};
use sse::{Chunk, SseData, SseParser};

const BASE_URL: &str = "https://openrouter.ai/api/v1";
/// En-têtes recommandés par OpenRouter pour identifier l'application.
const REFERER: &str = "https://github.com/example/relay";
const TITLE: &str = "Relay";

pub struct OpenRouterState {
    pub client: reqwest::Client,
    /// Flux en cours, annulables par identifiant de requête.
    streams: Mutex<HashMap<String, CancellationToken>>,
}

impl OpenRouterState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("relay/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("client HTTP");
        Self {
            client,
            streams: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, request_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.streams
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(request_id.to_string(), token.clone());
        token
    }

    pub fn finish(&self, request_id: &str) {
        self.streams
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(request_id);
    }

    pub fn cancel(&self, request_id: &str) {
        if let Some(token) = self
            .streams
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(request_id)
        {
            token.cancel();
        }
    }
}

impl Default for OpenRouterState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub top_p: Option<f64>,
    /// Demande au modèle d'exposer son raisonnement (modèles compatibles).
    #[serde(default)]
    pub reasoning: bool,
}

#[derive(Serialize)]
struct Body<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
    usage: UsageOption,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<ReasoningOption>,
}

#[derive(Serialize)]
struct UsageOption {
    include: bool,
}

#[derive(Serialize)]
struct ReasoningOption {
    enabled: bool,
}

impl<'a> Body<'a> {
    fn new(req: &'a ChatRequest, stream: bool) -> Self {
        Self {
            model: &req.model,
            messages: &req.messages,
            stream,
            usage: UsageOption { include: true },
            temperature: req.temperature,
            max_tokens: req.max_tokens,
            top_p: req.top_p,
            reasoning: req.reasoning.then_some(ReasoningOption { enabled: true }),
        }
    }
}

/// Événements relayés au frontend pendant un streaming.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    Delta {
        content: String,
    },
    Reasoning {
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    Usage {
        prompt_tokens: u32,
        completion_tokens: u32,
        cost: Option<f64>,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        finish_reason: Option<String>,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credits {
    pub total_credits: f64,
    pub total_usage: f64,
}

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    error: sse::ApiError,
}

#[derive(Deserialize)]
struct Completion {
    #[serde(default)]
    choices: Vec<CompletionChoice>,
}

#[derive(Deserialize)]
struct CompletionChoice {
    message: ChatMessage,
}

fn authed(builder: reqwest::RequestBuilder, api_key: &str) -> reqwest::RequestBuilder {
    builder
        .bearer_auth(api_key)
        .header("HTTP-Referer", REFERER)
        .header("X-Title", TITLE)
}

/// Transforme une réponse HTTP en erreur lisible (`{"error":{"message":…}}`).
async fn ensure_success(response: reqwest::Response) -> AppResult<reqwest::Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let text = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<ErrorEnvelope>(&text)
        .map(|e| e.error.message)
        .unwrap_or(text);
    Err(AppError::Api {
        status: status.as_u16(),
        message,
    })
}

/// Liste publique des modèles (aucune clé nécessaire). Renvoyée brute : le
/// frontend ne garde que les champs qu'il affiche (`src/lib/openrouter.ts`).
pub async fn models(client: &reqwest::Client) -> AppResult<serde_json::Value> {
    let response = client.get(format!("{BASE_URL}/models")).send().await?;
    let envelope: Envelope<serde_json::Value> = ensure_success(response).await?.json().await?;
    Ok(envelope.data)
}

pub async fn credits(client: &reqwest::Client, api_key: &str) -> AppResult<Credits> {
    let response = authed(client.get(format!("{BASE_URL}/credits")), api_key)
        .send()
        .await?;
    let envelope: Envelope<Credits> = ensure_success(response).await?.json().await?;
    Ok(envelope.data)
}

/// Complétion sans streaming (titres automatiques, etc.).
pub async fn complete(
    client: &reqwest::Client,
    api_key: &str,
    request: &ChatRequest,
) -> AppResult<String> {
    let response = authed(client.post(format!("{BASE_URL}/chat/completions")), api_key)
        .json(&Body::new(request, false))
        .send()
        .await?;
    let completion: Completion = ensure_success(response).await?.json().await?;
    Ok(completion
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .unwrap_or_default())
}

/// Complétion en streaming : chaque fragment est transmis à `emit`.
/// L'annulation via `cancel` termine proprement par un `Done { "cancelled" }`.
pub async fn stream(
    client: &reqwest::Client,
    api_key: &str,
    request: &ChatRequest,
    cancel: CancellationToken,
    emit: impl Fn(StreamEvent),
) -> AppResult<()> {
    let response = authed(client.post(format!("{BASE_URL}/chat/completions")), api_key)
        .json(&Body::new(request, true))
        .send()
        .await?;
    let mut bytes = ensure_success(response).await?.bytes_stream();
    let mut parser = SseParser::new();
    let mut finish_reason: Option<String> = None;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                emit(StreamEvent::Done { finish_reason: Some("cancelled".into()) });
                return Ok(());
            }
            next = bytes.next() => {
                let Some(item) = next else { break };
                for event in parser.push(&item?) {
                    match event {
                        SseData::Done => {
                            emit(StreamEvent::Done { finish_reason });
                            return Ok(());
                        }
                        SseData::Json(json) => {
                            let chunk: Chunk = match serde_json::from_str(&json) {
                                Ok(chunk) => chunk,
                                Err(err) => {
                                    log::warn!("fragment SSE illisible : {err}");
                                    continue;
                                }
                            };
                            if let Some(error) = chunk.error {
                                emit(StreamEvent::Error { message: error.message });
                                return Ok(());
                            }
                            for choice in chunk.choices {
                                if let Some(content) = choice.delta.content.filter(|c| !c.is_empty()) {
                                    emit(StreamEvent::Delta { content });
                                }
                                if let Some(content) = choice.delta.reasoning.filter(|c| !c.is_empty()) {
                                    emit(StreamEvent::Reasoning { content });
                                }
                                if choice.finish_reason.is_some() {
                                    finish_reason = choice.finish_reason;
                                }
                            }
                            if let Some(usage) = chunk.usage {
                                emit(StreamEvent::Usage {
                                    prompt_tokens: usage.prompt_tokens,
                                    completion_tokens: usage.completion_tokens,
                                    cost: usage.cost,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    emit(StreamEvent::Done { finish_reason });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vérifie le client HTTP (TLS, en-têtes) et la forme de la réponse sur l'API réelle.
    /// Réseau requis : `cargo test -- --ignored fetch_models_live`.
    #[tokio::test]
    #[ignore]
    async fn fetch_models_live() {
        let state = OpenRouterState::new();
        let models = models(&state.client).await.expect("liste des modèles");
        let list = models.as_array().expect("tableau de modèles");
        assert!(list.len() > 50, "seulement {} modèles", list.len());
        assert!(list[0].get("id").and_then(|v| v.as_str()).is_some());
        assert!(list[0].get("pricing").is_some());
    }

    #[test]
    fn body_omits_unset_parameters() {
        let request = ChatRequest {
            model: "openrouter/auto".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "Salut".into(),
            }],
            temperature: Some(0.7),
            max_tokens: None,
            top_p: None,
            reasoning: false,
        };
        let json = serde_json::to_value(Body::new(&request, true)).unwrap();
        assert_eq!(json["stream"], true);
        assert_eq!(json["usage"]["include"], true);
        assert_eq!(json["temperature"], 0.7);
        assert!(json.get("max_tokens").is_none());
        assert!(json.get("reasoning").is_none());
    }
}
