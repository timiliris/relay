import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  defaultPersona,
  greetingOf,
  isNeutralPersona,
  parsePersona,
  serializePersona,
  TRAIT_KEYS,
  traitLevel,
} from './persona';

const preset = (over: Partial<ReturnType<typeof defaultPersona>> = {}) => ({
  name: 'Lyra',
  systemPrompt: null,
  persona: { ...defaultPersona(), ...over },
});

describe('persona', () => {
  it('a un persona neutre par défaut qui ne produit aucune instruction', () => {
    const p = defaultPersona();
    expect(isNeutralPersona(p)).toBe(true);
    expect(buildSystemPrompt(preset(), 'fr')).toBeNull();
    expect(buildSystemPrompt({ ...preset(), systemPrompt: '  Sois bref.  ' }, 'fr')).toBe(
      'Sois bref.',
    );
  });

  it('découpe les curseurs en cinq paliers', () => {
    expect(traitLevel(0)).toBe(-2);
    expect(traitLevel(15)).toBe(-2);
    expect(traitLevel(16)).toBe(-1);
    expect(traitLevel(35)).toBe(-1);
    expect(traitLevel(36)).toBe(0);
    expect(traitLevel(50)).toBe(0);
    expect(traitLevel(64)).toBe(0);
    expect(traitLevel(65)).toBe(1);
    expect(traitLevel(85)).toBe(2);
    expect(traitLevel(100)).toBe(2);
  });

  it('traduit les traits marqués en phrases dans la langue demandée', () => {
    const p = defaultPersona();
    p.traits.warmth = 90;
    p.traits.verbosity = 10;
    const fr = buildSystemPrompt(preset(p), 'fr') ?? '';
    expect(fr).toContain('Personnalité :');
    expect(fr).toContain('- Sois très chaleureux');
    expect(fr).toContain('- Réponds de façon extrêmement concise');
    expect(fr).not.toContain('humour');
    const en = buildSystemPrompt(preset(p), 'en') ?? '';
    expect(en).toContain('Personality:');
    expect(en).toContain('- Be very warm');
  });

  it('compose instructions libres, fiche de rôle, traits et bloc 18+ dans cet ordre', () => {
    const p = defaultPersona();
    p.mode = 'roleplay';
    p.mature = true;
    p.traits.initiative = 100;
    p.roleplay = {
      ...p.roleplay,
      character: 'Une elfe archiviste.',
      scenario: 'Bibliothèque engloutie.',
      userName: 'Tom',
      userPersona: 'un plongeur',
      pov: 'first',
      format: 'chat',
    };
    const out = buildSystemPrompt({ ...preset(p), systemPrompt: 'Parle en vers.' }, 'fr') ?? '';
    const order = [
      'Parle en vers.',
      'Jeu de rôle : tu incarnes Lyra.',
      'Personnage : Une elfe archiviste.',
      'Scénario : Bibliothèque engloutie.',
      'L’utilisateur joue Tom : un plongeur.',
      'Narration à la première personne',
      'Format messagerie',
      'Personnalité :',
      'Fais vivre le monde',
      'Contenu mature (18+)',
    ];
    const positions = order.map((s) => out.indexOf(s));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // En jeu de rôle, l'initiative parle d'histoire, pas de « suggestions ».
    expect(out).not.toContain('Mène l’échange');
  });

  it('ne donne une première réplique qu’en jeu de rôle', () => {
    const p = defaultPersona();
    p.roleplay.greeting = '  Bonsoir.  ';
    expect(greetingOf(p)).toBeNull();
    p.mode = 'roleplay';
    expect(greetingOf(p)).toBe('Bonsoir.');
  });

  it('relit le JSON stocké en tolérant les champs absents ou invalides', () => {
    expect(parsePersona(null)).toEqual(defaultPersona());
    expect(parsePersona('{not json')).toEqual(defaultPersona());
    const partial = parsePersona(
      JSON.stringify({ mode: 'roleplay', traits: { warmth: 250, humor: 'x' }, mature: 'yes' }),
    );
    expect(partial.mode).toBe('roleplay');
    expect(partial.traits.warmth).toBe(100);
    expect(partial.traits.humor).toBe(50);
    expect(partial.mature).toBe(false);
    expect(partial.roleplay.pov).toBe('third');
    const full = defaultPersona();
    full.mature = true;
    for (const k of TRAIT_KEYS) full.traits[k] = 77;
    expect(parsePersona(serializePersona(full))).toEqual(full);
  });
});
