/**
 * Tests d'orchestration : envoi, édition, continuation et arrêt, avec l'API
 * OpenRouter et la base SQLite simulées. Vérifie le parcours complet côté frontend.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Message } from './db';
import type { StreamEvent } from './openrouter';

// ---- Base SQLite simulée en mémoire -------------------------------------------------
const store: { messages: Message[]; touched: string[] } = { messages: [], touched: [] };

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  return {
    ...actual,
    conversations: {
      touch: vi.fn(async (id: string) => {
        store.touched.push(id);
        return new Date().toISOString();
      }),
      update: vi.fn(async () => {}),
    },
    messages: {
      list: vi.fn(async (conversationId: string) =>
        store.messages.filter((m) => m.conversationId === conversationId),
      ),
      add: vi.fn(
        async (
          input: Omit<Message, 'id' | 'createdAt' | 'active' | 'pinned'> & {
            id?: string;
            pinned?: boolean;
          },
        ) => {
          const message: Message = {
            ...input,
            pinned: input.pinned ?? false,
            id: input.id ?? `m${store.messages.length + 1}`,
            active: true,
            createdAt: new Date().toISOString(),
          };
          for (const m of store.messages) if (m.parentId === message.parentId) m.active = false;
          store.messages.push(message);
          return message;
        },
      ),
      update: vi.fn(async (id: string, patch: Partial<Message>) => {
        const m = store.messages.find((x) => x.id === id);
        if (m) Object.assign(m, patch);
      }),
      activate: vi.fn(async () => {}),
      removeSubtree: vi.fn(async (_c: string, id: string) => {
        store.messages = store.messages.filter((m) => m.id !== id);
      }),
      totalCost: vi.fn(async () => 0),
    },
  };
});

// ---- API OpenRouter simulée ------------------------------------------------------------
type Script = StreamEvent[];
const api = {
  scripts: [] as Script[],
  requests: [] as unknown[],
  cancelled: [] as string[],
};

vi.mock('./openrouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./openrouter')>();
  return {
    ...actual,
    openrouter: {
      ...actual.openrouter,
      streamChat: vi.fn(
        async (requestId: string, request: unknown, onEvent: (e: StreamEvent) => void) => {
          api.requests.push({ requestId, request });
          const script = api.scripts.shift() ?? [{ type: 'done', finishReason: 'stop' }];
          for (const event of script) {
            await new Promise((r) => setTimeout(r, 1));
            onEvent(event);
          }
        },
      ),
      cancelStream: vi.fn(async (requestId: string) => {
        api.cancelled.push(requestId);
      }),
      completeChat: vi.fn(async () => ({ content: 'Titre généré', images: [] })),
    },
  };
});

// Catalogue de modèles en mémoire : le vrai store se persiste via le plugin Tauri `store`.
vi.mock('@/stores/models', async () => {
  const { create } = await import('zustand');
  type ModelInfo = import('./openrouter').ModelInfo;
  return {
    useModels: create<{
      models: ModelInfo[];
      status: string;
      load: () => Promise<void>;
      byId: (id: string) => ModelInfo | undefined;
    }>()((_set, get) => ({
      models: [],
      status: 'ready',
      load: async () => {},
      byId: (id) => get().models.find((m) => m.id === id),
    })),
  };
});

vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tauri')>();
  return { ...actual, isTauri: () => true };
});

const { continueMessage, editMessage, regenerate, sendMessage } = await import('./chat-service');
const { useChat } = await import('@/stores/chat');
const { useConversations } = await import('@/stores/conversations');
const { useModels } = await import('@/stores/models');
const { useSettings } = await import('@/stores/settings');
const { normalizeModel } = await import('./openrouter');

const conversation: Conversation = {
  id: 'c1',
  title: 'Test',
  model: 'test/model',
  systemPrompt: 'Sois bref.',
  pinned: false,
  archived: false,
  folderId: null,
  presetId: null,
  temperature: null,
  topP: null,
  maxTokens: null,
  reasoning: null,
  webSearch: false,
  summary: null,
  summaryUntilId: null,
  createdAt: '',
  updatedAt: '',
};

const lastRequest = () =>
  (api.requests.at(-1) as { request: { messages: Array<{ role: string; content: unknown }> } })
    .request;

beforeEach(() => {
  store.messages = [];
  store.touched = [];
  api.scripts = [];
  api.requests = [];
  api.cancelled = [];
  useSettings.setState({ autoTitle: false, notifyOnComplete: false });
  useConversations.setState({ items: [conversation], loaded: true });
  useModels.setState({ models: [], status: 'ready' });
  useChat.setState({ conversationId: 'c1', all: [], messages: [], stream: null, error: null });
});

describe('parcours de chat', () => {
  it('envoie un message, streame la réponse et la persiste avec usage et durée', async () => {
    api.scripts.push([
      { type: 'reasoning', content: 'Je réfléchis.' },
      { type: 'delta', content: 'Bon' },
      { type: 'delta', content: 'jour !' },
      { type: 'usage', promptTokens: 12, completionTokens: 3, cost: 0.0002 },
      { type: 'done', finishReason: 'stop' },
    ]);

    await sendMessage(conversation, 'Salut');

    const { messages, stream, error } = useChat.getState();
    expect(error).toBeNull();
    expect(stream).toBeNull();
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const assistant = messages[1] as Message;
    expect(assistant.content).toBe('Bonjour !');
    expect(assistant.reasoning).toBe('Je réfléchis.');
    expect(assistant).toMatchObject({
      promptTokens: 12,
      completionTokens: 3,
      cost: 0.0002,
      finishReason: 'stop',
    });
    expect(assistant.durationMs).toBeGreaterThanOrEqual(0);
    expect(assistant.parentId).toBe(messages[0]?.id);

    // L'historique envoyé contient l'instruction système puis le message utilisateur.
    const sent = lastRequest().messages;
    expect(sent[0]).toEqual({ role: 'system', content: 'Sois bref.' });
    expect(sent[1]).toEqual({ role: 'user', content: 'Salut' });
    expect(store.touched).toEqual(['c1']);
  });

  it('ajoute les images générées aux pièces jointes de la réponse et les persiste', async () => {
    api.scripts.push([
      { type: 'delta', content: 'Voici votre chat.' },
      { type: 'image', url: 'data:image/png;base64,QUJD' },
      { type: 'image', url: 'data:image/webp;base64,QUJDRA==' },
      { type: 'usage', promptTokens: 20, completionTokens: 1290, cost: 0.04 },
      { type: 'done', finishReason: 'stop' },
    ]);

    await sendMessage(conversation, 'Dessine un chat');

    const assistant = useChat.getState().messages[1] as Message;
    expect(assistant.content).toBe('Voici votre chat.');
    expect(assistant.attachments.map((a) => [a.kind, a.name, a.mime, a.size])).toEqual([
      ['image', 'image-1.png', 'image/png', 3],
      ['image', 'image-2.webp', 'image/webp', 4],
    ]);
    expect(assistant.attachments[0]?.data).toBe('data:image/png;base64,QUJD');
    // Persistées en base avec le message.
    const stored = store.messages.find((m) => m.id === assistant.id);
    expect(stored?.attachments).toHaveLength(2);
    expect(stored?.finishReason).toBe('stop');
  });

  it("conserve une réponse composée uniquement d'une image", async () => {
    api.scripts.push([
      { type: 'image', url: 'data:image/png;base64,QUJD' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await sendMessage(conversation, 'Juste une image');
    const { messages, error } = useChat.getState();
    expect(error).toBeNull();
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1]?.attachments).toHaveLength(1);
  });

  it("n'envoie modalities qu'aux modèles qui produisent des images", async () => {
    await sendMessage(conversation, 'Salut');
    expect(lastRequest()).not.toHaveProperty('modalities');

    const imageModel = normalizeModel({
      id: 'test/model',
      architecture: { input_modalities: ['text'], output_modalities: ['image', 'text'] },
    });
    useModels.setState({ models: imageModel ? [imageModel] : [], status: 'ready' });
    await sendMessage(conversation, 'Dessine');
    expect(lastRequest()).toMatchObject({ modalities: ['image', 'text'] });
  });

  it("remonte une erreur d'API sans laisser de message vide", async () => {
    api.scripts.push([{ type: 'error', message: 'Rate limit exceeded' }]);

    await sendMessage(conversation, 'Salut');

    const { messages, error } = useChat.getState();
    expect(error).toBe('Rate limit exceeded');
    expect(messages.map((m) => m.role)).toEqual(['user']);
  });

  it('édite un message : nouvelle version active, ancienne conservée', async () => {
    api.scripts.push([
      { type: 'delta', content: 'R1' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await sendMessage(conversation, 'Q1');
    const original = useChat.getState().messages[0] as Message;

    api.scripts.push([
      { type: 'delta', content: 'R2' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await editMessage(conversation, original, 'Q1 corrigée');

    const { all, messages } = useChat.getState();
    expect(messages.map((m) => m.content)).toEqual(['Q1 corrigée', 'R2']);
    expect(all.filter((m) => m.role === 'user')).toHaveLength(2);
    expect(all.find((m) => m.content === 'Q1')?.active).toBe(false);
    expect(lastRequest().messages.at(-1)).toEqual({ role: 'user', content: 'Q1 corrigée' });
  });

  it('régénère : réponse alternative sous le même message utilisateur', async () => {
    api.scripts.push([
      { type: 'delta', content: 'R1' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await sendMessage(conversation, 'Q1');
    const first = useChat.getState().messages[1] as Message;

    api.scripts.push([
      { type: 'delta', content: 'R1 bis' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await regenerate(conversation, first);

    const { all, messages } = useChat.getState();
    expect(messages[1]?.content).toBe('R1 bis');
    const siblings = all.filter((m) => m.parentId === first.parentId && m.role === 'assistant');
    expect(siblings).toHaveLength(2);
  });

  it('régénère avec un autre modèle : version sœur étiquetée, conversation inchangée', async () => {
    useSettings.setState({ recentModels: [] });
    api.scripts.push([
      { type: 'delta', content: 'R1' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await sendMessage(conversation, 'Q1');
    const first = useChat.getState().messages[1] as Message;

    api.scripts.push([
      { type: 'delta', content: 'R1 par un autre modèle' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await regenerate(conversation, first, 'other/model');

    const { all, messages } = useChat.getState();
    const second = messages[1] as Message;
    expect(second.content).toBe('R1 par un autre modèle');
    expect(second.model).toBe('other/model');
    expect(second.parentId).toBe(first.parentId);
    // La requête part vers le modèle choisi ; la première version garde le sien.
    expect((api.requests.at(-1) as { request: { model: string } }).request.model).toBe(
      'other/model',
    );
    expect(all.find((m) => m.id === first.id)?.model).toBe('test/model');
    expect(store.messages.find((m) => m.id === second.id)?.model).toBe('other/model');
    // Le modèle de la conversation n'est pas touché, mais le choix rejoint les récents.
    expect(conversation.model).toBe('test/model');
    expect(useConversations.getState().items[0]?.model).toBe('test/model');
    expect(useSettings.getState().recentModels[0]).toBe('other/model');
  });

  it('continue une réponse coupée en prolongeant le même message', async () => {
    api.scripts.push([
      { type: 'delta', content: 'Début' },
      { type: 'done', finishReason: 'length' },
    ]);
    await sendMessage(conversation, 'Raconte');
    const truncated = useChat.getState().messages[1] as Message;
    expect(truncated.finishReason).toBe('length');

    api.scripts.push([
      { type: 'delta', content: ' et fin.' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await continueMessage(conversation, truncated);

    const { messages } = useChat.getState();
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toBe('Début et fin.');
    expect(messages[1]?.finishReason).toBe('stop');
    // La requête de continuation se termine par la réponse partielle (préremplissage).
    expect(lastRequest().messages.at(-1)).toEqual({ role: 'assistant', content: 'Début' });
  });
});
