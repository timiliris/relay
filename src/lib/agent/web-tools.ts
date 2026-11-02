/**
 * Outils web de l'agent, indépendants du dossier de travail : `fetch_url` lit une page publique
 * via Rust (`src-tauri/src/agent/web.rs`), qui refuse les adresses locales et le non-http(s).
 */

import { browserCommands, type PageText } from './commands';
import type { ToolMeta, ToolName } from './types';

export const DEFAULT_FETCH_CHARS = 20_000;
export const MIN_FETCH_CHARS = 200;
export const MAX_FETCH_CHARS = 200_000;

/** Même forme que le résultat d'`executeTool` (runner) : contenu pour le modèle et métadonnées. */
export interface WebToolOutcome {
  content: string;
  meta: Partial<ToolMeta>;
}

const clampChars = (value: unknown): number => {
  const n = Number(value ?? DEFAULT_FETCH_CHARS);
  if (!Number.isFinite(n)) return DEFAULT_FETCH_CHARS;
  return Math.min(MAX_FETCH_CHARS, Math.max(MIN_FETCH_CHARS, Math.round(n)));
};

/** Texte renvoyé au modèle : en-tête (titre, URL finale, troncature) puis contenu. */
export function formatPage(page: PageText): string {
  const header = [
    page.title ? `# ${page.title}` : null,
    `URL: ${page.url}`,
    page.truncated ? '(content truncated: ask for a larger max_chars if needed)' : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  return page.text.trim() ? `${header}\n\n${page.text}` : `${header}\n\n(no readable text)`;
}

/** Exécute un outil web ; les erreurs Rust remontent au runner, qui les transforme en résultat `error`. */
export async function executeWebTool(
  name: ToolName,
  args: Record<string, unknown>,
): Promise<WebToolOutcome> {
  switch (name) {
    case 'fetch_url': {
      const page = await browserCommands.fetchUrl(
        String(args.url ?? '').trim(),
        clampChars(args.max_chars),
      );
      return { content: formatPage(page), meta: { truncated: page.truncated } };
    }
    default:
      throw new Error(`Unknown web tool: ${name}`);
  }
}
