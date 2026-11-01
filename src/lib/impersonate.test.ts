import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChat } from '@/stores/chat';
import { useSettings } from '@/stores/settings';
import { impersonate } from './chat-service';
import type { Conversation, Message, Preset } from './db';
import type { ChatRequest } from './openrouter';
import { defaultPersona } from './persona';

const { requests } = vi.hoisted(() => ({ requests: [] as ChatRequest[] }));

vi.mock('./openrouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./openrouter')>();
  return {
    ...actual,
    openrouter: {
      ...actual.openrouter,
      async completeChat(request: ChatRequest) {
        requests.push(request);
        return { content: '  « Je prends la lettre et je la décachette. »\n', images: [] };
      },
    },
  };
});

const conversation: Conversation = {
  id: 'c',
  title: 'Partie',
  model: 'openrouter/auto',
  systemPrompt: 'Jeu de rôle : tu incarnes le Maître du jeu.',
  pinned: false,
  archived: false,
  folderId: null,
  presetId: 'p1',
  temperature: 0.9,
  topP: null,
  maxTokens: null,
  reasoning: null,
  webSearch: false,
  summary: null,
  summaryUntilId: null,
  createdAt: '',
  updatedAt: '',
};

const message = (id: string, role: Message['role'], content: string): Message => ({
  id,
  conversationId: 'c',
  parentId: null,
  active: true,
  pinned: false,
  role,
  content,
  reasoning: null,
  attachments: [],
  model: null,
  promptTokens: null,
  completionTokens: null,
  cost: null,
  finishReason: null,
  durationMs: null,
  createdAt: '',
});

const preset = (userName = ''): Preset => ({
  id: 'p1',
  name: 'Maître du jeu',
  systemPrompt: null,
  model: null,
  temperature: 0.9,
  topP: null,
  maxTokens: null,
  reasoning: false,
  persona: {
    ...defaultPersona(),
    mode: 'roleplay',
    roleplay: { ...defaultPersona().roleplay, userName },
  },
  position: 0,
  createdAt: '',
});

describe('impersonate', () => {
  beforeEach(() => {
    requests.length = 0;
    useSettings.getState().patch({ language: 'fr' });
    useChat.setState({
      conversationId: 'c',
      messages: [message('a1', 'assistant', 'Que fais-tu ?')],
    });
  });

  it('demande une réplique non streamée, à partir de l’historique, et renvoie le texte nettoyé', async () => {
    const line = await impersonate(conversation, preset('Kael'));
    expect(line).toBe('« Je prends la lettre et je la décachette. »');
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.model).toBe('openrouter/auto');
    expect(request?.temperature).toBe(0.9);
    expect(request?.maxTokens).toBe(300);
    expect(request?.messages.map((m) => m.role)).toEqual(['system', 'assistant', 'user']);
    const instruction = request?.messages.at(-1)?.content;
    expect(instruction).toContain('(HRP)');
    expect(instruction).toContain('Kael');
    expect(instruction).toContain('Maître du jeu');
  });

  it('nomme « l’utilisateur » quand le personnage du joueur n’a pas de nom', async () => {
    await impersonate(conversation, preset());
    expect(requests[0]?.messages.at(-1)?.content).toContain('l’utilisateur');
  });
});
