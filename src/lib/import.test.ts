import { describe, expect, it } from 'vitest';
import { parseImport } from './import';

describe('parseImport', () => {
  it('lit un export ChatGPT en suivant le chemin actif', () => {
    const json = [
      {
        title: 'Test GPT',
        create_time: 1_700_000_000,
        update_time: 1_700_000_100,
        current_node: 'a1',
        mapping: {
          root: { id: 'root', message: null, parent: null, children: ['u1'] },
          u1: {
            id: 'u1',
            parent: 'root',
            children: ['a0', 'a1'],
            message: {
              author: { role: 'user' },
              content: { content_type: 'text', parts: ['Bonjour'] },
              create_time: 1_700_000_010,
            },
          },
          a0: {
            id: 'a0',
            parent: 'u1',
            children: [],
            message: {
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['Ancienne version'] },
            },
          },
          a1: {
            id: 'a1',
            parent: 'u1',
            children: [],
            message: {
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['Salut !'] },
              create_time: 1_700_000_020,
            },
          },
        },
      },
    ];
    const result = parseImport(json);
    expect(result.source).toBe('chatgpt');
    expect(result.conversations).toHaveLength(1);
    const conv = result.conversations[0];
    expect(conv?.title).toBe('Test GPT');
    expect(conv?.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Bonjour'],
      ['assistant', 'Salut !'],
    ]);
    expect(conv?.createdAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('lit un export Claude', () => {
    const json = [
      {
        uuid: 'x',
        name: 'Test Claude',
        created_at: '2026-01-02T10:00:00Z',
        updated_at: '2026-01-02T11:00:00Z',
        chat_messages: [
          { sender: 'human', text: 'Hello', created_at: '2026-01-02T10:00:00Z' },
          {
            sender: 'assistant',
            text: '',
            content: [{ type: 'text', text: 'Hi there' }],
            created_at: '2026-01-02T10:00:05Z',
          },
        ],
      },
    ];
    const result = parseImport(json);
    expect(result.source).toBe('claude');
    expect(result.conversations[0]?.messages).toEqual([
      { role: 'user', content: 'Hello', createdAt: '2026-01-02T10:00:00.000Z' },
      { role: 'assistant', content: 'Hi there', createdAt: '2026-01-02T10:00:05.000Z' },
    ]);
  });

  it('lit un export Relay en ignorant les versions inactives', () => {
    const json = {
      conversations: [
        {
          id: 'c1',
          title: 'Relay',
          createdAt: '2026-03-01T00:00:00Z',
          updatedAt: '2026-03-01T00:10:00Z',
        },
      ],
      messages: [
        {
          id: 'm1',
          conversationId: 'c1',
          role: 'user',
          content: 'Q',
          active: true,
          createdAt: '2026-03-01T00:01:00Z',
        },
        {
          id: 'm2',
          conversationId: 'c1',
          role: 'assistant',
          content: 'Vieille',
          active: false,
          createdAt: '2026-03-01T00:02:00Z',
        },
        {
          id: 'm3',
          conversationId: 'c1',
          role: 'assistant',
          content: 'Réponse',
          active: true,
          createdAt: '2026-03-01T00:03:00Z',
        },
      ],
    };
    const result = parseImport(json);
    expect(result.source).toBe('relay');
    expect(result.conversations[0]?.messages.map((m) => m.content)).toEqual(['Q', 'Réponse']);
  });

  it('rejette un fichier inconnu', () => {
    expect(() => parseImport({ foo: 1 })).toThrow('unrecognized');
  });
});
