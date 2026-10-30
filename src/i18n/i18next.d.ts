import 'i18next';
import type en from './locales/en.json';

/** Clés de traduction typées : `t('nav.chat')` est vérifié à la compilation. */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof en;
    };
  }
}
