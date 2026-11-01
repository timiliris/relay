/**
 * Mémoire par persona : carnet de faits courts (« Le joueur s'appelle Tom »)
 * injecté dans l'instruction système de chaque conversation du persona.
 * Mise en forme du bloc, estimation de son poids, résumé d'un message en fait,
 * et extraction de faits par le modèle. Indépendant de React.
 */
import i18n, { type Language } from '@/i18n';
import { estimateTokens } from './context';
import type { Message, PersonaMemory } from './db';
import { openrouter } from './openrouter';

/** Intitulé du bloc mémoire dans l'instruction système, selon la langue de l'interface. */
export const MEMORY_LABEL: Record<Language, string> = {
  fr: 'Mémoire du personnage :',
  en: 'Character memory:',
};

/** Longueur maximale proposée pour un fait extrait d'un message. */
export const MEMORY_SUMMARY_LENGTH = 200;
/** Nombre maximal de faits proposés par une extraction. */
export const MAX_EXTRACTED_FACTS = 5;
/** Messages récents relus par l'extraction (et taille maximale de la transcription). */
const EXTRACT_MESSAGES = 30;
const EXTRACT_CHARS = 12_000;

/** Épinglés d'abord, puis par ordre d'ajout. */
export function sortMemories(items: PersonaMemory[]): PersonaMemory[] {
  return [...items].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt),
  );
}

/** Bloc « Mémoire du personnage : » en puces ; `null` sans souvenir. */
export function formatMemoryBlock(items: PersonaMemory[], language: Language): string | null {
  const facts = sortMemories(items)
    .map((m) => m.content.trim())
    .filter(Boolean);
  if (facts.length === 0) return null;
  return `${MEMORY_LABEL[language]}\n${facts.map((f) => `- ${f}`).join('\n')}`;
}

/** Poids approximatif du bloc mémoire dans le contexte. */
export function estimateMemoryTokens(items: PersonaMemory[], language: Language): number {
  return estimateTokens(formatMemoryBlock(items, language) ?? '');
}

/** Première phrase d'un message, ramenée à une ligne et coupée pour préremplir un souvenir. */
export function summarizeForMemory(content: string, max = MEMORY_SUMMARY_LENGTH): string {
  const flat = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return `${boundary > max / 2 ? cut.slice(0, boundary) : cut}…`;
}

/** Extrait les faits d'une réponse du modèle (puces, numéros, lignes) ; dédoublonne. */
export function parseFacts(raw: string, existing: string[] = []): string[] {
  const known = new Set(existing.map(normalizeFact));
  const facts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const fact = line
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .replace(/^["'«»\s]+|["'«»\s]+$/g, '')
      .trim();
    if (fact.length < 4 || /^(aucun|none|n\/a)/i.test(fact)) continue;
    const key = normalizeFact(fact);
    if (known.has(key)) continue;
    known.add(key);
    facts.push(fact);
    if (facts.length >= MAX_EXTRACTED_FACTS) break;
  }
  return facts;
}

const normalizeFact = (fact: string): string =>
  fact
    .toLowerCase()
    .replace(/[.!?…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Demande au modèle 3 à 5 faits nouveaux à retenir, à partir des derniers messages
 * de la conversation et des souvenirs déjà connus (appel non streamé).
 */
export async function extractFacts(
  model: string,
  messages: Message[],
  existing: PersonaMemory[],
): Promise<string[]> {
  const recent = messages
    .filter((m) => m.role !== 'system' && m.content.trim())
    .slice(-EXTRACT_MESSAGES);
  let transcript = recent
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  if (transcript.length > EXTRACT_CHARS) transcript = transcript.slice(-EXTRACT_CHARS);
  const known = existing.map((m) => m.content);
  const knownBlock = known.length
    ? `${i18n.t('presets.memory.extractExisting')}\n${known.map((f) => `- ${f}`).join('\n')}\n\n`
    : '';
  const raw = await openrouter.completeChat({
    model,
    messages: [
      { role: 'system', content: i18n.t('presets.memory.extractPrompt') },
      { role: 'user', content: `${knownBlock}${transcript}` },
    ],
    temperature: 0.2,
    maxTokens: 400,
  });
  return parseFacts(raw, known);
}
