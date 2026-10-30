import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { isTauri } from '@/lib/tauri';
import { type Theme, useSettings } from '@/stores/settings';

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return darkQuery().matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;

  // Lu par le script inline de index.html pour éviter un flash au prochain lancement.
  try {
    localStorage.setItem('theme-boot', theme);
  } catch {
    // stockage indisponible : on ignore
  }

  // Aligne la barre de titre native (Windows / macOS) sur le thème de l'app.
  if (isTauri()) {
    getCurrentWindow()
      .setTheme(theme === 'system' ? null : theme)
      .catch(() => {});
  }
}

/** Applique le thème courant au document et suit les changements du système. */
export function useTheme() {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;

    const media = darkQuery();
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  return { theme, setTheme, resolved: resolveTheme(theme) };
}
