/**
 * Préférences utilisateur, persistées :
 * - dans Tauri : fichier `settings.json` du dossier app-data (tauri-plugin-store) ;
 * - dans un navigateur (dev UI pur, tests) : localStorage.
 */
import { LazyStore } from '@tauri-apps/plugin-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { LanguageSetting } from '@/i18n';
import { isTauri } from '@/lib/tauri';

export type Theme = 'light' | 'dark' | 'system';

/** Paramètres de génération par défaut, repris par chaque nouvelle conversation. */
export interface GenerationParams {
  temperature: number;
  maxTokens: number | null;
  topP: number | null;
  systemPrompt: string;
  reasoning: boolean;
}

export const DEFAULT_MODEL = 'openrouter/auto';

export const defaultGeneration: GenerationParams = {
  temperature: 0.7,
  maxTokens: null,
  topP: null,
  systemPrompt: '',
  reasoning: true,
};

export interface SettingsState extends GenerationParams {
  theme: Theme;
  language: LanguageSetting;
  defaultModel: string;
  favoriteModels: string[];
  recentModels: string[];
  notifyOnComplete: boolean;
  autoTitle: boolean;
  sidebarCollapsed: boolean;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: LanguageSetting) => void;
  patch: (
    values: Partial<
      Omit<SettingsState, 'patch' | 'setTheme' | 'setLanguage' | 'toggleFavorite' | 'rememberModel'>
    >,
  ) => void;
  toggleFavorite: (modelId: string) => void;
  rememberModel: (modelId: string) => void;
}

function tauriStorage(): StateStorage {
  const store = new LazyStore('settings.json');
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

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      language: 'system',
      defaultModel: DEFAULT_MODEL,
      favoriteModels: [],
      recentModels: [],
      notifyOnComplete: true,
      autoTitle: true,
      sidebarCollapsed: false,
      ...defaultGeneration,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      patch: (values) => set(values),
      toggleFavorite: (modelId) =>
        set((s) => ({
          favoriteModels: s.favoriteModels.includes(modelId)
            ? s.favoriteModels.filter((id) => id !== modelId)
            : [...s.favoriteModels, modelId],
        })),
      rememberModel: (modelId) =>
        set((s) => ({
          recentModels: [modelId, ...s.recentModels.filter((id) => id !== modelId)].slice(0, 5),
        })),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => (isTauri() ? tauriStorage() : localStorage)),
      partialize: ({ setTheme, setLanguage, patch, toggleFavorite, rememberModel, ...state }) =>
        state,
    },
  ),
);
