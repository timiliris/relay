/**
 * Initialisation spécifique au runtime Tauri : logs, affichage de la fenêtre,
 * événements du menu natif, comportements « natifs » et mises à jour.
 */
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { attachConsole, info } from '@tauri-apps/plugin-log';
import { commands, isTauri } from './tauri';
import { checkForUpdates } from './updater';

export async function bootstrap(): Promise<void> {
  if (!isTauri()) return;

  // Relaie les logs Rust dans la console du webview (pratique en dev).
  await attachConsole();
  info('Frontend monté');

  // Actions du menu natif / du tray qui concernent le frontend (voir src-tauri/src/menu.rs).
  await listen('menu://check-updates', () => void checkForUpdates());

  // La fenêtre est créée invisible (`visible: false`) : on l'affiche une fois le
  // premier rendu effectué pour éviter un écran blanc, sauf au démarrage automatique
  // (`--minimized`) où elle reste dans la zone de notification.
  const hidden = await commands.shouldStartHidden().catch(() => false);
  if (!hidden) {
    requestAnimationFrame(() => {
      getCurrentWindow()
        .show()
        .then(() => getCurrentWindow().setFocus())
        .catch(() => {});
    });
  }

  if (import.meta.env.PROD) {
    // Pas de menu contextuel « page web » ni de raccourcis navigateur en production.
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      const reload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r');
      const devtools = e.key === 'F12';
      if (reload || devtools) e.preventDefault();
    });

    // Vérification silencieuse des mises à jour quelques secondes après le lancement.
    setTimeout(() => void checkForUpdates({ silent: true }), 3000);
  }
}
