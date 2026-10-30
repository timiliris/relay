import { useEffect } from 'react';
import i18n, { LANGUAGE_BOOT_KEY, resolveLanguage } from '@/i18n';
import { commands, isTauri } from '@/lib/tauri';
import { useSettings } from '@/stores/settings';

/** Applique la langue choisie à l'UI, au document et à la partie Rust (menus, tray). */
export function useLanguage() {
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const resolved = resolveLanguage(language);

  useEffect(() => {
    void i18n.changeLanguage(resolved);
    document.documentElement.lang = resolved;

    try {
      localStorage.setItem(LANGUAGE_BOOT_KEY, resolved);
    } catch {
      // stockage indisponible
    }

    if (isTauri()) {
      commands.setLanguage(resolved).catch(console.error);
    }
  }, [resolved]);

  return { language, setLanguage, resolved };
}
