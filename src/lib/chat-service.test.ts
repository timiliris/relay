import { describe, expect, it } from 'vitest';
import { useSettings } from '@/stores/settings';
import { buildHistory, effectiveParams } from './chat-service';
import type { Conversation, Message } from './db';

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c',
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
  ...over,
});

const msg = (
  id: string,
  role: Message['role'],
  content: string,
  over: Partial<Message> = {},
): Message => ({
  id,
  conversationId: 'c',
  parentId: null,
  active: true,
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
  ...over,
});

describe('buildHistory', () => {
  it('place instruction système et résumé en tête, puis les messages après le résumé', () => {
    const history = buildHistory(
      conv({ systemPrompt: 'Sois bref.', summary: 'On a parlé de Rust.', summaryUntilId: 'a1' }),
      [msg('u1', 'user', 'Q1'), msg('a1', 'assistant', 'R1'), msg('u2', 'user', 'Q2')],
    );
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe('system');
    expect(history[0]?.content).toContain('Sois bref.');
    expect(history[0]?.content).toContain('On a parlé de Rust.');
    expect(history[1]).toEqual({ role: 'user', content: 'Q2' });
  });

  it('convertit les pièces jointes en parties multimodales', () => {
    const history = buildHistory(conv(), [
      msg('u1', 'user', 'Regarde', {
        attachments: [
          {
            id: 'i',
            kind: 'image',
            name: 'a.png',
            mime: 'image/png',
            size: 10,
            data: 'data:image/png;base64,AAA',
          },
          { id: 't', kind: 'text', name: 'n.md', mime: 'text/markdown', size: 5, text: '# Notes' },
        ],
      }),
    ]);
    const content = history[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) throw new Error('attendu : tableau');
    expect(content[0]).toMatchObject({ type: 'text' });
    expect((content[0] as { text: string }).text).toContain('# Notes');
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAA' },
    });
  });
});

describe('buildHistory : images générées', () => {
  it("renvoie les images de l'assistant dans `images`, pas dans le contenu", () => {
    const history = buildHistory(conv(), [
      msg('u1', 'user', 'Dessine un chat'),
      msg('a1', 'assistant', 'Voici.', {
        attachments: [
          {
            id: 'g',
            kind: 'image',
            name: 'image-1.png',
            mime: 'image/png',
            size: 10,
            data: 'data:image/png;base64,AAA',
          },
        ],
      }),
      msg('u2', 'user', 'Rends-le bleu'),
    ]);
    expect(history[1]).toEqual({
      role: 'assistant',
      content: 'Voici.',
      images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }],
    });
    expect(history[2]).toEqual({ role: 'user', content: 'Rends-le bleu' });
  });

  it("n'ajoute pas de champ images à un message assistant sans image", () => {
    const history = buildHistory(conv(), [msg('a1', 'assistant', 'Texte seul')]);
    expect(history[0]).toEqual({ role: 'assistant', content: 'Texte seul' });
  });
});

describe('effectiveParams', () => {
  it('préfère les réglages de la conversation aux valeurs globales', () => {
    useSettings.setState({ temperature: 0.7, topP: null, maxTokens: null, reasoning: true });
    expect(effectiveParams(conv()).temperature).toBe(0.7);
    expect(effectiveParams(conv({ temperature: 0.2, reasoning: false }))).toMatchObject({
      temperature: 0.2,
      reasoning: false,
      webSearch: false,
    });
  });
});
