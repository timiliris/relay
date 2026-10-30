/** Présence de la clé API (indice masqué), rafraîchie après chaque modification. */
import { create } from 'zustand';
import { openrouter } from '@/lib/openrouter';
import { isTauri } from '@/lib/tauri';

interface ApiKeyState {
  /** `undefined` tant que non vérifié, `null` si aucune clé. */
  hint: string | null | undefined;
  refresh: () => Promise<void>;
  save: (key: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const useApiKey = create<ApiKeyState>()((set) => ({
  hint: undefined,
  async refresh() {
    if (!isTauri()) {
      set({ hint: null });
      return;
    }
    set({ hint: await openrouter.getApiKeyHint() });
  },
  async save(key) {
    set({ hint: await openrouter.setApiKey(key) });
  },
  async clear() {
    await openrouter.clearApiKey();
    set({ hint: null });
  },
}));
