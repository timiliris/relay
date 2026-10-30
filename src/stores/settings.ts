/**
 * Préférences utilisateur, persistées :
 * - dans Tauri : fichier `settings.json` du dossier app-data (tauri-plugin-store) ;
 * - dans un navigateur (dev UI pur, tests) : localStorage.
 */
import { LazyStore } from '@tauri-apps/plugin-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { LanguageSetting } from '@/i18n';
import type { ProviderSort } from '@/lib/openrouter';
import { isTauri } from '@/lib/tauri';

export type Theme = 'light' | 'dark' | 'system';
export type FontSize = 'sm' | 'md' | 'lg';
export type Accent = 'neutral' | 'violet' | 'blue' | 'green' | 'amber' | 'rose';
export type Density = 'comfortable' | 'compact';

/** Paramètres de génération par défaut, repris par chaque nouvelle conversation. */
export interface GenerationParams {
  temperature: number;
  maxTokens: number | null;
  topP: number | null;
  systemPrompt: string;
  reasoning: boolean;
  webSearch: boolean;
}

export const DEFAULT_MODEL = 'openrouter/auto';

export const defaultGeneration: GenerationParams = {
  temperature: 0.7,
  maxTokens: null,
  topP: null,
  systemPrompt: '',
  reasoning: true,
  webSearch: false,
};

export interface SettingsData extends GenerationParams {
  theme: Theme;
  language: LanguageSetting;
  defaultModel: string;
  favoriteModels: string[];
  recentModels: string[];
  notifyOnComplete: boolean;
  autoTitle: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  showArchived: boolean;
  /** Options de routage OpenRouter. */
  providerSort: ProviderSort | null;
  ignoreProviders: string[];
  dataCollectionDeny: boolean;
  /** Apparence. */
  fontSize: FontSize;
  accent: Accent;
  density: Density;
  /** Nombre de messages rendus avant le bouton « afficher les précédents ». */
  messagesPageSize: number;
  onboarded: boolean;
}

export interface SettingsState extends SettingsData {
  setTheme: (theme: Theme) => void;
  setLanguage: (language: LanguageSetting) => void;
  patch: (values: Partial<SettingsData>) => void;
  toggleFavorite: (modelId: string) => void;
  rememberModel: (modelId: string) => void;
}

const defaults: SettingsData = {
  theme: 'system',
  language: 'system',
  defaultModel: DEFAULT_MODEL,
  favoriteModels: [],
  recentModels: [],
  notifyOnComplete: true,
  autoTitle: true,
  sidebarCollapsed: false,
  sidebarWidth: 264,
  showArchived: false,
  providerSort: null,
  ignoreProviders: [],
  dataCollectionDeny: false,
  fontSize: 'md',
  accent: 'neutral',
  density: 'comfortable',
  messagesPageSize: 60,
  onboarded: false,
  ...defaultGeneration,
};

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
      ...defaults,
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
      version: 2,
      storage: createJSONStorage(() => (isTauri() ? tauriStorage() : localStorage)),
      partialize: ({ setTheme, setLanguage, patch, toggleFavorite, rememberModel, ...state }) =>
        state,
      // Les nouvelles clés prennent leur valeur par défaut pour les anciens fichiers.
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<SettingsData>) }),
    },
  ),
);
