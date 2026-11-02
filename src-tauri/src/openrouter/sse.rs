//! Analyse incrémentale d'un flux Server-Sent Events (SSE) tel que renvoyé par
//! OpenRouter : une ligne `data: {json}` par événement, `data: [DONE]` en fin de
//! flux, et des lignes de commentaire `: OPENROUTER PROCESSING` à ignorer.

use serde::Deserialize;

#[derive(Debug, Default)]
pub struct SseParser {
    buffer: String,
}

/// Un événement `data:` décodé.
#[derive(Debug, PartialEq)]
pub enum SseData {
    Done,
    Json(String),
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Ajoute des octets reçus et renvoie les événements complets disponibles.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseData> {
        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        let mut events = Vec::new();

        while let Some(pos) = self.buffer.find('\n') {
            let line = self.buffer[..pos].trim_end_matches('\r').to_string();
            self.buffer.drain(..=pos);

            let Some(data) = line.strip_prefix("data:") else {
                continue; // commentaire, ligne vide ou champ `event:` ignoré
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                events.push(SseData::Done);
            } else {
                events.push(SseData::Json(data.to_string()));
            }
        }
        events
    }
}

/// Fragment de réponse en streaming (sous-ensemble du schéma OpenAI / OpenRouter).
#[derive(Debug, Deserialize, Default)]
pub struct Chunk {
    #[serde(default)]
    pub choices: Vec<Choice>,
    pub usage: Option<Usage>,
    pub error: Option<ApiError>,
}

#[derive(Debug, Deserialize, Default)]
pub struct Choice {
    #[serde(default)]
    pub delta: Delta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct Delta {
    pub content: Option<String>,
    pub reasoning: Option<String>,
    /// Images produites par un modèle à sortie image (`modalities: ["image", "text"]`).
    #[serde(default)]
    pub images: Vec<ImagePart>,
    /// Fragments d'appels d'outils, à accumuler par `index` (le nom arrive avec le
    /// premier fragment, les arguments JSON suivent morceau par morceau).
    #[serde(default)]
    pub tool_calls: Vec<ToolCallDelta>,
}

/// Fragment d'appel d'outil en streaming : `{ "index": 0, "id": "call_…", "type": "function",
/// "function": { "name": "read_file", "arguments": "{\"pa" } }`.
#[derive(Debug, Deserialize, Clone, PartialEq)]
pub struct ToolCallDelta {
    #[serde(default)]
    pub index: u32,
    pub id: Option<String>,
    pub function: Option<FunctionDelta>,
}

#[derive(Debug, Deserialize, Clone, PartialEq, Default)]
pub struct FunctionDelta {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

/// Image générée : `{ "type": "image_url", "image_url": { "url": "data:image/png;base64,…" } }`.
#[derive(Debug, Deserialize, Clone, PartialEq)]
pub struct ImagePart {
    pub image_url: ImageUrl,
}

#[derive(Debug, Deserialize, Clone, PartialEq)]
pub struct ImageUrl {
    pub url: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Usage {
    #[serde(default)]
    pub prompt_tokens: u32,
    #[serde(default)]
    pub completion_tokens: u32,
    pub cost: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct ApiError {
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_events_across_chunks_and_ignores_comments() {
        let mut parser = SseParser::new();
        let first = parser.push(b": OPENROUTER PROCESSING\n\ndata: {\"a\":1}\ndata: {\"b\"");
        assert_eq!(first, vec![SseData::Json("{\"a\":1}".into())]);

        let second = parser.push(b":2}\r\n\ndata: [DONE]\n");
        assert_eq!(
            second,
            vec![SseData::Json("{\"b\":2}".into()), SseData::Done]
        );
    }

    #[test]
    fn parses_a_delta_chunk() {
        let json = r#"{"id":"gen-1","choices":[{"delta":{"content":"Bon","reasoning":null},"finish_reason":null}],"usage":null}"#;
        let chunk: Chunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.choices[0].delta.content.as_deref(), Some("Bon"));
        assert!(chunk.usage.is_none());
    }

    #[test]
    fn parses_a_delta_chunk_with_generated_images() {
        let json = r#"{"id":"gen-2","choices":[{"delta":{"role":"assistant","content":"Voici :","images":[{"type":"image_url","index":0,"image_url":{"url":"data:image/png;base64,iVBORw0KGgo="}}]},"finish_reason":null}]}"#;
        let chunk: Chunk = serde_json::from_str(json).unwrap();
        let delta = &chunk.choices[0].delta;
        assert_eq!(delta.content.as_deref(), Some("Voici :"));
        assert_eq!(delta.images.len(), 1);
        assert_eq!(
            delta.images[0].image_url.url,
            "data:image/png;base64,iVBORw0KGgo="
        );
    }

    #[test]
    fn delta_without_images_defaults_to_empty() {
        let json = r#"{"choices":[{"delta":{"content":"x"}}]}"#;
        let chunk: Chunk = serde_json::from_str(json).unwrap();
        assert!(chunk.choices[0].delta.images.is_empty());
    }

    #[test]
    fn parses_tool_call_fragments() {
        let first = r#"{"choices":[{"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":""}}]},"finish_reason":null}]}"#;
        let chunk: Chunk = serde_json::from_str(first).unwrap();
        let call = &chunk.choices[0].delta.tool_calls[0];
        assert_eq!(call.index, 0);
        assert_eq!(call.id.as_deref(), Some("call_1"));
        assert_eq!(
            call.function.as_ref().and_then(|f| f.name.as_deref()),
            Some("read_file")
        );

        let next = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":\"a.rs\"}"}}]},"finish_reason":"tool_calls"}]}"#;
        let chunk: Chunk = serde_json::from_str(next).unwrap();
        let call = &chunk.choices[0].delta.tool_calls[0];
        assert!(call.id.is_none());
        assert_eq!(
            call.function.as_ref().and_then(|f| f.arguments.as_deref()),
            Some(r#"{"path":"a.rs"}"#)
        );
        assert_eq!(
            chunk.choices[0].finish_reason.as_deref(),
            Some("tool_calls")
        );
    }

    #[test]
    fn parses_final_usage_chunk() {
        let json = r#"{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":34,"cost":0.00012}}"#;
        let chunk: Chunk = serde_json::from_str(json).unwrap();
        let usage = chunk.usage.unwrap();
        assert_eq!((usage.prompt_tokens, usage.completion_tokens), (12, 34));
        assert_eq!(chunk.choices[0].finish_reason.as_deref(), Some("stop"));
    }
}
