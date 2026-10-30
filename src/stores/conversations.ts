/** Conversations (historique), dossiers et presets, synchronisés avec SQLite. */
import { create } from 'zustand';
import {
  type Conversation,
  type ConversationPatch,
  type Folder,
  folders as folderRepo,
  type Preset,
  presets as presetRepo,
  conversations as repo,
} from '@/lib/db';
import { isTauri } from '@/lib/tauri';

interface ConversationsState {
  items: Conversation[];
  folders: Folder[];
  presets: Preset[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (input: Parameters<typeof repo.create>[0]) => Promise<Conversation>;
  update: (id: string, patch: ConversationPatch) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  setModel: (id: string, model: string) => Promise<void>;
  setSystemPrompt: (id: string, systemPrompt: string | null) => Promise<void>;
  moveToFolder: (id: string, folderId: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeArchived: () => Promise<number>;
  /** Met à jour `updatedAt` localement après un `repo.touch`. */
  touched: (id: string, at: string) => void;
  createFolder: (name: string) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  savePreset: (preset: Parameters<typeof presetRepo.save>[0]) => Promise<Preset>;
  removePreset: (id: string) => Promise<void>;
}

const sort = (items: Conversation[]) =>
  [...items].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
  );

export const useConversations = create<ConversationsState>()((set, get) => {
  const update = async (id: string, patch: ConversationPatch) => {
    await repo.update(id, patch);
    set((s) => ({ items: sort(s.items.map((c) => (c.id === id ? { ...c, ...patch } : c))) }));
  };

  return {
    items: [],
    folders: [],
    presets: [],
    loaded: false,

    async load() {
      if (!isTauri()) {
        set({ loaded: true });
        return;
      }
      const [items, folders, presets] = await Promise.all([
        repo.list(),
        folderRepo.list(),
        presetRepo.list(),
      ]);
      set({ items: sort(items), folders, presets, loaded: true });
    },

    async create(input) {
      const conversation = await repo.create(input);
      set((s) => ({ items: sort([conversation, ...s.items]) }));
      return conversation;
    },

    update,
    rename: (id, title) => update(id, { title }),
    async togglePin(id) {
      const current = get().items.find((c) => c.id === id);
      if (current) await update(id, { pinned: !current.pinned });
    },
    setArchived: (id, archived) => update(id, { archived, pinned: false }),
    setModel: (id, model) => update(id, { model }),
    setSystemPrompt: (id, systemPrompt) => update(id, { systemPrompt }),
    moveToFolder: (id, folderId) => update(id, { folderId }),

    async remove(id) {
      await repo.remove(id);
      set((s) => ({ items: s.items.filter((c) => c.id !== id) }));
    },

    async removeArchived() {
      const count = await repo.removeArchived();
      set((s) => ({ items: s.items.filter((c) => !c.archived) }));
      return count;
    },

    touched: (id, at) =>
      set((s) => ({
        items: sort(s.items.map((c) => (c.id === id ? { ...c, updatedAt: at } : c))),
      })),

    async createFolder(name) {
      const folder = await folderRepo.create(name);
      set((s) => ({ folders: [...s.folders, folder] }));
      return folder;
    },
    async renameFolder(id, name) {
      await folderRepo.rename(id, name);
      set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) }));
    },
    async removeFolder(id) {
      await folderRepo.remove(id);
      set((s) => ({
        folders: s.folders.filter((f) => f.id !== id),
        items: s.items.map((c) => (c.folderId === id ? { ...c, folderId: null } : c)),
      }));
    },

    async savePreset(preset) {
      const saved = await presetRepo.save(preset);
      set((s) => ({
        presets: s.presets.some((p) => p.id === saved.id)
          ? s.presets.map((p) => (p.id === saved.id ? saved : p))
          : [...s.presets, saved],
      }));
      return saved;
    },
    async removePreset(id) {
      await presetRepo.remove(id);
      set((s) => ({
        presets: s.presets.filter((p) => p.id !== id),
        items: s.items.map((c) => (c.presetId === id ? { ...c, presetId: null } : c)),
      }));
    },
  };
});
