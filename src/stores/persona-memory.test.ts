import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonaMemory } from '@/lib/db';
import { memoriesOf, usePersonaMemory } from './persona-memory';

const { rows, calls } = vi.hoisted(() => ({
  rows: [] as PersonaMemory[],
  calls: [] as string[],
}));

vi.mock('@/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri')>()),
  isTauri: () => true,
}));

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  let seq = 0;
  return {
    ...actual,
    personaMemories: {
      async list(presetId: string) {
        calls.push(`list:${presetId}`);
        return rows.filter((m) => m.presetId === presetId);
      },
      async counts() {
        calls.push('counts');
        const counts: Record<string, number> = {};
        for (const m of rows) counts[m.presetId] = (counts[m.presetId] ?? 0) + 1;
        return counts;
      },
      async add(input: { presetId: string; content: string; sourceConversationId?: string }) {
        calls.push(`add:${input.content}`);
        const memory: PersonaMemory = {
          id: `m${++seq}`,
          presetId: input.presetId,
          content: input.content,
          sourceConversationId: input.sourceConversationId ?? null,
          pinned: false,
          createdAt: `2026-01-01T00:00:0${seq}.000Z`,
        };
        rows.push(memory);
        return memory;
      },
      async update(id: string, patch: Partial<PersonaMemory>) {
        calls.push(`update:${id}`);
        const index = rows.findIndex((m) => m.id === id);
        if (index >= 0) rows[index] = { ...(rows[index] as PersonaMemory), ...patch };
      },
      async remove(id: string) {
        calls.push(`remove:${id}`);
        const index = rows.findIndex((m) => m.id === id);
        if (index >= 0) rows.splice(index, 1);
      },
      async removeAll(presetId: string) {
        calls.push(`removeAll:${presetId}`);
        for (let i = rows.length - 1; i >= 0; i--)
          if (rows[i]?.presetId === presetId) rows.splice(i, 1);
      },
    },
  };
});

describe('usePersonaMemory', () => {
  beforeEach(() => {
    rows.length = 0;
    calls.length = 0;
    usePersonaMemory.setState({ presetId: null, items: [], loading: false, counts: {} });
  });

  it('charge les souvenirs d’un persona et les expose de façon synchrone', async () => {
    rows.push({
      id: 'x',
      presetId: 'p1',
      content: 'Fait existant',
      sourceConversationId: null,
      pinned: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await usePersonaMemory.getState().load('p1');
    expect(calls).toEqual(['list:p1']);
    expect(memoriesOf('p1').map((m) => m.content)).toEqual(['Fait existant']);
    expect(memoriesOf('p2')).toEqual([]);

    // `ensure` ne recharge pas le même persona.
    await usePersonaMemory.getState().ensure('p1');
    expect(calls).toEqual(['list:p1']);
    await usePersonaMemory.getState().ensure(null);
    expect(usePersonaMemory.getState().presetId).toBeNull();
    expect(memoriesOf('p1')).toEqual([]);
  });

  it('ajoute via le dépôt, met à jour la liste et le compteur, puis supprime', async () => {
    const store = usePersonaMemory.getState();
    await store.load('p1');
    const added = await store.add({
      presetId: 'p1',
      content: 'Tom est un nain.',
      sourceConversationId: 'c1',
    });
    expect(added.sourceConversationId).toBe('c1');
    expect(usePersonaMemory.getState().items.map((m) => m.content)).toEqual(['Tom est un nain.']);
    expect(usePersonaMemory.getState().counts.p1).toBe(1);

    // Un souvenir d’un autre persona n’apparaît pas dans la liste courante.
    await store.add({ presetId: 'p2', content: 'Autre' });
    expect(usePersonaMemory.getState().items).toHaveLength(1);
    expect(usePersonaMemory.getState().counts.p2).toBe(1);

    await store.update(added.id, { pinned: true });
    expect(usePersonaMemory.getState().items[0]?.pinned).toBe(true);

    await store.remove(added.id);
    expect(usePersonaMemory.getState().items).toEqual([]);
    expect(usePersonaMemory.getState().counts.p1).toBe(0);
    expect(calls).toEqual([
      'list:p1',
      'add:Tom est un nain.',
      'add:Autre',
      `update:${added.id}`,
      `remove:${added.id}`,
    ]);
    expect(rows.map((m) => m.content)).toEqual(['Autre']);
  });

  it('épingle en tête et efface tout', async () => {
    const store = usePersonaMemory.getState();
    await store.load('p1');
    await store.add({ presetId: 'p1', content: 'A' });
    const b = await store.add({ presetId: 'p1', content: 'B' });
    await store.update(b.id, { pinned: true });
    expect(usePersonaMemory.getState().items.map((m) => m.content)).toEqual(['B', 'A']);

    await store.removeAll('p1');
    expect(usePersonaMemory.getState().items).toEqual([]);
    expect(usePersonaMemory.getState().counts.p1).toBe(0);
    expect(rows).toEqual([]);

    await store.loadCounts();
    expect(usePersonaMemory.getState().counts).toEqual({});
  });
});
