/**
 * Estimation de la taille du contexte envoyé au modèle. Sans tokenizer exact
 * (il dépend du modèle), on approxime : ~3,5 caractères par token pour du
 * texte mixte français / code, ce qui reste prudent.
 */
import { estimateAttachmentTokens } from './attachments';
import type { Attachment, Message } from './db';

export const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;
}

export function estimateMessageTokens(content: string, attachments: Attachment[] = []): number {
  // ~4 tokens de surcoût par message (rôle, séparateurs).
  return (
    4 + estimateTokens(content) + attachments.reduce((n, a) => n + estimateAttachmentTokens(a), 0)
  );
}

export interface ContextEstimate {
  used: number;
  limit: number;
  /** 0..1, peut dépasser 1. */
  ratio: number;
  level: 'ok' | 'warn' | 'over';
}

export function estimateContext(
  history: Message[],
  draft: string,
  draftAttachments: Attachment[],
  systemPrompt: string | null,
  contextLength: number,
): ContextEstimate {
  const used =
    estimateTokens(systemPrompt ?? '') +
    history.reduce((n, m) => n + estimateMessageTokens(m.content, m.attachments), 0) +
    estimateMessageTokens(draft, draftAttachments);
  const limit = contextLength > 0 ? contextLength : 128_000;
  const ratio = used / limit;
  return { used, limit, ratio, level: ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok' };
}
