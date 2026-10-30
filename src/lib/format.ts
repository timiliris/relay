import type { Conversation } from './db';

export type GroupKey = 'pinned' | 'today' | 'yesterday' | 'week' | 'older';

export interface ConversationGroup {
  key: GroupKey;
  items: Conversation[];
}

const DAY = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Regroupe les conversations : épinglées, puis par ancienneté de la dernière activité. */
export function groupConversations(items: Conversation[], now = new Date()): ConversationGroup[] {
  const today = startOfDay(now);
  const groups: Record<GroupKey, Conversation[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };

  for (const item of items) {
    if (item.pinned) {
      groups.pinned.push(item);
      continue;
    }
    const day = startOfDay(new Date(item.updatedAt));
    if (day >= today) groups.today.push(item);
    else if (day >= today - DAY) groups.yesterday.push(item);
    else if (day >= today - 7 * DAY) groups.week.push(item);
    else groups.older.push(item);
  }

  return (Object.keys(groups) as GroupKey[])
    .map((key) => ({ key, items: groups[key] }))
    .filter((group) => group.items.length > 0);
}

/** 128000 → « 128k », 1048576 → « 1M ». */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${trimZeros((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

/** Prix par million de tokens, lisible (0.15, 2.5, 15). */
export function formatPrice(perMillion: number): string {
  if (perMillion === 0) return '0';
  if (perMillion < 0.01) return trimZeros(perMillion.toFixed(4));
  if (perMillion < 1) return trimZeros(perMillion.toFixed(3));
  return trimZeros(perMillion.toFixed(2));
}

/** Coût d'une réponse en dollars, avec assez de décimales pour les micro-montants. */
export function formatCost(cost: number): string {
  if (cost === 0) return '0';
  if (cost < 0.0001) return cost.toExponential(1);
  if (cost < 0.01) return trimZeros(cost.toFixed(5));
  return trimZeros(cost.toFixed(3));
}

export function truncateTitle(text: string, max = 60): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function trimZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}
