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

pub const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";
/// Variable d'environnement permettant de viser un autre serveur (tests, proxy).
pub const BASE_URL_ENV: &str = "RELAY_OPENROUTER_BASE_URL";
/// En-têtes recommandés par OpenRouter pour identifier l'application.
const REFERER: &str = "https://github.com/example/relay";
const TITLE: &str = "Relay";

pub struct OpenRouterState {
    pub client: reqwest::Client,
    pub base_url: String,
    /// Flux en cours, annulables par identifiant de requête.
    streams: Mutex<HashMap<String, CancellationToken>>,
}

impl OpenRouterState {
    pub fn new() -> Self {
        let base_url = std::env::var(BASE_URL_ENV).unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
        Self::with_base_url(base_url)
    }

    pub fn with_base_url(base_url: impl Into<String>) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("relay/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("client HTTP");
        Self {
            client,
            base_url: base_url.into().trim_end_matches('/').to_string(),
            streams: Mutex::new(HashMap::new()),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base_url)
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

/// Message au format OpenAI. `content` est une chaîne ou un tableau de parties
/// (texte, image, fichier) : il est relayé tel quel à l'API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: serde_json::Value,
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
    /// Active le plugin de recherche web d'OpenRouter.
    #[serde(default)]
    pub web_search: bool,
    /// Préférence de routage : `price`, `throughput` ou `latency`.
    #[serde(default)]
    pub provider_sort: Option<String>,
    /// Fournisseurs à exclure (ex. `["OpenAI"]`).
    #[serde(default)]
    pub ignore_providers: Vec<String>,
    /// Refuse les fournisseurs qui conservent ou entraînent sur les données.
    #[serde(default)]
    pub data_collection_deny: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    plugins: Option<Vec<Plugin>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<ProviderPrefs>,
}

#[derive(Serialize)]
struct UsageOption {
    include: bool,
}

#[derive(Serialize)]
struct ReasoningOption {
    enabled: bool,
}

#[derive(Serialize)]
struct Plugin {
    id: &'static str,
}

#[derive(Serialize, Default)]
struct ProviderPrefs {
    #[serde(skip_serializing_if = "Option::is_none")]
    sort: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    ignore: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_collection: Option<&'static str>,
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
            plugins: req.web_search.then(|| vec![Plugin { id: "web" }]),
            provider: provider_prefs(req),
        }
    }
}

fn provider_prefs(req: &ChatRequest) -> Option<ProviderPrefs> {
    if req.provider_sort.is_none() && req.ignore_providers.is_empty() && !req.data_collection_deny {
        return None;
    }
    Some(ProviderPrefs {
        sort: req.provider_sort.clone(),
        ignore: req.ignore_providers.clone(),
        data_collection: req.data_collection_deny.then_some("deny"),
    })
}

/// Événements relayés au frontend pendant un streaming.
#[derive(Debug, Clone, Serialize, PartialEq)]
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
pub async fn models(state: &OpenRouterState) -> AppResult<serde_json::Value> {
    let response = state.client.get(state.url("/models")).send().await?;
    let envelope: Envelope<serde_json::Value> = ensure_success(response).await?.json().await?;
    Ok(envelope.data)
}

pub async fn credits(state: &OpenRouterState, api_key: &str) -> AppResult<Credits> {
    let response = authed(state.client.get(state.url("/credits")), api_key)
        .send()
        .await?;
    let envelope: Envelope<Credits> = ensure_success(response).await?.json().await?;
    Ok(envelope.data)
}

/// Complétion sans streaming (titres automatiques, résumés, etc.).
pub async fn complete(
    state: &OpenRouterState,
    api_key: &str,
    request: &ChatRequest,
) -> AppResult<String> {
    let response = authed(state.client.post(state.url("/chat/completions")), api_key)
        .json(&Body::new(request, false))
        .send()
        .await?;
    let completion: Completion = ensure_success(response).await?.json().await?;
    Ok(completion
        .choices
        .into_iter()
        .next()
        .map(|c| match c.message.content {
            serde_json::Value::String(text) => text,
            other => other.to_string(),
        })
        .unwrap_or_default())
}

/// Complétion en streaming : chaque fragment est transmis à `emit`.
/// L'annulation via `cancel` termine proprement par un `Done { "cancelled" }`.
pub async fn stream(
    state: &OpenRouterState,
    api_key: &str,
    request: &ChatRequest,
    cancel: CancellationToken,
    emit: impl Fn(StreamEvent),
) -> AppResult<()> {
    let response = authed(state.client.post(state.url("/chat/completions")), api_key)
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
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Mutex;
    use std::time::Duration;

    use super::*;

    fn request(model: &str, prompt: &str) -> ChatRequest {
        ChatRequest {
            model: model.into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: serde_json::Value::String(prompt.into()),
            }],
            temperature: Some(0.7),
            max_tokens: None,
            top_p: None,
            reasoning: false,
            web_search: false,
            provider_sort: None,
            ignore_providers: vec![],
            data_collection_deny: false,
        }
    }

    /// Serveur HTTP minimal qui répond à chaque connexion par un flux SSE scénarisé.
    /// `lines` sont envoyées avec `delay` entre chacune ; la connexion est ensuite fermée.
    fn sse_server(lines: Vec<&'static str>, delay: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("port local");
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let lines = lines.clone();
                std::thread::spawn(move || {
                    let mut buf = [0u8; 8192];
                    let _ = stream.read(&mut buf);
                    let _ = stream.write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
                    );
                    for line in lines {
                        if stream.write_all(line.as_bytes()).is_err() {
                            return;
                        }
                        let _ = stream.flush();
                        std::thread::sleep(delay);
                    }
                });
            }
        });
        format!("http://{addr}")
    }

    fn collect(events: &Mutex<Vec<StreamEvent>>) -> Vec<StreamEvent> {
        events.lock().unwrap().clone()
    }

    #[tokio::test]
    async fn streams_a_full_response_from_a_local_server() {
        let base = sse_server(
            vec![
                ": OPENROUTER PROCESSING\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"Bon\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"jour\"},\"finish_reason\":\"stop\"}]}\n\n",
                "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"cost\":0.0001}}\n\n",
                "data: [DONE]\n\n",
            ],
            Duration::from_millis(10),
        );
        let state = OpenRouterState::with_base_url(base);
        let events = Mutex::new(Vec::new());
        stream(
            &state,
            "test-key",
            &request("test/model", "Salut"),
            CancellationToken::new(),
            |e| events.lock().unwrap().push(e),
        )
        .await
        .expect("flux complet");

        assert_eq!(
            collect(&events),
            vec![
                StreamEvent::Delta {
                    content: "Bon".into()
                },
                StreamEvent::Delta {
                    content: "jour".into()
                },
                StreamEvent::Usage {
                    prompt_tokens: 5,
                    completion_tokens: 2,
                    cost: Some(0.0001)
                },
                StreamEvent::Done {
                    finish_reason: Some("stop".into())
                },
            ]
        );
    }

    #[tokio::test]
    async fn cancellation_stops_the_stream_promptly() {
        let base = sse_server(
            vec![
                "data: {\"choices\":[{\"delta\":{\"content\":\"Début\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\" suite\"}}]}\n\n",
                "data: [DONE]\n\n",
            ],
            Duration::from_secs(5),
        );
        let state = OpenRouterState::with_base_url(base);
        let token = state.register("req-1");
        let events = Mutex::new(Vec::new());
        let started = std::time::Instant::now();

        let cancel_after_first = |e: StreamEvent| {
            if matches!(e, StreamEvent::Delta { .. }) {
                state.cancel("req-1");
            }
            events.lock().unwrap().push(e);
        };
        stream(
            &state,
            "test-key",
            &request("test/model", "Salut"),
            token,
            cancel_after_first,
        )
        .await
        .expect("annulation propre");
        state.finish("req-1");

        assert!(
            started.elapsed() < Duration::from_secs(3),
            "l'annulation doit être immédiate"
        );
        assert_eq!(
            collect(&events),
            vec![
                StreamEvent::Delta {
                    content: "Début".into()
                },
                StreamEvent::Done {
                    finish_reason: Some("cancelled".into())
                },
            ]
        );
    }

    #[tokio::test]
    async fn api_errors_are_mapped_with_status_and_message() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 8192];
                let _ = stream.read(&mut buf);
                let body = r#"{"error":{"message":"No auth credentials found","code":401}}"#;
                let _ = write!(
                    stream,
                    "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        let state = OpenRouterState::with_base_url(format!("http://{addr}"));
        let err = credits(&state, "bad-key").await.expect_err("401 attendu");
        match err {
            AppError::Api { status, message } => {
                assert_eq!(status, 401);
                assert_eq!(message, "No auth credentials found");
            }
            other => panic!("erreur inattendue : {other:?}"),
        }
    }

    /// Vérifie le client HTTP (TLS, en-têtes) et la forme de la réponse sur l'API réelle.
    /// Réseau requis : `cargo test -- --ignored fetch_models_live`.
    #[tokio::test]
    #[ignore]
    async fn fetch_models_live() {
        let state = OpenRouterState::new();
        let models = models(&state).await.expect("liste des modèles");
        let list = models.as_array().expect("tableau de modèles");
        assert!(list.len() > 50, "seulement {} modèles", list.len());
        assert!(list[0].get("id").and_then(|v| v.as_str()).is_some());
        assert!(list[0].get("pricing").is_some());
    }

    /// Parcours réel de bout en bout : clé lue dans le trousseau système, modèle gratuit
    /// choisi dans le catalogue, réponse streamée. Réseau + clé configurée requis :
    /// `cargo test -- --ignored stream_chat_live`.
    #[tokio::test]
    #[ignore]
    async fn stream_chat_live() {
        let api_key = crate::secrets::get_api_key()
            .expect("trousseau")
            .expect("aucune clé OpenRouter dans le trousseau");
        let state = OpenRouterState::new();

        // Les modèles gratuits sont parfois indisponibles (503) : on en essaie plusieurs.
        let models = models(&state).await.expect("modèles");
        let free_models: Vec<String> = models
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["pricing"]["prompt"] == "0" && m["pricing"]["completion"] == "0")
            .filter_map(|m| m["id"].as_str())
            .filter(|id| id.ends_with(":free"))
            .take(6)
            .map(str::to_string)
            .collect();
        assert!(
            !free_models.is_empty(),
            "aucun modèle gratuit dans le catalogue"
        );

        let prompt = "Réponds uniquement par le mot OK.";
        let mut last_error = None;
        for free_model in &free_models {
            let events = Mutex::new(Vec::new());
            let result = stream(
                &state,
                &api_key,
                &request(free_model, prompt),
                CancellationToken::new(),
                |e| events.lock().unwrap().push(e),
            )
            .await;
            let events = collect(&events);
            if let Err(err) = result {
                println!("{free_model} : {err}");
                last_error = Some(err.to_string());
                continue;
            }
            if let Some(StreamEvent::Error { message }) = events
                .iter()
                .find(|e| matches!(e, StreamEvent::Error { .. }))
            {
                println!("{free_model} : {message}");
                last_error = Some(message.clone());
                continue;
            }
            let text: String = events
                .iter()
                .filter_map(|e| match e {
                    StreamEvent::Delta { content } => Some(content.as_str()),
                    _ => None,
                })
                .collect();
            assert!(!text.trim().is_empty(), "aucun texte reçu de {free_model}");
            assert!(
                matches!(events.last(), Some(StreamEvent::Done { .. })),
                "le flux doit se terminer par Done : {events:?}"
            );
            assert!(
                events
                    .iter()
                    .any(|e| matches!(e, StreamEvent::Usage { .. })),
                "l'usage doit être renvoyé : {events:?}"
            );
            println!("modèle {free_model} → {text:?}");
            return;
        }
        panic!("aucun modèle gratuit n'a répondu : {last_error:?}");
    }

    #[test]
    fn body_omits_unset_parameters() {
        let json =
            serde_json::to_value(Body::new(&request("openrouter/auto", "Salut"), true)).unwrap();
        assert_eq!(json["stream"], true);
        assert_eq!(json["usage"]["include"], true);
        assert_eq!(json["temperature"], 0.7);
        assert_eq!(json["messages"][0]["content"], "Salut");
        assert!(json.get("max_tokens").is_none());
        assert!(json.get("reasoning").is_none());
        assert!(json.get("plugins").is_none());
        assert!(json.get("provider").is_none());
    }

    #[test]
    fn body_keeps_multimodal_content_untouched() {
        let parts = serde_json::json!([
            { "type": "text", "text": "Regarde" },
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAA" } }
        ]);
        let mut req = request("test/vision", "");
        req.messages[0].content = parts.clone();
        let json = serde_json::to_value(Body::new(&req, true)).unwrap();
        assert_eq!(json["messages"][0]["content"], parts);
    }

    #[test]
    fn body_includes_openrouter_options() {
        let req = ChatRequest {
            reasoning: true,
            web_search: true,
            provider_sort: Some("price".into()),
            ignore_providers: vec!["OpenAI".into()],
            data_collection_deny: true,
            ..request("openrouter/auto", "Salut")
        };
        let json = serde_json::to_value(Body::new(&req, false)).unwrap();
        assert_eq!(json["reasoning"]["enabled"], true);
        assert_eq!(json["plugins"][0]["id"], "web");
        assert_eq!(json["provider"]["sort"], "price");
        assert_eq!(json["provider"]["ignore"][0], "OpenAI");
        assert_eq!(json["provider"]["data_collection"], "deny");
    }
}
