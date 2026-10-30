/**
 * Internationalisation (react-i18next).
 *
 * La langue initiale est déterminée de façon synchrone (préférence mémorisée,
 * sinon langue du système) pour éviter un rendu dans la mauvaise langue.
 * Le hook `useLanguage` la met ensuite à jour et en informe Rust (menus, tray).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

export const languages = ['en', 'fr'] as const;
export type Language = (typeof languages)[number];
export type LanguageSetting = Language | 'system';

export const LANGUAGE_BOOT_KEY = 'language-boot';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (languages as readonly string[]).includes(value);
}

/** Langue du système (ex. `fr-FR` → `fr`), ou anglais par défaut. */
export function systemLanguage(): Language {
  const tag = typeof navigator === 'undefined' ? 'en' : navigator.language;
  const base = tag.slice(0, 2).toLowerCase();
  return isLanguage(base) ? base : 'en';
}

export function resolveLanguage(setting: LanguageSetting): Language {
  return setting === 'system' ? systemLanguage() : setting;
}

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_BOOT_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // stockage indisponible
  }
  return systemLanguage();
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
