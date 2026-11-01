import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChat } from '@/stores/chat';
import { useConversations } from '@/stores/conversations';
import { useSettings } from '@/stores/settings';
import { applyPreset } from './chat-service';
import type { Conversation, Preset } from './db';
import { defaultPersona } from './persona';

const { created, added, updated } = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  added: [] as Array<Record<string, unknown>>,
  updated: [] as Array<[string, Record<string, unknown>]>,
}));

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  return {
    ...actual,
    conversations: {
      ...actual.conversations,
      async create(input: Record<string, unknown>) {
        created.push(input);
        return {
          id: 'new',
          pinned: false,
          archived: false,
          folderId: null,
          summary: null,
          summaryUntilId: null,
          createdAt: '',
          updatedAt: '',
          ...input,
        } as Conversation;
      },
      async update(id: string, patch: Record<string, unknown>) {
        updated.push([id, patch]);
      },
    },
    messages: {
      ...actual.messages,
      async add(input: Record<string, unknown>) {
        added.push(input);
        return { id: 'g', active: true, createdAt: '', ...input };
      },
    },
  };
});

const preset = (over: Partial<Preset> = {}): Preset => ({
  id: 'p1',
  name: 'Lyra',
  systemPrompt: 'Parle en vers.',
  model: null,
  temperature: 0.9,
  topP: null,
  maxTokens: null,
  reasoning: false,
  persona: defaultPersona(),
  position: 0,
  createdAt: '',
  ...over,
});

const conversation: Conversation = {
  id: 'c1',
  title: 'Test',
  model: 'openrouter/auto',
  systemPrompt: null,
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

describe('applyPreset', () => {
  beforeEach(() => {
    created.length = 0;
    added.length = 0;
    updated.length = 0;
    useSettings.getState().patch({ language: 'fr', systemPrompt: '', temperature: 0.7 });
    useConversations.setState({ items: [conversation] });
    useChat.setState({ conversationId: null, all: [], messages: [] });
  });

  it('démarre une conversation dédiée avec la première réplique pour un persona en jeu de rôle', async () => {
    const p = preset();
    p.persona.mode = 'roleplay';
    p.persona.roleplay.greeting = 'La porte grince.';
    p.persona.traits.creativity = 90;

    const result = await applyPreset(null, p);

    expect(result?.id).toBe('new');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      title: 'Lyra',
      presetId: 'p1',
      temperature: 0.9,
      reasoning: false,
    });
    const prompt = String(created[0]?.systemPrompt);
    expect(prompt.startsWith('Parle en vers.')).toBe(true);
    expect(prompt).toContain('Jeu de rôle : tu incarnes Lyra.');
    expect(prompt).toContain('Sois très créatif');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      conversationId: 'new',
      role: 'assistant',
      content: 'La porte grince.',
      finishReason: 'stop',
      cost: null,
    });
    // Les défauts globaux ne bougent pas.
    expect(useSettings.getState().systemPrompt).toBe('');
  });

  it('met à jour la conversation ouverte sans réplique si elle a déjà des messages', async () => {
    const p = preset();
    p.persona.mode = 'roleplay';
    p.persona.roleplay.greeting = 'Bonsoir.';
    useChat.setState({
      conversationId: 'c1',
      all: [
        {
          id: 'm1',
          conversationId: 'c1',
          parentId: null,
          active: true,
          role: 'user',
          content: 'Salut',
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
        },
      ],
    });

    const result = await applyPreset(conversation, p);

    expect(result).toBeNull();
    expect(created).toHaveLength(0);
    expect(added).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.[0]).toBe('c1');
    expect(updated[0]?.[1]).toMatchObject({ presetId: 'p1', temperature: 0.9 });
    expect(String(updated[0]?.[1].systemPrompt)).toContain('Jeu de rôle');
  });

  it('insère la réplique dans une conversation ouverte encore vide', async () => {
    const p = preset();
    p.persona.mode = 'roleplay';
    p.persona.roleplay.greeting = 'Bonsoir.';
    useChat.setState({ conversationId: 'c1', all: [], messages: [] });

    await applyPreset(conversation, p);

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ conversationId: 'c1', content: 'Bonsoir.' });
    expect(useChat.getState().messages).toHaveLength(1);
  });

  it('coupe le raisonnement pour un persona en jeu de rôle même s’il est activé sur la fiche', async () => {
    const p = preset({ reasoning: true });
    p.persona.mode = 'roleplay';
    useChat.setState({ conversationId: 'c1', all: [], messages: [] });

    await applyPreset(conversation, p);

    expect(updated[0]?.[1]).toMatchObject({ reasoning: false });
  });

  it('applique un assistant classique aux valeurs par défaut quand aucune conversation n’est ouverte', async () => {
    const p = preset();
    p.persona.traits.verbosity = 10;

    const result = await applyPreset(null, p);

    expect(result).toBeNull();
    expect(created).toHaveLength(0);
    const s = useSettings.getState();
    expect(s.temperature).toBe(0.9);
    expect(s.systemPrompt).toContain('Parle en vers.');
    expect(s.systemPrompt).toContain('extrêmement concise');
  });
});
