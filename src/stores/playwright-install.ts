/**
 * Installation de Playwright depuis les Paramètres : état du dialogue de progression (étape en
 * cours, lignes de sortie, résultat). Dans un store plutôt que dans le composant pour qu'un
 * remontage (navigation, StrictMode) ne relance jamais l'installation.
 */
import { create } from 'zustand';
import { agentCommands, environmentCommands, type InstallEvent } from '@/lib/agent/commands';
import { errorMessage } from '@/lib/tauri';
import { useEnvironment } from './environment';

export type InstallStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timedOut'
  /** Refus ou erreur avant même la première étape (ni Python ni Node, commande injoignable). */
  | 'error';

export interface InstallLine {
  text: string;
  stderr: boolean;
  /** Ligne `$ commande` ajoutée au début de chaque étape. */
  command?: boolean;
}

interface PlaywrightInstallState {
  status: InstallStatus;
  step: { index: number; total: number; command: string } | null;
  lines: InstallLine[];
  exitCode: number | null;
  error: string | null;
  id: string | null;
  start: () => void;
  cancel: () => void;
  /** Ferme le dialogue (sans effet pendant l'installation). */
  reset: () => void;
}

/** Lignes conservées à l'écran (les plus récentes). */
export const MAX_INSTALL_LINES = 400;

const initial = {
  status: 'idle' as InstallStatus,
  step: null,
  lines: [],
  exitCode: null,
  error: null,
  id: null,
};

export const usePlaywrightInstall = create<PlaywrightInstallState>()((set, get) => ({
  ...initial,

  start() {
    if (get().status === 'running') return;
    const id = crypto.randomUUID();
    set({ ...initial, status: 'running', id });
    const append = (line: InstallLine) =>
      set((s) => ({ lines: [...s.lines, line].slice(-MAX_INSTALL_LINES) }));
    const onEvent = (event: InstallEvent) => {
      if (get().id !== id) return;
      switch (event.type) {
        case 'step':
          set({ step: { index: event.index, total: event.total, command: event.command } });
          append({ text: `$ ${event.command}`, stderr: false, command: true });
          break;
        case 'line':
          append({ text: event.text, stderr: event.stderr });
          break;
        case 'done':
          set({
            exitCode: event.exitCode,
            status: event.success
              ? 'success'
              : event.cancelled
                ? 'cancelled'
                : event.timedOut
                  ? 'timedOut'
                  : 'failed',
          });
          break;
      }
    };
    environmentCommands
      .installPlaywright(id, onEvent)
      .then(() => {
        // Le cache Rust est vidé par la commande : on relit l'environnement pour la section.
        void useEnvironment.getState().ensure(null, true);
      })
      .catch((error: unknown) => {
        if (get().id === id) set({ status: 'error', error: errorMessage(error) });
      });
  },

  cancel() {
    const { id, status } = get();
    if (id && status === 'running') void agentCommands.cancelTool(id).catch(console.error);
  },

  reset() {
    if (get().status !== 'running') set({ ...initial });
  },
}));
