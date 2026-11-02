/**
 * État du mode agent : approbations en attente (cartes « Autoriser / Refuser »), autorisations
 * mémorisées par conversation, compteur d'étapes, arrêt demandé par l'utilisateur et cache du
 * contexte de projet lu par `buildHistory` (`src/lib/chat-service.ts`) de façon synchrone.
 */
import { create } from 'zustand';
import type { WorkspaceInfo } from '@/lib/agent/commands';
import { buildProjectContext, type ProjectContext } from '@/lib/agent/context';
import type { Decision, ToolRisk } from '@/lib/agent/types';
import { useSettings } from './settings';

export interface ProjectContextEntry extends ProjectContext {
  builtAt: number;
}

/** Durée de validité du contexte de projet avant reconstruction automatique. */
export const PROJECT_CONTEXT_TTL_MS = 60 * 60 * 1000;

export interface PendingApproval {
  toolMessageId: string;
  conversationId: string;
  resolve: (decision: Decision) => void;
}

interface AgentState {
  pending: PendingApproval[];
  /** Clés « toujours autoriser » par conversation (nom d'outil ou `cmd:<programme>`). */
  allowed: Record<string, string[]>;
  /** Étapes (appels d'outils) consommées dans le tour utilisateur en cours, par conversation. */
  steps: Record<string, number>;
  /** Identifiant de l'outil en cours d'exécution côté Rust (pour l'annuler). */
  runningToolId: string | null;
  aborted: boolean;
  /** Dossiers enregistrés côté Rust pendant cette session, par conversation (nom, dépôt Git). */
  workspaces: Record<string, WorkspaceInfo>;
  /** Contexte de projet par conversation ; invalide si le dossier a changé ou après une heure. */
  projectContext: Record<string, ProjectContextEntry>;

  rememberWorkspace: (conversationId: string, info: WorkspaceInfo) => void;
  /** Construit (ou reconstruit) le contexte si absent, périmé, d'un autre dossier ou si `force`. */
  ensureProjectContext: (
    conversationId: string,
    workspace: string,
    force?: boolean,
  ) => Promise<void>;
  invalidateProjectContext: (conversationId: string) => void;
  /** Décide selon la politique et les autorisations mémorisées, sinon attend la carte. */
  requestDecision: (input: {
    conversationId: string;
    toolMessageId: string;
    risk: ToolRisk;
    key: string;
  }) => Promise<Decision>;
  decide: (toolMessageId: string, decision: Decision) => void;
  startTurn: (conversationId: string) => void;
  bumpSteps: (conversationId: string) => number;
  setRunning: (id: string | null) => void;
  /** Arrêt demandé : refuse les approbations en attente et marque le tour comme interrompu. */
  abort: () => void;
}

/** Constructions en cours, pour ne pas lire deux fois le même dossier en parallèle. */
const building = new Map<string, Promise<void>>();

const emptyContext = (workspace: string): ProjectContext => ({
  workspace,
  text: '',
  instructionsFile: null,
  packageManager: null,
  git: false,
  tokens: 0,
});

/** Texte du contexte de projet à injecter, ou `null` s'il manque ou vise un autre dossier. */
export function projectContextOf(conversationId: string, workspace: string): string | null {
  const entry = useAgent.getState().projectContext[conversationId];
  return entry && entry.workspace === workspace && entry.text ? entry.text : null;
}

export const useAgent = create<AgentState>()((set, get) => ({
  pending: [],
  allowed: {},
  steps: {},
  runningToolId: null,
  aborted: false,
  workspaces: {},
  projectContext: {},

  rememberWorkspace: (conversationId, info) =>
    set((s) => ({ workspaces: { ...s.workspaces, [conversationId]: info } })),

  async ensureProjectContext(conversationId, workspace, force = false) {
    const current = get().projectContext[conversationId];
    const fresh =
      current?.workspace === workspace && Date.now() - current.builtAt < PROJECT_CONTEXT_TTL_MS;
    if (fresh && !force) return;
    const key = `${conversationId}\n${workspace}`;
    const inFlight = building.get(key);
    if (inFlight && !force) return inFlight;
    const task = buildProjectContext(workspace)
      .catch((error: unknown) => {
        console.warn('project context unavailable', error);
        return emptyContext(workspace);
      })
      .then((context) => {
        set((s) => ({
          projectContext: {
            ...s.projectContext,
            [conversationId]: { ...context, builtAt: Date.now() },
          },
        }));
      })
      .finally(() => {
        if (building.get(key) === task) building.delete(key);
      });
    building.set(key, task);
    return task;
  },

  invalidateProjectContext: (conversationId) =>
    set((s) => {
      const { [conversationId]: _, ...rest } = s.projectContext;
      return { projectContext: rest };
    }),

  requestDecision({ conversationId, toolMessageId, risk, key }) {
    const policy = useSettings.getState().agentApproval;
    if (policy === 'autoAll') return Promise.resolve('allow');
    if (policy === 'autoRead' && risk === 'read') return Promise.resolve('allow');
    if (get().allowed[conversationId]?.includes(key)) return Promise.resolve('allow');
    return new Promise<Decision>((resolve) => {
      set((s) => ({
        pending: [
          ...s.pending,
          {
            toolMessageId,
            conversationId,
            resolve: (decision) => {
              if (decision === 'allowAlways') {
                set((state) => ({
                  allowed: {
                    ...state.allowed,
                    [conversationId]: [...(state.allowed[conversationId] ?? []), key],
                  },
                }));
              }
              resolve(decision);
            },
          },
        ],
      }));
    });
  },

  decide(toolMessageId, decision) {
    const entry = get().pending.find((p) => p.toolMessageId === toolMessageId);
    if (!entry) return;
    set((s) => ({ pending: s.pending.filter((p) => p.toolMessageId !== toolMessageId) }));
    entry.resolve(decision);
  },

  startTurn: (conversationId) =>
    set((s) => ({ steps: { ...s.steps, [conversationId]: 0 }, aborted: false })),

  bumpSteps(conversationId) {
    const next = (get().steps[conversationId] ?? 0) + 1;
    set((s) => ({ steps: { ...s.steps, [conversationId]: next } }));
    return next;
  },

  setRunning: (id) => set({ runningToolId: id }),

  abort() {
    const { pending } = get();
    set({ pending: [], aborted: true });
    for (const p of pending) p.resolve('deny');
  },
}));
