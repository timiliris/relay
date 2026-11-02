import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  defaultPersona,
  fillTemplate,
  greetingOf,
  isNeutralPersona,
  isSceneMode,
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

  it('ne donne une première réplique qu’en jeu de rôle, gabarits remplis', () => {
    const p = defaultPersona();
    p.roleplay.greeting = '  Bonsoir {{user}}, je suis {{CHAR}}.  ';
    expect(greetingOf(preset(p), 'fr')).toBeNull();
    p.mode = 'roleplay';
    expect(greetingOf(preset(p), 'fr')).toBe('Bonsoir l’utilisateur, je suis Lyra.');
    p.roleplay.userName = 'Tom';
    expect(greetingOf(preset(p), 'en')).toBe('Bonsoir Tom, je suis Lyra.');
  });

  it('remplit {{char}} et {{user}} dans l’instruction composée', () => {
    const p = defaultPersona();
    p.mode = 'roleplay';
    p.roleplay.character = '{{char}} méprise {{user}}.';
    const out = buildSystemPrompt(preset(p), 'fr') ?? '';
    expect(out).toContain('Lyra méprise l’utilisateur.');
    expect(out).not.toContain('{{');
  });

  it('compose l’instruction petite voix : voix intérieure, second personnage, tour par tour', () => {
    const p = defaultPersona();
    p.mode = 'innerVoice';
    p.mature = true;
    p.traits.initiative = 90;
    p.traits.verbosity = 10;
    p.innerVoice = {
      ...p.innerVoice,
      characterName: 'Camille',
      character: 'Graphiste nerveuse.',
      otherName: 'Théo',
      otherCharacter: 'Kiné calme.',
      scenario: 'Premier rendez-vous.',
      format: 'chat',
    };
    const out = buildSystemPrompt({ ...preset(p), systemPrompt: 'Ton léger.' }, 'fr') ?? '';
    const order = [
      'Ton léger.',
      'Petite voix : tu incarnes Camille et tu racontes à la première personne',
      'c’est la petite voix, une voix intérieure dans la tête de Camille',
      'Personnage principal : Graphiste nerveuse.',
      'Second personnage : Théo — Kiné calme.\nTu joues aussi Théo, à la troisième personne',
      'Scénario : Premier rendez-vous.',
      'À chaque tour : Camille réagit d’abord à la voix selon son caractère',
      'la réaction de Théo',
      'Qu’est-ce que je fais ?',
      'Format messagerie',
      '« (HRP) »',
      'Personnalité :',
      '- Réponses très brèves',
      '- Tête dure : négocie, détourne ou refuse',
      'Contenu mature (18+)',
    ];
    const positions = order.map((s) => out.indexOf(s));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(out).not.toContain('Jeu de rôle');
    expect(out).not.toContain('Fais vivre le monde');
    expect(isSceneMode('innerVoice')).toBe(true);
    expect(isSceneMode('assistant')).toBe(false);

    const en = buildSystemPrompt(preset(p), 'en') ?? '';
    expect(en).toContain('Inner voice: you are Camille, narrating in the first person');
    expect(en).toContain('Second character: Théo — Kiné calme.');
    expect(en).toContain('- Stubborn: negotiate');
  });

  it('repli des noms en petite voix : nom du persona, « la petite voix », « l’autre »', () => {
    const p = defaultPersona();
    p.mode = 'innerVoice';
    p.innerVoice.greeting = '{{char}} / {{user}} / {{other}}';
    expect(greetingOf(preset(p), 'fr')).toBe('Lyra / la petite voix / l’autre');
    p.innerVoice.userName = 'Conscience';
    p.innerVoice.otherName = 'Théo';
    expect(greetingOf(preset(p), 'en')).toBe('Lyra / Conscience / Théo');
    const fr = buildSystemPrompt(preset(p), 'fr') ?? '';
    expect(fr).toContain('tu incarnes Lyra');
    expect(fr).toContain('c’est Conscience, une voix intérieure');
    expect(fr).toContain('Second personnage : Théo\nTu joues aussi Théo');
  });

  it('remplit {{other}} seulement quand il est fourni', () => {
    expect(fillTemplate('{{Other}} et {{char}}', { char: 'A', user: 'B', other: 'C' })).toBe(
      'C et A',
    );
    expect(fillTemplate('{{other}} et {{user}}', { char: 'A', user: 'B' })).toBe('{{other}} et B');
    // En jeu de rôle, {{other}} n'a pas de sens et reste tel quel.
    const p = defaultPersona();
    p.mode = 'roleplay';
    p.roleplay.greeting = 'Salut {{other}}.';
    expect(greetingOf(preset(p), 'fr')).toBe('Salut {{other}}.');
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

  it('relit un persona petite voix et complète les anciennes lignes sans fiche', () => {
    const p = defaultPersona();
    p.mode = 'innerVoice';
    p.innerVoice = {
      characterName: 'Camille',
      character: 'Nerveuse.',
      otherName: 'Théo',
      otherCharacter: 'Calme.',
      scenario: 'Resto.',
      userName: 'Conscience',
      greeting: 'Je mets quoi ?',
      format: 'chat',
    };
    expect(parsePersona(serializePersona(p))).toEqual(p);
    // Ligne enregistrée avant l'existence du mode : fiche vide, mode conservé.
    const legacy = parsePersona(JSON.stringify({ mode: 'roleplay', roleplay: { pov: 'first' } }));
    expect(legacy.mode).toBe('roleplay');
    expect(legacy.innerVoice).toEqual(defaultPersona().innerVoice);
    expect(
      parsePersona(JSON.stringify({ mode: 'innerVoice', innerVoice: { format: 'x' } })),
    ).toMatchObject({
      mode: 'innerVoice',
      innerVoice: { format: 'novel', characterName: '' },
    });
    expect(parsePersona(JSON.stringify({ mode: 'other' })).mode).toBe('assistant');
  });
});
