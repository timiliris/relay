/**
 * Arbre de messages : chaque message pointe vers son parent ; parmi les frères
 * (même parent), un seul est `active`. La conversation affichée est le chemin
 * actif depuis la racine.
 */
import type { Message } from './db';

/** Chemin actif : racine active, puis enfant actif, etc. */
export function activePath(all: Message[]): Message[] {
  const byParent = new Map<string | null, Message[]>();
  for (const m of all) {
    const list = byParent.get(m.parentId) ?? [];
    list.push(m);
    byParent.set(m.parentId, list);
  }
  const path: Message[] = [];
  let parentId: string | null = null;
  for (;;) {
    const siblings = byParent.get(parentId);
    if (!siblings || siblings.length === 0) break;
    const next = siblings.find((m) => m.active) ?? siblings[siblings.length - 1];
    if (!next) break;
    path.push(next);
    parentId = next.id;
  }
  return path;
}

/** Frères d'un message (lui inclus), dans l'ordre de création. */
export function siblingsOf(all: Message[], message: Message): Message[] {
  return all.filter(
    (m) => m.conversationId === message.conversationId && m.parentId === message.parentId,
  );
}

/** Position « 2/3 » d'un message parmi ses frères. */
export function siblingIndex(all: Message[], message: Message): { index: number; total: number } {
  const siblings = siblingsOf(all, message);
  return { index: siblings.findIndex((m) => m.id === message.id) + 1, total: siblings.length };
}

/** Dernier message du chemin actif (parent des prochains messages). */
export function tail(all: Message[]): Message | null {
  const path = activePath(all);
  return path[path.length - 1] ?? null;
}
