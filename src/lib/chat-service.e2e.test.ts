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
      add: vi.fn(async (input: Omit<Message, 'id' | 'createdAt' | 'active'> & { id?: string }) => {
        const message: Message = {
          ...input,
          id: input.id ?? `m${store.messages.length + 1}`,
          active: true,
          createdAt: new Date().toISOString(),
        };
        for (const m of store.messages) if (m.parentId === message.parentId) m.active = false;
        store.messages.push(message);
        return message;
      }),
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
      completeChat: vi.fn(async () => 'Titre généré'),
    },
  };
});

vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tauri')>();
  return { ...actual, isTauri: () => true };
});

const { continueMessage, editMessage, regenerate, sendMessage } = await import('./chat-service');
const { useChat } = await import('@/stores/chat');
const { useConversations } = await import('@/stores/conversations');
const { useSettings } = await import('@/stores/settings');

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
