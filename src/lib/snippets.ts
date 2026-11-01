/**
 * Raccourcis de prompt : un déclencheur tapé en début de message (`/résume`) est
 * remplacé par un corps développé. Les gabarits `{{selection}}` (texte déjà saisi
 * après le déclencheur) et `{{clipboard}}` (presse-papiers) sont substitués.
 * Persistés dans le store de réglages (`snippets`), pas en base.
 */
import type { Language } from '@/i18n';

export interface Snippet {
  id: string;
  /** Déclencheur sans le `/` initial, sans espace. */
  trigger: string;
  title: string;
  body: string;
  position: number;
}

export const SNIPPET_PREFIX = '/';

type DefaultSnippet = Pick<Snippet, 'trigger' | 'title' | 'body'>;

const fr: DefaultSnippet[] = [
  {
    trigger: 'résume',
    title: 'Résumer',
    body: 'Résume le texte suivant en cinq points :\n\n{{selection}}',
  },
  {
    trigger: 'traduis',
    title: 'Traduire en anglais',
    body: 'Traduis en anglais, en conservant le ton :\n\n{{selection}}',
  },
  {
    trigger: 'explique',
    title: 'Expliquer simplement',
    body: 'Explique simplement, comme à un débutant, avec un exemple concret :\n\n{{selection}}',
  },
  {
    trigger: 'corrige',
    title: 'Corriger du code',
    body: 'Corrige le code suivant : indique chaque bug, explique-le en une phrase, puis donne la version corrigée complète.\n\n{{selection}}',
  },
  {
    trigger: 'colle',
    title: 'Analyser le presse-papiers',
    body: 'Analyse le texte suivant et dis-moi ce qui mérite attention :\n\n{{clipboard}}',
  },
];

const en: DefaultSnippet[] = [
  {
    trigger: 'summarize',
    title: 'Summarize',
    body: 'Summarize the following text in five bullet points:\n\n{{selection}}',
  },
  {
    trigger: 'translate',
    title: 'Translate to French',
    body: 'Translate into French, keeping the tone:\n\n{{selection}}',
  },
  {
    trigger: 'explain',
    title: 'Explain simply',
    body: 'Explain this simply, as to a beginner, with a concrete example:\n\n{{selection}}',
  },
  {
    trigger: 'fix',
    title: 'Fix code',
    body: 'Fix the following code: list each bug, explain it in one sentence, then give the full corrected version.\n\n{{selection}}',
  },
  {
    trigger: 'paste',
    title: 'Analyze clipboard',
    body: 'Analyze the following text and tell me what deserves attention:\n\n{{clipboard}}',
  },
];

/** Raccourcis fournis par défaut dans la langue de l'UI. */
export function defaultSnippets(language: Language, newId: () => string): Snippet[] {
  return (language === 'fr' ? fr : en).map((s, position) => ({ ...s, id: newId(), position }));
}

/** Normalise un déclencheur saisi : sans `/`, sans espaces, en minuscules. */
export function normalizeTrigger(input: string): string {
  return input.trim().replace(/^\/+/, '').replace(/\s+/g, '-').toLowerCase();
}

/**
 * Déclencheur en cours de frappe : le texte commence par `/` et ne contient pas
 * encore d'espace ni de retour à la ligne (`/ré` → `ré`). Sinon `null`.
 */
export function pendingTrigger(text: string): string | null {
  if (!text.startsWith(SNIPPET_PREFIX)) return null;
  const match = /^\/(\S*)$/.exec(text);
  return match ? (match[1] ?? '') : null;
}

/** Raccourcis dont le déclencheur ou le titre contient la saisie, les préfixes d'abord. */
export function filterSnippets(snippets: Snippet[], query: string): Snippet[] {
  const q = query.trim().toLowerCase();
  const sorted = [...snippets].sort((a, b) => a.position - b.position);
  if (!q) return sorted;
  const starts = sorted.filter((s) => s.trigger.toLowerCase().startsWith(q));
  const contains = sorted.filter(
    (s) =>
      !starts.includes(s) &&
      (s.trigger.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)),
  );
  return [...starts, ...contains];
}

/** Remplace les gabarits du corps par leurs valeurs. */
export function expandBody(body: string, values: { selection: string; clipboard: string }): string {
  return body
    .replace(/\{\{\s*selection\s*\}\}/gi, values.selection)
    .replace(/\{\{\s*clipboard\s*\}\}/gi, values.clipboard)
    .trim();
}

/** `true` si le corps a besoin du presse-papiers (évite une demande d'autorisation inutile). */
export const usesClipboard = (body: string): boolean => /\{\{\s*clipboard\s*\}\}/i.test(body);

/** Lecture tolérante du presse-papiers : chaîne vide si refusé ou indisponible. */
export async function readClipboard(): Promise<string> {
  try {
    return (await navigator.clipboard.readText()) ?? '';
  } catch {
    return '';
  }
}

/**
 * Développe un raccourci présent en tête du texte (`/résume le reste…`). Un
 * déclencheur inconnu, ou un texte sans `/`, est rendu tel quel. Le reste du
 * texte devient `{{selection}}` ; s'il n'y a pas de gabarit, il est ajouté à la fin.
 */
export async function expandLeadingSnippet(
  text: string,
  snippets: Snippet[],
  clipboard: () => Promise<string> = readClipboard,
): Promise<string> {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return text;
  const snippet = snippets.find((s) => s.trigger.toLowerCase() === (match[1] ?? '').toLowerCase());
  if (!snippet) return text;
  return expandSnippet(snippet, match[2] ?? '', clipboard);
}

/** Développe un raccourci donné avec le texte sélectionné ; cf. `expandLeadingSnippet`. */
export async function expandSnippet(
  snippet: Snippet,
  selection: string,
  clipboard: () => Promise<string> = readClipboard,
): Promise<string> {
  const trimmed = selection.trim();
  const hasSelection = /\{\{\s*selection\s*\}\}/i.test(snippet.body);
  const values = {
    selection: trimmed,
    clipboard: usesClipboard(snippet.body) ? await clipboard() : '',
  };
  const expanded = expandBody(snippet.body, values);
  return hasSelection || !trimmed ? expanded : `${expanded}\n\n${trimmed}`;
}
