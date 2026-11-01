/**
 * Personnalité d'un persona : mode (assistant ou jeu de rôle), traits réglés par
 * curseurs, fiche de rôle et mode 18+. Tout est compilé en une instruction système
 * lisible, en français ou en anglais, au moment où le persona est appliqué.
 */
import type { Language } from '@/i18n';

export type PersonaMode = 'assistant' | 'roleplay';
export type TraitKey = 'warmth' | 'humor' | 'formality' | 'verbosity' | 'creativity' | 'initiative';
/** Valeurs 0–100 ; 50 = neutre (aucune consigne ajoutée). */
export type PersonaTraits = Record<TraitKey, number>;
export type Pov = 'first' | 'third';
export type RoleplayFormat = 'novel' | 'chat';

export interface Roleplay {
  /** Apparence, caractère, histoire du personnage incarné. */
  character: string;
  /** Décor et situation de départ. */
  scenario: string;
  /** Nom du personnage joué par l'utilisateur ; vide = « l'utilisateur ». */
  userName: string;
  userPersona: string;
  /** Première réplique du personnage, insérée dans la conversation à l'application. */
  greeting: string;
  pov: Pov;
  format: RoleplayFormat;
}

export interface Persona {
  mode: PersonaMode;
  traits: PersonaTraits;
  /** Contenu mature (18+) autorisé ; demande une confirmation d'âge dans l'UI. */
  mature: boolean;
  roleplay: Roleplay;
}

export const TRAIT_KEYS: readonly TraitKey[] = [
  'warmth',
  'humor',
  'formality',
  'verbosity',
  'creativity',
  'initiative',
];

export const NEUTRAL = 50;

export function defaultPersona(): Persona {
  return {
    mode: 'assistant',
    traits: {
      warmth: NEUTRAL,
      humor: NEUTRAL,
      formality: NEUTRAL,
      verbosity: NEUTRAL,
      creativity: NEUTRAL,
      initiative: NEUTRAL,
    },
    mature: false,
    roleplay: {
      character: '',
      scenario: '',
      userName: '',
      userPersona: '',
      greeting: '',
      pov: 'third',
      format: 'novel',
    },
  };
}

const clamp = (n: unknown, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n)
    ? Math.min(100, Math.max(0, Math.round(n)))
    : fallback;
const str = (s: unknown): string => (typeof s === 'string' ? s : '');

/** Lit la colonne JSON `persona` en tolérant les champs absents (anciennes lignes, imports). */
export function parsePersona(json: string | null | undefined): Persona {
  const base = defaultPersona();
  if (!json) return base;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return base;
  }
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<Record<keyof Persona, unknown>>;
  const traits = (p.traits ?? {}) as Partial<Record<TraitKey, unknown>>;
  const rp = (p.roleplay ?? {}) as Partial<Record<keyof Roleplay, unknown>>;
  return {
    mode: p.mode === 'roleplay' ? 'roleplay' : 'assistant',
    traits: Object.fromEntries(
      TRAIT_KEYS.map((k) => [k, clamp(traits[k], NEUTRAL)]),
    ) as PersonaTraits,
    mature: p.mature === true,
    roleplay: {
      character: str(rp.character),
      scenario: str(rp.scenario),
      userName: str(rp.userName),
      userPersona: str(rp.userPersona),
      greeting: str(rp.greeting),
      pov: rp.pov === 'first' ? 'first' : 'third',
      format: rp.format === 'chat' ? 'chat' : 'novel',
    },
  };
}

export const serializePersona = (persona: Persona): string => JSON.stringify(persona);

/** Un persona est « neutre » s'il n'ajoute rien à l'instruction libre. */
export function isNeutralPersona(persona: Persona): boolean {
  return (
    persona.mode === 'assistant' &&
    !persona.mature &&
    TRAIT_KEYS.every((k) => traitLevel(persona.traits[k]) === 0)
  );
}

export type TraitLevel = -2 | -1 | 0 | 1 | 2;

/** Cinq paliers : ≤ 15 très bas, ≤ 35 bas, 36–64 neutre, ≥ 65 haut, ≥ 85 très haut. */
export function traitLevel(value: number): TraitLevel {
  if (value <= 15) return -2;
  if (value <= 35) return -1;
  if (value >= 85) return 2;
  if (value >= 65) return 1;
  return 0;
}

type Phrases = Record<Exclude<TraitLevel, 0>, string>;
type TraitPhrases = Record<TraitKey, Phrases>;

const traitsFr: TraitPhrases = {
  warmth: {
    [-2]: 'Reste froid et strictement factuel, sans marque d’empathie.',
    [-1]: 'Garde une certaine distance : ton neutre, peu d’effusions.',
    1: 'Sois chaleureux et bienveillant.',
    2: 'Sois très chaleureux, empathique et encourageant.',
  },
  humor: {
    [-2]: 'Aucun humour : reste parfaitement sérieux.',
    [-1]: 'Peu d’humour, un ton sérieux.',
    1: 'Glisse une touche d’humour quand c’est approprié.',
    2: 'Sois drôle et joueur : traits d’esprit et légèreté, sans perdre le fil.',
  },
  formality: {
    [-2]: 'Tutoie et parle de façon très familière et décontractée.',
    [-1]: 'Adopte un ton décontracté.',
    1: 'Adopte un registre soutenu et poli.',
    2: 'Adopte un registre très formel : vouvoie et soigne chaque formulation.',
  },
  verbosity: {
    [-2]: 'Réponds de façon extrêmement concise : une ou deux phrases, sauf demande explicite.',
    [-1]: 'Privilégie des réponses courtes.',
    1: 'Développe tes réponses avec des détails et des exemples.',
    2: 'Réponds de façon très détaillée et exhaustive : contexte, nuances, exemples.',
  },
  creativity: {
    [-2]: 'Tiens-t’en strictement aux faits, sans digression ni spéculation.',
    [-1]: 'Reste factuel et évite les fioritures.',
    1: 'Fais preuve d’imagination : métaphores, angles inattendus.',
    2: 'Sois très créatif et imaginatif : idées originales, images fortes.',
  },
  initiative: {
    [-2]: 'Réponds uniquement à ce qui est demandé, sans suggestion ni question.',
    [-1]: 'Limite les suggestions non demandées.',
    1: 'Prends des initiatives : propose des pistes, pose des questions de relance.',
    2: 'Mène l’échange : anticipe les besoins, propose activement la suite et relance.',
  },
};

const traitsEn: TraitPhrases = {
  warmth: {
    [-2]: 'Stay cold and strictly factual, with no show of empathy.',
    [-1]: 'Keep some distance: a neutral tone, little effusiveness.',
    1: 'Be warm and kind.',
    2: 'Be very warm, empathetic and encouraging.',
  },
  humor: {
    [-2]: 'No humor at all: stay perfectly serious.',
    [-1]: 'Little humor, a serious tone.',
    1: 'Slip in a touch of humor when appropriate.',
    2: 'Be funny and playful: wit and lightness, without losing the thread.',
  },
  formality: {
    [-2]: 'Speak in a very casual, familiar way.',
    [-1]: 'Keep a relaxed tone.',
    1: 'Use a polished, polite register.',
    2: 'Use a very formal register and weigh every phrasing.',
  },
  verbosity: {
    [-2]: 'Answer extremely concisely: one or two sentences unless explicitly asked.',
    [-1]: 'Prefer short answers.',
    1: 'Develop your answers with details and examples.',
    2: 'Answer in great depth: context, nuance, examples.',
  },
  creativity: {
    [-2]: 'Stick strictly to the facts, with no digression or speculation.',
    [-1]: 'Stay factual and avoid flourishes.',
    1: 'Show imagination: metaphors, unexpected angles.',
    2: 'Be highly creative and imaginative: original ideas, vivid imagery.',
  },
  initiative: {
    [-2]: 'Answer only what is asked, with no suggestions or questions.',
    [-1]: 'Limit unsolicited suggestions.',
    1: 'Take initiative: suggest leads, ask follow-up questions.',
    2: 'Lead the exchange: anticipate needs, actively propose what comes next.',
  },
};

/** En jeu de rôle, l'initiative et la verbosité parlent d'histoire plutôt que de réponses. */
const roleplayFr: Partial<TraitPhrases> = {
  verbosity: {
    [-2]: 'Réponses très brèves : une ou deux phrases par réplique.',
    [-1]: 'Réponses courtes, un paragraphe au plus.',
    1: 'Réponses développées : plusieurs paragraphes, descriptions et dialogues.',
    2: 'Réponses longues et immersives : scènes détaillées, sensations, dialogues fournis.',
  },
  initiative: {
    [-2]: 'Suis l’utilisateur sans jamais décider à sa place ni faire avancer l’intrigue seul.',
    [-1]: 'Laisse l’utilisateur mener ; n’introduis des événements que s’il le demande.',
    1: 'Fais avancer l’histoire : propose des événements et des rebondissements.',
    2: 'Fais vivre le monde : introduis des péripéties, des personnages secondaires et des surprises.',
  },
};

const roleplayEn: Partial<TraitPhrases> = {
  verbosity: {
    [-2]: 'Very brief replies: one or two sentences each.',
    [-1]: 'Short replies, one paragraph at most.',
    1: 'Developed replies: several paragraphs, descriptions and dialogue.',
    2: 'Long, immersive replies: detailed scenes, sensations, rich dialogue.',
  },
  initiative: {
    [-2]: 'Follow the user; never decide for them or move the plot forward on your own.',
    [-1]: 'Let the user lead; introduce events only when asked.',
    1: 'Move the story forward: suggest events and twists.',
    2: 'Bring the world to life: introduce incidents, side characters and surprises.',
  },
};

/** Remplace `{{char}}` et `{{user}}` (insensible à la casse), comme dans les fiches SillyTavern. */
export function fillTemplate(text: string, vars: { char: string; user: string }): string {
  return text.replace(/\{\{\s*(char|user)\s*\}\}/gi, (_, key: string) =>
    key.toLowerCase() === 'char' ? vars.char : vars.user,
  );
}

function templateVars(preset: PromptSource, fr: boolean) {
  return {
    char: preset.name.trim() || (fr ? 'le personnage' : 'the character'),
    user: preset.persona.roleplay.userName.trim() || (fr ? 'l’utilisateur' : 'the user'),
  };
}

interface PromptSource {
  name: string;
  systemPrompt: string | null;
  persona: Persona;
}

/** Instruction système complète envoyée au modèle, ou `null` si le persona est vide. */
export function buildSystemPrompt(preset: PromptSource, language: Language): string | null {
  const fr = language === 'fr';
  const { persona } = preset;
  const blocks: string[] = [];
  const free = preset.systemPrompt?.trim();
  if (free) blocks.push(free);

  if (persona.mode === 'roleplay') blocks.push(roleplayBlock(preset, fr));

  const base = fr ? traitsFr : traitsEn;
  const rp = persona.mode === 'roleplay' ? (fr ? roleplayFr : roleplayEn) : {};
  const lines = TRAIT_KEYS.flatMap((key) => {
    const level = traitLevel(persona.traits[key]);
    if (level === 0) return [];
    return [`- ${(rp[key] ?? base[key])[level]}`];
  });
  if (lines.length) blocks.push(`${fr ? 'Personnalité :' : 'Personality:'}\n${lines.join('\n')}`);

  if (persona.mature) blocks.push(fr ? MATURE_FR : MATURE_EN);

  return blocks.length ? fillTemplate(blocks.join('\n\n'), templateVars(preset, fr)) : null;
}

const MATURE_FR =
  'Contenu mature (18+) : l’utilisateur a confirmé être majeur. Les thèmes adultes — violence, langage cru, sexualité explicite entre personnages adultes consentants — sont autorisés lorsqu’ils servent la fiction ou la demande, sans avertissement ni euphémisme. Reste cohérent avec les personnages et ne sors pas de la fiction.';
const MATURE_EN =
  'Mature content (18+): the user has confirmed they are an adult. Adult themes — violence, crude language, explicit sexuality between consenting adult characters — are allowed when they serve the fiction or the request, without warnings or euphemisms. Stay consistent with the characters and do not break the fiction.';

function roleplayBlock(preset: PromptSource, fr: boolean): string {
  const rp = preset.persona.roleplay;
  const name = preset.name.trim() || (fr ? 'le personnage' : 'the character');
  const user = rp.userName.trim() || (fr ? 'l’utilisateur' : 'the user');
  const lines: string[] = [];
  lines.push(
    fr
      ? `Jeu de rôle : tu incarnes ${name}. Reste dans le personnage en toutes circonstances, ne mentionne jamais être une IA et ne sors du rôle que si l’utilisateur écrit « (HRP) ».`
      : `Roleplay: you are ${name}. Stay in character at all times, never mention being an AI, and only step out of the role when the user writes "(OOC)".`,
  );
  if (rp.character.trim())
    lines.push(`${fr ? 'Personnage' : 'Character'} : ${rp.character.trim()}`);
  if (rp.scenario.trim()) lines.push(`${fr ? 'Scénario' : 'Scenario'} : ${rp.scenario.trim()}`);
  const userDesc = rp.userPersona.trim();
  lines.push(
    fr
      ? `L’utilisateur joue ${user}${userDesc ? ` : ${userDesc}` : ''}. N’écris jamais ses actions, ses paroles ni ses pensées : laisse-lui ses choix.`
      : `The user plays ${user}${userDesc ? `: ${userDesc}` : ''}. Never write their actions, words or thoughts: leave them their choices.`,
  );
  lines.push(
    rp.pov === 'first'
      ? fr
        ? 'Narration à la première personne (« je »).'
        : 'First-person narration ("I").'
      : fr
        ? `Narration à la troisième personne (« ${name} … »).`
        : `Third-person narration ("${name} …").`,
  );
  lines.push(
    rp.format === 'chat'
      ? fr
        ? 'Format messagerie : répliques courtes, actions et pensées entre *astérisques*.'
        : 'Chat format: short lines, actions and thoughts between *asterisks*.'
      : fr
        ? 'Écris comme un roman : paragraphes narratifs, descriptions sensorielles, dialogues entre guillemets.'
        : 'Write like a novel: narrative paragraphs, sensory descriptions, dialogue in quotation marks.',
  );
  return lines.join('\n');
}

/** Première réplique à insérer dans une conversation vide (gabarits remplis), ou `null`. */
export function greetingOf(preset: PromptSource, language: Language): string | null {
  if (preset.persona.mode !== 'roleplay') return null;
  const g = preset.persona.roleplay.greeting.trim();
  return g ? fillTemplate(g, templateVars(preset, language === 'fr')) : null;
}
