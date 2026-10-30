/**
 * Wrappers typés des commandes Rust liées à OpenRouter (`src-tauri/src/commands/openrouter.rs`
 * et `secrets.rs`). Les requêtes HTTP et la clé API restent côté Rust.
 */
import { Channel, invoke } from '@tauri-apps/api/core';

export type Role = 'system' | 'user' | 'assistant';

/** Partie d'un message multimodal (format OpenAI / OpenRouter). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export interface ChatMessageInput {
  role: Role;
  content: string | ContentPart[];
}

export type ProviderSort = 'price' | 'throughput' | 'latency';

export interface ChatRequest {
  model: string;
  messages: ChatMessageInput[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  reasoning?: boolean;
  webSearch?: boolean;
  providerSort?: ProviderSort;
  ignoreProviders?: string[];
  dataCollectionDeny?: boolean;
}

export type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number; cost: number | null }
  | { type: 'done'; finishReason: string | null }
  | { type: 'error'; message: string };

export interface Credits {
  totalCredits: number;
  totalUsage: number;
}

/** Vue simplifiée d'un modèle OpenRouter, prix exprimés en $ par million de tokens. */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextLength: number;
  promptPrice: number;
  completionPrice: number;
  inputModalities: string[];
  supportsReasoning: boolean;
  created: number;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  created?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { input_modalities?: unknown };
  supported_parameters?: unknown;
}

const perMillion = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n * 1_000_000 : 0;
};

export function normalizeModel(raw: unknown): ModelInfo | null {
  const m = raw as RawModel;
  if (typeof m?.id !== 'string') return null;
  const params = Array.isArray(m.supported_parameters) ? (m.supported_parameters as string[]) : [];
  return {
    id: m.id,
    name: typeof m.name === 'string' ? m.name : m.id,
    provider: m.id.split('/')[0] ?? '',
    description: typeof m.description === 'string' ? m.description : '',
    contextLength: typeof m.context_length === 'number' ? m.context_length : 0,
    promptPrice: perMillion(m.pricing?.prompt),
    completionPrice: perMillion(m.pricing?.completion),
    inputModalities: Array.isArray(m.architecture?.input_modalities)
      ? (m.architecture.input_modalities as string[])
      : ['text'],
    supportsReasoning: params.includes('reasoning') || params.includes('include_reasoning'),
    created: typeof m.created === 'number' ? m.created : 0,
  };
}

export const supportsImages = (model: ModelInfo | undefined): boolean =>
  model?.inputModalities.includes('image') ?? false;

export const supportsFiles = (model: ModelInfo | undefined): boolean =>
  model?.inputModalities.includes('file') ?? false;

export const openrouter = {
  async fetchModels(): Promise<ModelInfo[]> {
    const raw = await invoke<unknown[]>('fetch_models');
    return raw.map(normalizeModel).filter((m): m is ModelInfo => m !== null);
  },
  fetchCredits: () => invoke<Credits>('fetch_credits'),
  completeChat: (request: ChatRequest) => invoke<string>('complete_chat', { request }),
  /** Démarre un streaming ; la promesse se résout quand le flux est terminé. */
  streamChat(requestId: string, request: ChatRequest, onEvent: (event: StreamEvent) => void) {
    const channel = new Channel<StreamEvent>();
    channel.onmessage = onEvent;
    return invoke<void>('stream_chat', { requestId, request, onEvent: channel });
  },
  cancelStream: (requestId: string) => invoke<void>('cancel_stream', { requestId }),
  setApiKey: (key: string) => invoke<string>('set_api_key', { key }),
  getApiKeyHint: () => invoke<string | null>('get_api_key_hint'),
  clearApiKey: () => invoke<void>('clear_api_key'),
} as const;
