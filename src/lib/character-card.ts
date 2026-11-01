/**
 * Fiches de personnage au format « Character Card » (V1, V2 `chara_card_v2`, V3 `chara_card_v3`),
 * le standard de SillyTavern et des sites de partage : JSON nu ou PNG portant la fiche en
 * base64 dans un chunk `tEXt` (`chara` ou `ccv3`). Conversion vers et depuis un persona Relay.
 */
import type { Preset } from './db';
import { defaultPersona, type Persona, parsePersona } from './persona';

export type CardErrorCode = 'notPng' | 'noChunk' | 'invalidJson' | 'unknownFormat';

export class CardError extends Error {
  readonly code: CardErrorCode;
  constructor(code: CardErrorCode) {
    super(code);
    this.name = 'CardError';
    this.code = code;
  }
}

export interface CharacterCardData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  creator_notes: string;
  extensions: Record<string, unknown>;
}

export interface CharacterCard {
  spec: 'chara_card_v1' | 'chara_card_v2' | 'chara_card_v3';
  data: CharacterCardData;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Lit une fiche depuis le contenu brut d'un fichier `.json` (texte) ou `.png` (octets). */
export function parseCharacterCard(input: Uint8Array | string): CharacterCard {
  const text = typeof input === 'string' ? input : textFromPng(input);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CardError('invalidJson');
  }
  return normalizeCard(raw);
}

/** Accepte V1 (objet plat), V2 et V3 (`spec` + `data`). */
export function normalizeCard(raw: unknown): CharacterCard {
  if (!raw || typeof raw !== 'object') throw new CardError('unknownFormat');
  const obj = raw as Record<string, unknown>;
  const spec = str(obj.spec);
  const data =
    spec === 'chara_card_v2' || spec === 'chara_card_v3'
      ? (obj.data as Record<string, unknown> | undefined)
      : obj;
  if (!data || typeof data !== 'object') throw new CardError('unknownFormat');
  const name = str(data.name).trim();
  const hasCardShape =
    'description' in data || 'first_mes' in data || 'personality' in data || 'scenario' in data;
  if (!name || !hasCardShape) throw new CardError('unknownFormat');
  return {
    spec:
      spec === 'chara_card_v3'
        ? 'chara_card_v3'
        : spec === 'chara_card_v2'
          ? 'chara_card_v2'
          : 'chara_card_v1',
    data: {
      name,
      description: str(data.description),
      personality: str(data.personality),
      scenario: str(data.scenario),
      first_mes: str(data.first_mes),
      mes_example: str(data.mes_example),
      system_prompt: str(data.system_prompt),
      post_history_instructions: str(data.post_history_instructions),
      alternate_greetings: strList(data.alternate_greetings),
      tags: strList(data.tags),
      creator: str(data.creator),
      character_version: str(data.character_version),
      creator_notes: str(data.creator_notes),
      extensions:
        data.extensions && typeof data.extensions === 'object'
          ? (data.extensions as Record<string, unknown>)
          : {},
    },
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Extrait la fiche (base64) des chunks `tEXt` d'un PNG : `ccv3` prioritaire, sinon `chara`. */
export function textFromPng(bytes: Uint8Array): string {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw new CardError('notPng');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const latin1 = new TextDecoder('latin1');
  const chunks = new Map<string, string>();
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = latin1.decode(bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) break;
    if (type === 'tEXt') {
      const data = bytes.subarray(start, end);
      const sep = data.indexOf(0);
      if (sep > 0) {
        const keyword = latin1.decode(data.subarray(0, sep));
        chunks.set(keyword, latin1.decode(data.subarray(sep + 1)));
      }
    }
    if (type === 'IEND') break;
    offset = end + 4; // CRC
  }
  const encoded = chunks.get('ccv3') ?? chunks.get('chara');
  if (!encoded) throw new CardError('noChunk');
  try {
    return decodeBase64Utf8(encoded);
  } catch {
    throw new CardError('invalidJson');
  }
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const joinBlocks = (...parts: Array<string | null | undefined>): string =>
  parts
    .map((p) => p?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');

/**
 * Convertit une fiche en persona, à partir d'un preset vierge (identifiant, position).
 * Les fiches exportées par Relay portent le persona complet dans `extensions.relay.persona`.
 */
export function presetFromCard(card: CharacterCard, base: Preset, language: 'fr' | 'en'): Preset {
  const d = card.data;
  const relay = (d.extensions.relay as { persona?: unknown } | undefined)?.persona;
  const persona: Persona = relay ? parsePersona(JSON.stringify(relay)) : defaultPersona();
  const fr = language === 'fr';
  const character = joinBlocks(
    d.description,
    d.personality && `${fr ? 'Personnalité' : 'Personality'} : ${d.personality.trim()}`,
    d.mes_example &&
      `${fr ? 'Exemples de dialogue' : 'Example dialogue'} :\n${d.mes_example.trim()}`,
  );
  return {
    ...base,
    name: d.name,
    systemPrompt: joinBlocks(d.system_prompt, d.post_history_instructions) || null,
    persona: {
      ...persona,
      mode: 'roleplay',
      roleplay: {
        ...persona.roleplay,
        character,
        scenario: d.scenario.trim(),
        greeting: d.first_mes.trim(),
      },
    },
  };
}

/** Fiche V2 exportable ; le persona complet voyage dans `extensions.relay` pour un aller-retour fidèle. */
export function cardFromPreset(preset: Preset): CharacterCard {
  const rp = preset.persona.roleplay;
  return {
    spec: 'chara_card_v2',
    data: {
      name: preset.name,
      description: rp.character,
      personality: '',
      scenario: rp.scenario,
      first_mes: rp.greeting,
      mes_example: '',
      system_prompt: preset.systemPrompt ?? '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: preset.persona.mature ? ['nsfw'] : [],
      creator: 'Relay',
      character_version: '1.0',
      creator_notes: '',
      extensions: { relay: { persona: preset.persona } },
    },
  };
}

/** Sérialisation V2 complète (`spec_version` requis par la norme). */
export function serializeCard(card: CharacterCard): string {
  return JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: card.data }, null, 2);
}
