/**
 * Souvenirs du persona de la conversation ouverte, synchronisés avec SQLite.
 * Chargés à l'ouverture d'une conversation ayant un persona ; `buildHistory`
 * (`src/lib/chat-service.ts`) les lit de façon synchrone via `memoriesOf`.
 * Porte aussi le compteur par persona affiché dans les paramètres.
 */
import { create } from 'zustand';
import { type PersonaMemory, type PersonaMemoryPatch, personaMemories as repo } from '@/lib/db';
import { devFixturesEnabled, sampleMemories } from '@/lib/dev-fixtures';
import { sortMemories } from '@/lib/persona-memory';
import { isTauri } from '@/lib/tauri';

interface PersonaMemoryState {
  /** Persona dont `items` sont les souvenirs ; `null` si aucun n'est chargé. */
  presetId: string | null;
  items: PersonaMemory[];
  loading: boolean;
  /** Nombre de souvenirs par persona (paramètres). */
  counts: Record<string, number>;
  load: (presetId: string | null) => Promise<void>;
  /** Charge seulement si le persona demandé n'est pas déjà celui en mémoire. */
  ensure: (presetId: string | null) => Promise<void>;
  loadCounts: () => Promise<void>;
  add: (input: {
    presetId: string;
    content: string;
    sourceConversationId?: string | null;
    pinned?: boolean;
  }) => Promise<PersonaMemory>;
  update: (id: string, patch: PersonaMemoryPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeAll: (presetId: string) => Promise<void>;
}

/** Hors Tauri (démo navigateur) : carnet en mémoire, initialisé depuis les fixtures. */
const demo = new Map<string, PersonaMemory[]>();
const demoList = (presetId: string): PersonaMemory[] => {
  if (!demo.has(presetId))
    demo.set(presetId, devFixturesEnabled() ? [...(sampleMemories[presetId] ?? [])] : []);
  return demo.get(presetId) ?? [];
};

export const usePersonaMemory = create<PersonaMemoryState>()((set, get) => ({
  presetId: null,
  items: [],
  loading: false,
  counts: {},

  async load(presetId) {
    set({ presetId, items: [], loading: presetId !== null });
    if (!presetId) return;
    const items = isTauri() ? await repo.list(presetId) : demoList(presetId);
    // L'utilisateur a pu changer de conversation pendant le chargement.
    if (get().presetId === presetId) set({ items: sortMemories(items), loading: false });
  },

  async ensure(presetId) {
    if (get().presetId !== presetId) await get().load(presetId);
  },

  async loadCounts() {
    if (!isTauri()) {
      set({
        counts: Object.fromEntries(
          [...new Set([...Object.keys(sampleMemories), ...demo.keys()])]
            .filter(() => devFixturesEnabled())
            .map((id) => [id, demoList(id).length]),
        ),
      });
      return;
    }
    set({ counts: await repo.counts() });
  },

  async add(input) {
    let memory: PersonaMemory;
    if (isTauri()) {
      memory = await repo.add(input);
    } else {
      memory = {
        id: crypto.randomUUID(),
        presetId: input.presetId,
        content: input.content,
        sourceConversationId: input.sourceConversationId ?? null,
        pinned: input.pinned ?? false,
        createdAt: new Date().toISOString(),
      };
      demoList(input.presetId).push(memory);
    }
    set((s) => ({
      items: s.presetId === memory.presetId ? sortMemories([...s.items, memory]) : s.items,
      counts: { ...s.counts, [memory.presetId]: (s.counts[memory.presetId] ?? 0) + 1 },
    }));
    return memory;
  },

  async update(id, patch) {
    if (isTauri()) await repo.update(id, patch);
    else {
      for (const list of demo.values()) {
        const index = list.findIndex((m) => m.id === id);
        if (index >= 0) list[index] = { ...(list[index] as PersonaMemory), ...patch };
      }
    }
    set((s) => ({
      items: sortMemories(s.items.map((m) => (m.id === id ? { ...m, ...patch } : m))),
    }));
  },

  async remove(id) {
    const victim = get().items.find((m) => m.id === id);
    if (isTauri()) await repo.remove(id);
    else
      for (const [key, list] of demo)
        demo.set(
          key,
          list.filter((m) => m.id !== id),
        );
    set((s) => ({
      items: s.items.filter((m) => m.id !== id),
      counts: victim
        ? { ...s.counts, [victim.presetId]: Math.max(0, (s.counts[victim.presetId] ?? 1) - 1) }
        : s.counts,
    }));
  },

  async removeAll(presetId) {
    if (isTauri()) await repo.removeAll(presetId);
    else demo.set(presetId, []);
    set((s) => ({
      items: s.presetId === presetId ? [] : s.items,
      counts: { ...s.counts, [presetId]: 0 },
    }));
  },
}));

/** Souvenirs du persona `presetId` s'ils sont chargés (lecture synchrone pour `buildHistory`). */
export function memoriesOf(presetId: string): PersonaMemory[] {
  const s = usePersonaMemory.getState();
  return s.presetId === presetId ? s.items : [];
}
