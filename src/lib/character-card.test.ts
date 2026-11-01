import { describe, expect, it } from 'vitest';
import {
  CardError,
  cardFromPreset,
  parseCharacterCard,
  presetFromCard,
  serializeCard,
} from './character-card';
import type { Preset } from './db';
import { defaultPersona } from './persona';

const base: Preset = {
  id: 'p',
  name: '',
  systemPrompt: null,
  model: null,
  temperature: null,
  topP: null,
  maxTokens: null,
  reasoning: null,
  persona: defaultPersona(),
  position: 0,
  createdAt: '',
};

const v2 = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Lyra',
    description: 'Une elfe archiviste aux yeux gris.',
    personality: 'curieuse, ironique',
    scenario: 'La bibliothèque engloutie de Valmer.',
    first_mes: '*Lyra lève les yeux de son grimoire.* « Encore un visiteur… »',
    mes_example: '<START>\n{{user}}: Bonjour\n{{char}}: Chut.',
    system_prompt: 'Écris en français soutenu.',
    post_history_instructions: '',
    alternate_greetings: ['Autre début.'],
    tags: ['fantasy'],
    creator: 'test',
    character_version: '1',
    creator_notes: 'notes',
    extensions: {},
  },
};

/** Construit un PNG minimal (signature, IHDR vide, tEXt, IEND) ; le CRC n'est pas vérifié. */
function pngWithText(keyword: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(enc.encode(type), 4);
    out.set(data, 8);
    return out;
  };
  const textData = new Uint8Array([...enc.encode(keyword), 0, ...enc.encode(text)]);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', new Uint8Array(13)),
    chunk('tEXt', textData),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe('character-card', () => {
  it('lit une fiche V2 en JSON et la convertit en persona de jeu de rôle', () => {
    const card = parseCharacterCard(JSON.stringify(v2));
    expect(card.spec).toBe('chara_card_v2');
    const preset = presetFromCard(card, base, 'fr');
    expect(preset.name).toBe('Lyra');
    expect(preset.systemPrompt).toBe('Écris en français soutenu.');
    expect(preset.persona.mode).toBe('roleplay');
    expect(preset.persona.roleplay.character).toContain('Une elfe archiviste');
    expect(preset.persona.roleplay.character).toContain('Personnalité : curieuse, ironique');
    expect(preset.persona.roleplay.character).toContain('Exemples de dialogue');
    expect(preset.persona.roleplay.scenario).toBe('La bibliothèque engloutie de Valmer.');
    expect(preset.persona.roleplay.greeting).toContain('Encore un visiteur');
    expect(preset.persona.mature).toBe(false);
  });

  it('accepte une fiche V1 plate', () => {
    const card = parseCharacterCard(
      JSON.stringify({ name: 'Bob', description: 'Un forgeron.', first_mes: 'Salut.' }),
    );
    expect(card.spec).toBe('chara_card_v1');
    expect(card.data.description).toBe('Un forgeron.');
    expect(card.data.alternate_greetings).toEqual([]);
  });

  it('extrait la fiche du chunk tEXt « chara » d’un PNG, ou « ccv3 » en priorité', () => {
    const png = pngWithText('chara', b64(JSON.stringify(v2)));
    expect(parseCharacterCard(png).data.name).toBe('Lyra');
    const v3 = { ...v2, spec: 'chara_card_v3', data: { ...v2.data, name: 'Lyra v3' } };
    expect(parseCharacterCard(pngWithText('ccv3', b64(JSON.stringify(v3)))).data.name).toBe(
      'Lyra v3',
    );
  });

  it('signale les fichiers inexploitables avec un code', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof CardError ? e.code : 'other';
      }
      return 'none';
    };
    expect(code(() => parseCharacterCard(new Uint8Array([1, 2, 3])))).toBe('notPng');
    expect(code(() => parseCharacterCard(pngWithText('Comment', 'hello')))).toBe('noChunk');
    expect(code(() => parseCharacterCard('{nope'))).toBe('invalidJson');
    expect(code(() => parseCharacterCard('{"foo":1}'))).toBe('unknownFormat');
    expect(code(() => parseCharacterCard('{"name":"X"}'))).toBe('unknownFormat');
  });

  it('exporte une fiche V2 et la relit sans perte (persona complet dans extensions.relay)', () => {
    const preset: Preset = {
      ...base,
      name: 'Kael',
      systemPrompt: 'Sois bref.',
      persona: {
        ...defaultPersona(),
        mode: 'roleplay',
        mature: true,
        traits: { ...defaultPersona().traits, humor: 90 },
        roleplay: {
          ...defaultPersona().roleplay,
          character: 'Un voleur.',
          scenario: 'Les toits.',
          greeting: 'Psst.',
          pov: 'first',
          format: 'chat',
        },
      },
    };
    const json = serializeCard(cardFromPreset(preset));
    expect(JSON.parse(json).spec_version).toBe('2.0');
    expect(JSON.parse(json).data.tags).toEqual(['nsfw']);
    const back = presetFromCard(parseCharacterCard(json), base, 'en');
    expect(back.name).toBe('Kael');
    expect(back.persona).toEqual(preset.persona);
  });
});
