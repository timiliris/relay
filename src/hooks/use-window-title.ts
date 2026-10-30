import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/lib/tauri';

/** Titre de la fenêtre native et de l'onglet : « Sujet — Relay » ou « Relay ». */
export function useWindowTitle(subject: string | null | undefined) {
  const { t } = useTranslation();
  useEffect(() => {
    const app = t('app.name');
    const title = subject ? `${subject} — ${app}` : app;
    document.title = title;
    if (isTauri())
      getCurrentWindow()
        .setTitle(title)
        .catch(() => {});
  }, [subject, t]);
}
