import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauri } from './tauri';

/** Ouvre un lien dans le navigateur système (opener) ou un nouvel onglet hors Tauri. */
export function openExternal(href: string): void {
  if (isTauri()) {
    openUrl(href).catch(console.error);
  } else {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}
