import { beforeEach, describe, expect, it } from 'vitest';
import { usePersonaMemory } from '@/stores/persona-memory';
import { useSettings } from '@/stores/settings';
import { buildHistory } from './chat-service';
import type { Conversation, Message, PersonaMemory } from './db';
import {
  estimateMemoryTokens,
  formatMemoryBlock,
  parseFacts,
  sortMemories,
  summarizeForMemory,
} from './persona-memory';

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

const msg = (id: string, role: Message['role'], content: string): Message => ({
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
});

const memory = (id: string, content: string, over: Partial<PersonaMemory> = {}): PersonaMemory => ({
  id,
  presetId: 'p1',
  content,
  sourceConversationId: null,
  pinned: false,
  createdAt: `2026-01-0${id.length}T00:00:00.000Z`,
  ...over,
});

describe('formatMemoryBlock', () => {
  it('liste les faits en puces sous l’intitulé de la langue, épinglés d’abord', () => {
    const block = formatMemoryBlock(
      [
        memory('a', 'Lyra a perdu son médaillon.', { createdAt: '2026-01-01T00:00:00.000Z' }),
        memory('bb', "Le joueur s'appelle Tom.", {
          pinned: true,
          createdAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      'fr',
    );
    expect(block).toBe(
      "Mémoire du personnage :\n- Le joueur s'appelle Tom.\n- Lyra a perdu son médaillon.",
    );
    expect(formatMemoryBlock([memory('a', 'Fact')], 'en')).toBe('Character memory:\n- Fact');
  });

  it('renvoie null sans souvenir (ou avec des contenus vides)', () => {
    expect(formatMemoryBlock([], 'fr')).toBeNull();
    expect(formatMemoryBlock([memory('a', '   ')], 'fr')).toBeNull();
    expect(estimateMemoryTokens([], 'fr')).toBe(0);
    expect(estimateMemoryTokens([memory('a', 'Un fait.')], 'fr')).toBeGreaterThan(0);
  });

  it('trie épinglés puis par date', () => {
    const sorted = sortMemories([
      memory('b', 'B', { createdAt: '2026-01-02T00:00:00.000Z' }),
      memory('a', 'A', { createdAt: '2026-01-01T00:00:00.000Z' }),
      memory('c', 'C', { pinned: true, createdAt: '2026-01-03T00:00:00.000Z' }),
    ]);
    expect(sorted.map((m) => m.content)).toEqual(['C', 'A', 'B']);
  });
});

describe('summarizeForMemory', () => {
  it('aplatit le Markdown et coupe à 200 caractères sur un mot', () => {
    const long = `**Titre**\n\n\`\`\`rust\nfn main() {}\n\`\`\`\n${'mot '.repeat(80)}`;
    const summary = summarizeForMemory(long);
    expect(summary.startsWith('Titre mot mot')).toBe(true);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(201);
    expect(summary).not.toContain('fn main');
    expect(summarizeForMemory('Court.')).toBe('Court.');
  });
});

describe('parseFacts', () => {
  it('nettoie puces et numéros, dédoublonne et ignore les faits connus', () => {
    const facts = parseFacts(
      '- Tom est un nain.\n2. "Lyra cherche son médaillon."\n• tom est un nain\n\nAucun autre fait.\n- Ok',
      ['Lyra cherche son médaillon'],
    );
    expect(facts).toEqual(['Tom est un nain.']);
  });

  it('limite à cinq faits', () => {
    const raw = Array.from({ length: 8 }, (_, i) => `- Fait numéro ${i}`).join('\n');
    expect(parseFacts(raw)).toHaveLength(5);
  });
});

describe('buildHistory avec mémoire', () => {
  beforeEach(() => {
    useSettings.getState().patch({ language: 'fr' });
    usePersonaMemory.setState({ presetId: null, items: [] });
  });

  it('insère la mémoire entre l’instruction et le résumé', () => {
    usePersonaMemory.setState({
      presetId: 'p1',
      items: [memory('a', "Le joueur s'appelle Tom.")],
    });
    const history = buildHistory(
      conv({
        presetId: 'p1',
        systemPrompt: 'Tu es Lyra.',
        summary: 'Ils ont exploré la crypte.',
        summaryUntilId: 'a1',
      }),
      [msg('u1', 'user', 'Q1'), msg('a1', 'assistant', 'R1'), msg('u2', 'user', 'Q2')],
    );
    expect(history).toHaveLength(2);
    const system = String(history[0]?.content);
    const instruction = system.indexOf('Tu es Lyra.');
    const memoryAt = system.indexOf("Mémoire du personnage :\n- Le joueur s'appelle Tom.");
    const summaryAt = system.indexOf('Ils ont exploré la crypte.');
    expect(instruction).toBe(0);
    expect(memoryAt).toBeGreaterThan(instruction);
    expect(summaryAt).toBeGreaterThan(memoryAt);
    expect(history[1]).toEqual({ role: 'user', content: 'Q2' });
  });

  it('écrit l’intitulé dans la langue de l’interface', () => {
    useSettings.getState().patch({ language: 'en' });
    usePersonaMemory.setState({ presetId: 'p1', items: [memory('a', 'The player is Tom.')] });
    const history = buildHistory(conv({ presetId: 'p1' }), [msg('u1', 'user', 'Hi')]);
    expect(history[0]).toEqual({
      role: 'system',
      content: 'Character memory:\n- The player is Tom.',
    });
  });

  it('n’ajoute rien sans persona, même si des souvenirs sont chargés', () => {
    usePersonaMemory.setState({ presetId: 'p1', items: [memory('a', 'Fait')] });
    const history = buildHistory(conv({ systemPrompt: 'Sois bref.' }), [msg('u1', 'user', 'Q')]);
    expect(history[0]).toEqual({ role: 'system', content: 'Sois bref.' });
  });

  it('n’ajoute rien quand le persona n’a aucun souvenir, ni quand ceux d’un autre persona sont chargés', () => {
    usePersonaMemory.setState({ presetId: 'p1', items: [] });
    expect(buildHistory(conv({ presetId: 'p1' }), [msg('u1', 'user', 'Q')])).toEqual([
      { role: 'user', content: 'Q' },
    ]);
    usePersonaMemory.setState({ presetId: 'p2', items: [memory('a', 'Fait de p2')] });
    expect(buildHistory(conv({ presetId: 'p1' }), [msg('u1', 'user', 'Q')])).toEqual([
      { role: 'user', content: 'Q' },
    ]);
  });
});
