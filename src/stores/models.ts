/**
 * Catalogue des modèles OpenRouter, mis en cache localement (la liste est publique
 * et volumineuse : on la rafraîchit au plus toutes les 6 h ou à la demande).
 */
import { LazyStore } from '@tauri-apps/plugin-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { type ModelInfo, openrouter } from '@/lib/openrouter';
import { errorMessage, isTauri } from '@/lib/tauri';

const TTL = 6 * 60 * 60 * 1000;

interface ModelsState {
  models: ModelInfo[];
  fetchedAt: number | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  load: (force?: boolean) => Promise<void>;
  byId: (id: string) => ModelInfo | undefined;
}

function tauriStorage(): StateStorage {
  const store = new LazyStore('models-cache.json');
  return {
    getItem: async (name) => (await store.get<string>(name)) ?? null,
    setItem: async (name, value) => {
      await store.set(name, value);
      await store.save();
    },
    removeItem: async (name) => {
      await store.delete(name);
      await store.save();
    },
  };
}

export const useModels = create<ModelsState>()(
  persist(
    (set, get) => ({
      models: [],
      fetchedAt: null,
      status: 'idle',
      error: null,
      async load(force = false) {
        const { fetchedAt, status } = get();
        if (status === 'loading') return;
        if (!force && fetchedAt && Date.now() - fetchedAt < TTL && get().models.length > 0) {
          set({ status: 'ready' });
          return;
        }
        if (!isTauri()) return;
        set({ status: 'loading', error: null });
        try {
          const models = (await openrouter.fetchModels()).sort((a, b) =>
            a.name.localeCompare(b.name),
          );
          set({ models, fetchedAt: Date.now(), status: 'ready' });
        } catch (err) {
          set({ status: get().models.length > 0 ? 'ready' : 'error', error: errorMessage(err) });
        }
      },
      byId: (id) => get().models.find((m) => m.id === id),
    }),
    {
      name: 'models',
      storage: createJSONStorage(() => (isTauri() ? tauriStorage() : localStorage)),
      partialize: (s) => ({ models: s.models, fetchedAt: s.fetchedAt }),
    },
  ),
);
