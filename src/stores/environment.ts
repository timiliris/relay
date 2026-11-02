/**
 * Relevé de l'environnement du poste (outils installés, Playwright), partagé entre la section
 * Développement des Paramètres et `buildHistory` (lecture synchrone via `environmentBlockOf`).
 * Rust garde son propre cache pour la session ; ici on évite seulement les relevés simultanés.
 */
import { create } from 'zustand';
import { type Environment, environmentCommands } from '@/lib/agent/commands';
import { formatEnvironmentBlock } from '@/lib/agent/environment';
import { errorMessage, isTauri } from '@/lib/tauri';

interface EnvironmentState {
  environment: Environment | null;
  /** Dossier de travail du dernier relevé (la détection d'un Playwright npm local en dépend). */
  workspace: string | null;
  loading: boolean;
  error: string | null;
  /** Relevé si absent, fait pour un autre dossier ou `force` ; renvoie l'environnement connu. */
  ensure: (workspace?: string | null, force?: boolean) => Promise<Environment | null>;
}

let inFlight: Promise<Environment | null> | null = null;

/** Bloc à injecter dans l'instruction système, ou `null` sans relevé. */
export function environmentBlockOf(): string | null {
  const env = useEnvironment.getState().environment;
  return env ? formatEnvironmentBlock(env) : null;
}

export const useEnvironment = create<EnvironmentState>()((set, get) => ({
  environment: null,
  workspace: null,
  loading: false,
  error: null,

  ensure(workspace = null, force = false) {
    const { environment, workspace: known } = get();
    if (environment && known === workspace && !force) return Promise.resolve(environment);
    if (inFlight && !force) return inFlight;
    if (!isTauri()) return Promise.resolve(null);
    set({ loading: true, error: null });
    const task = environmentCommands
      .detect(workspace, force)
      .then((env) => {
        set({ environment: env, workspace, loading: false });
        return env;
      })
      .catch((error: unknown) => {
        console.warn('environment unavailable', error);
        set({ loading: false, error: errorMessage(error) });
        return get().environment;
      })
      .finally(() => {
        if (inFlight === task) inFlight = null;
      });
    inFlight = task;
    return task;
  },
}));
