/**
 * Wrappers typés des commandes Rust liées à OpenRouter (`src-tauri/src/commands/openrouter.rs`
 * et `secrets.rs`). Les requêtes HTTP et la clé API restent côté Rust.
 */
import { Channel, invoke } from '@tauri-apps/api/core';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** Appel d'outil demandé par le modèle ; `arguments` est la chaîne JSON reçue. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Appel d'outil au format OpenAI, tel qu'il est renvoyé dans l'historique. */
export interface ToolCallPayload {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export const toToolCallPayload = (call: ToolCall): ToolCallPayload => ({
  id: call.id,
  type: 'function',
  function: { name: call.name, arguments: call.arguments },
});

/** Outil proposé au modèle (`tools` de la requête). */
export interface ToolDefinitionInput {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ToolChoice = 'auto' | 'none' | { type: 'function'; function: { name: string } };

/** Partie d'un message multimodal (format OpenAI / OpenRouter). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export interface ChatMessageInput {
  role: Role;
  content: string | ContentPart[];
  /** Images générées par l'assistant à un tour précédent (champ `images` de l'API). */
  images?: Extract<ContentPart, { type: 'image_url' }>[];
  /** Appels d'outils d'un message assistant (noms de champs de l'API, relayés tels quels par Rust). */
  tool_calls?: ToolCallPayload[];
  /** Pour `role: 'tool'` : identifiant de l'appel auquel ce message répond. */
  tool_call_id?: string;
}

/** Modalités de sortie demandées ; `['image', 'text']` active la génération d'images. */
export type OutputModality = 'text' | 'image';

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
  modalities?: OutputModality[];
  tools?: ToolDefinitionInput[];
  toolChoice?: ToolChoice;
  parallelToolCalls?: boolean;
}

export type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'reasoning'; content: string }
  /** Image générée, sous forme de data URL (`data:image/png;base64,…`). */
  | { type: 'image'; url: string }
  /** Le modèle commence un appel d'outil (arguments encore en cours de réception). */
  | { type: 'toolCallStart'; id: string; name: string }
  /** Appels d'outils complets, juste avant `done` (`finishReason: 'tool_calls'`). */
  | { type: 'toolCalls'; calls: ToolCall[] }
  | { type: 'usage'; promptTokens: number; completionTokens: number; cost: number | null }
  | { type: 'done'; finishReason: string | null }
  | { type: 'error'; message: string };

/** Résultat d'une complétion non streamée : texte et images générées (data URLs). */
export interface CompletionOutput {
  content: string;
  images: string[];
  toolCalls: ToolCall[];
}

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
  outputModalities: string[];
  supportsReasoning: boolean;
  /** `supported_parameters` contient `tools` : appels d'outils (mode agent) possibles. */
  supportsTools: boolean;
  created: number;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  created?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
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
    outputModalities: Array.isArray(m.architecture?.output_modalities)
      ? (m.architecture.output_modalities as string[])
      : ['text'],
    supportsReasoning: params.includes('reasoning') || params.includes('include_reasoning'),
    supportsTools: params.includes('tools'),
    created: typeof m.created === 'number' ? m.created : 0,
  };
}

export const supportsImages = (model: ModelInfo | undefined): boolean =>
  model?.inputModalities.includes('image') ?? false;

export const supportsFiles = (model: ModelInfo | undefined): boolean =>
  model?.inputModalities.includes('file') ?? false;

/** Le modèle produit des images (`architecture.output_modalities` contient `image`). */
export const supportsImageOutput = (model: ModelInfo | undefined): boolean =>
  model?.outputModalities.includes('image') ?? false;

/** Le modèle accepte les appels d'outils (`supported_parameters` contient `tools`). */
export const supportsTools = (model: ModelInfo | undefined): boolean =>
  model?.supportsTools ?? false;

/** Délai maximal d'attente de l'événement terminal après le retour de la commande Rust. */
const STREAM_SETTLE_MS = 10_000;

export const openrouter = {
  async fetchModels(): Promise<ModelInfo[]> {
    const raw = await invoke<unknown[]>('fetch_models');
    return raw.map(normalizeModel).filter((m): m is ModelInfo => m !== null);
  },
  fetchCredits: () => invoke<Credits>('fetch_credits'),
  completeChat: (request: ChatRequest) => invoke<CompletionOutput>('complete_chat', { request }),
  /**
   * Démarre un streaming ; la promesse se résout quand l'événement terminal (`done` ou `error`)
   * a été reçu. La commande Rust rend la main dès que le flux HTTP est fini, mais les derniers
   * messages du canal (un appel d'outil de plusieurs dizaines de Ko, puis `done`) peuvent être
   * livrés après : sans cette attente, le message serait persisté avec des arguments vides.
   */
  async streamChat(
    requestId: string,
    request: ChatRequest,
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> {
    let settle: () => void = () => {};
    const terminal = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const channel = new Channel<StreamEvent>();
    channel.onmessage = (event) => {
      onEvent(event);
      if (event.type === 'done' || event.type === 'error') settle();
    };
    await invoke<void>('stream_chat', { requestId, request, onEvent: channel });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, STREAM_SETTLE_MS);
    });
    try {
      await Promise.race([terminal, guard]);
    } finally {
      clearTimeout(timer);
    }
  },
  cancelStream: (requestId: string) => invoke<void>('cancel_stream', { requestId }),
  setApiKey: (key: string) => invoke<string>('set_api_key', { key }),
  getApiKeyHint: () => invoke<string | null>('get_api_key_hint'),
  clearApiKey: () => invoke<void>('clear_api_key'),
} as const;
