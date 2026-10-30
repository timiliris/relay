/**
 * Pont typé entre le frontend et les commandes Rust (`src-tauri/src/commands`).
 *
 * Toute nouvelle commande Rust doit avoir son wrapper ici : un seul endroit
 * à mettre à jour, et des types partagés dans toute l'app.
 */
import { invoke, isTauri as isTauriRuntime } from '@tauri-apps/api/core';
import i18n from '@/i18n';

/** `true` quand le code tourne dans le webview Tauri (et non dans un navigateur). */
export function isTauri(): boolean {
  return isTauriRuntime();
}

/** Forme sérialisée de `AppError` (voir `src-tauri/src/error.rs`). */
export interface AppError {
  kind: 'validation' | 'io' | 'tauri' | 'json';
  /** Code stable traduisible côté frontend (clé `errors.<code>`). */
  code: string | null;
  message: string;
}

export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    'message' in error &&
    typeof (error as AppError).message === 'string'
  );
}

/** Message lisible et traduit pour n'importe quelle erreur (AppError, Error, string…). */
export function errorMessage(error: unknown): string {
  if (isAppError(error)) {
    const key = error.code ? `errors.${error.code}` : null;
    if (key && i18n.exists(key)) return (i18n.t as (k: string) => string)(key);
    return error.message;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return i18n.t('errors.unknown');
}

/** Miroir de `SystemInfo` côté Rust (champs en camelCase via serde). */
export interface SystemInfo {
  os: string;
  osVersion: string;
  arch: string;
  hostname: string;
  locale: string | null;
  appName: string;
  appVersion: string;
  tauriVersion: string;
  debug: boolean;
}

export const commands = {
  greet: (name: string) => invoke<string>('greet', { name }),
  getSystemInfo: () => invoke<SystemInfo>('get_system_info'),
  getUptimeSecs: () => invoke<number>('get_uptime_secs'),
  /** Informe Rust de la langue active (menus natifs, tray, messages). */
  setLanguage: (lang: string) => invoke<string>('set_language', { lang }),
  /** `true` si l'app a été lancée avec `--minimized` (démarrage automatique). */
  shouldStartHidden: () => invoke<boolean>('should_start_hidden'),
  /** Affiche le menu natif en popup (bouton ≡ de la barre de titre, Windows / Linux). */
  showAppMenu: (x: number, y: number) => invoke<void>('show_app_menu', { x, y }),
} as const;
