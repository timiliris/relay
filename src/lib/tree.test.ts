import { describe, expect, it } from 'vitest';
import type { Message } from './db';
import { activePath, siblingIndex } from './tree';

const msg = (
  id: string,
  parentId: string | null,
  active = true,
  role: Message['role'] = 'user',
): Message => ({
  id,
  conversationId: 'c',
  parentId,
  active,
  role,
  content: id,
  reasoning: null,
  attachments: [],
  model: null,
  promptTokens: null,
  completionTokens: null,
  cost: null,
  finishReason: null,
  durationMs: null,
  createdAt: '2026-10-30T10:00:00Z',
});

describe('activePath', () => {
  it('suit la version active à chaque niveau', () => {
    const all = [
      msg('u1', null),
      msg('a1', 'u1', false, 'assistant'),
      msg('a2', 'u1', true, 'assistant'),
      msg('u2', 'a2'),
      msg('a3', 'u2', true, 'assistant'),
      msg('u2-orphan', 'a1'), // branche inactive
    ];
    expect(activePath(all).map((m) => m.id)).toEqual(['u1', 'a2', 'u2', 'a3']);
  });

  it('retombe sur le dernier frère si aucun n’est actif', () => {
    const all = [msg('u1', null, false), msg('u1b', null, false)];
    expect(activePath(all).map((m) => m.id)).toEqual(['u1b']);
  });

  it('indique la position parmi les frères', () => {
    const all = [
      msg('u1', null),
      msg('a1', 'u1', false, 'assistant'),
      msg('a2', 'u1', true, 'assistant'),
    ];
    expect(siblingIndex(all, all[2] as Message)).toEqual({ index: 2, total: 2 });
    expect(siblingIndex(all, all[0] as Message)).toEqual({ index: 1, total: 1 });
  });
});
