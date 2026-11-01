import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pinnedMessages } from '@/components/pinned-panel';
import { useChat } from '@/stores/chat';
import { togglePin } from './chat-service';
import type { Message } from './db';

const { setPinnedCalls } = vi.hoisted(() => ({ setPinnedCalls: [] as Array<[string, boolean]> }));

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  return {
    ...actual,
    messages: {
      ...actual.messages,
      async setPinned(id: string, pinned: boolean) {
        setPinnedCalls.push([id, pinned]);
      },
    },
  };
});

const msg = (id: string, parentId: string | null, over: Partial<Message> = {}): Message => ({
  id,
  conversationId: 'c',
  parentId,
  active: true,
  role: 'user',
  content: id,
  reasoning: null,
  attachments: [],
  model: null,
  promptTokens: null,
  completionTokens: null,
  cost: null,
  finishReason: null,
  durationMs: null,
  pinned: false,
  createdAt: '',
  ...over,
});

describe('togglePin', () => {
  beforeEach(() => {
    setPinnedCalls.length = 0;
    useChat.setState({ conversationId: 'c' });
    useChat.getState().setAll([msg('a', null), msg('b', 'a', { role: 'assistant' })]);
  });

  it('épingle via le dépôt et met à jour le store sans rechargement', async () => {
    const b = useChat.getState().messages[1] as Message;
    await togglePin(b);
    expect(setPinnedCalls).toEqual([['b', true]]);
    expect(useChat.getState().messages.map((m) => m.pinned)).toEqual([false, true]);
    // Le message reste actif et le chemin inchangé.
    expect(useChat.getState().messages.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('désépingle un message épinglé', async () => {
    const a = useChat.getState().messages[0] as Message;
    await togglePin({ ...a, pinned: true });
    expect(setPinnedCalls).toEqual([['a', false]]);
    expect(useChat.getState().messages[0]?.pinned).toBe(false);
  });
});

describe('pinnedMessages', () => {
  it('ne garde que les épinglés, dans l’ordre de la conversation', () => {
    const list = [
      msg('a', null, { pinned: true }),
      msg('b', 'a'),
      msg('c', 'b', { pinned: true, role: 'assistant' }),
      msg('d', 'c'),
    ];
    expect(pinnedMessages(list).map((m) => m.id)).toEqual(['a', 'c']);
    expect(pinnedMessages([msg('x', null)])).toEqual([]);
  });
});
