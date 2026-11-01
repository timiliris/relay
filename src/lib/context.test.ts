import { describe, expect, it } from 'vitest';
import { estimateContext, estimateTokens } from './context';
import type { Message } from './db';

const msg = (content: string): Message => ({
  id: content,
  conversationId: 'c',
  parentId: null,
  active: true,
  role: 'user',
  content,
  reasoning: null,
  attachments: [],
  model: null,
  promptTokens: null,
  completionTokens: null,
  cost: null,
  finishReason: null,
  pinned: false,
  durationMs: null,
  createdAt: '',
});

describe('context', () => {
  it('estime les tokens à partir des caractères', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(35))).toBe(10);
  });

  it('classe le niveau de remplissage', () => {
    expect(estimateContext([msg('bonjour')], '', [], null, 1000).level).toBe('ok');
    expect(estimateContext([msg('x'.repeat(3000))], '', [], null, 1000).level).toBe('warn');
    const over = estimateContext([msg('x'.repeat(4000))], '', [], null, 1000);
    expect(over.level).toBe('over');
    expect(over.ratio).toBeGreaterThan(1);
  });
});
