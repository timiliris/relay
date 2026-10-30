import { describe, expect, it } from 'vitest';
import type { Conversation } from './db';
import { formatCost, formatPrice, formatTokens, groupConversations, truncateTitle } from './format';

const conv = (id: string, updatedAt: string, pinned = false): Conversation => ({
  id,
  title: id,
  model: 'openrouter/auto',
  systemPrompt: null,
  pinned,
  createdAt: updatedAt,
  updatedAt,
});

describe('groupConversations', () => {
  it('répartit par ancienneté et met les épinglées en premier', () => {
    const now = new Date('2026-10-30T15:00:00');
    const groups = groupConversations(
      [
        conv('old', '2026-09-01T10:00:00'),
        conv('today', '2026-10-30T09:00:00'),
        conv('pinned', '2026-01-01T00:00:00', true),
        conv('yesterday', '2026-10-29T23:30:00'),
        conv('week', '2026-10-25T12:00:00'),
      ],
      now,
    );
    expect(groups.map((g) => g.key)).toEqual(['pinned', 'today', 'yesterday', 'week', 'older']);
    expect(groups[0]?.items[0]?.id).toBe('pinned');
  });

  it('omet les groupes vides', () => {
    const groups = groupConversations(
      [conv('a', '2026-10-30T10:00:00')],
      new Date('2026-10-30T12:00:00'),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('today');
  });
});

describe('formats', () => {
  it('abrège les tokens', () => {
    expect(formatTokens(128_000)).toBe('128k');
    expect(formatTokens(1_048_576)).toBe('1M');
    expect(formatTokens(512)).toBe('512');
  });

  it('formate prix et coûts sans zéros inutiles', () => {
    expect(formatPrice(0)).toBe('0');
    expect(formatPrice(0.15)).toBe('0.15');
    expect(formatPrice(15)).toBe('15');
    expect(formatCost(0.00123)).toBe('0.00123');
    expect(formatCost(1.5)).toBe('1.5');
  });

  it('tronque les titres', () => {
    expect(truncateTitle('  bonjour   le monde ')).toBe('bonjour le monde');
    expect(truncateTitle('a'.repeat(100), 10)).toHaveLength(10);
  });
});
