/** Liste des conversations (historique), synchronisée avec SQLite. */
import { create } from 'zustand';
import { type Conversation, conversations as repo } from '@/lib/db';
import { isTauri } from '@/lib/tauri';

interface ConversationsState {
  items: Conversation[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (input: {
    title: string;
    model: string;
    systemPrompt: string | null;
  }) => Promise<Conversation>;
  rename: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setModel: (id: string, model: string) => Promise<void>;
  setSystemPrompt: (id: string, systemPrompt: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Met à jour `updatedAt` localement après un `repo.touch`. */
  touched: (id: string, at: string) => void;
}

const sort = (items: Conversation[]) =>
  [...items].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
  );

export const useConversations = create<ConversationsState>()((set, get) => {
  const patch = async (id: string, values: Partial<Conversation>) => {
    await repo.update(id, values);
    set((s) => ({ items: sort(s.items.map((c) => (c.id === id ? { ...c, ...values } : c))) }));
  };

  return {
    items: [],
    loaded: false,
    async load() {
      if (!isTauri()) {
        set({ loaded: true });
        return;
      }
      set({ items: sort(await repo.list()), loaded: true });
    },
    async create(input) {
      const conversation = await repo.create(input);
      set((s) => ({ items: sort([conversation, ...s.items]) }));
      return conversation;
    },
    rename: (id, title) => patch(id, { title }),
    async togglePin(id) {
      const current = get().items.find((c) => c.id === id);
      if (current) await patch(id, { pinned: !current.pinned });
    },
    setModel: (id, model) => patch(id, { model }),
    setSystemPrompt: (id, systemPrompt) => patch(id, { systemPrompt }),
    async remove(id) {
      await repo.remove(id);
      set((s) => ({ items: s.items.filter((c) => c.id !== id) }));
    },
    touched: (id, at) =>
      set((s) => ({
        items: sort(s.items.map((c) => (c.id === id ? { ...c, updatedAt: at } : c))),
      })),
  };
});
