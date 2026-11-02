/**
 * État du mode agent : approbations en attente (cartes « Autoriser / Refuser »), autorisations
 * mémorisées par conversation, compteur d'étapes et arrêt demandé par l'utilisateur.
 */
import { create } from 'zustand';
import type { WorkspaceInfo } from '@/lib/agent/commands';
import type { Decision, ToolRisk } from '@/lib/agent/types';
import { useSettings } from './settings';

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

  rememberWorkspace: (conversationId: string, info: WorkspaceInfo) => void;
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

export const useAgent = create<AgentState>()((set, get) => ({
  pending: [],
  allowed: {},
  steps: {},
  runningToolId: null,
  aborted: false,
  workspaces: {},

  rememberWorkspace: (conversationId, info) =>
    set((s) => ({ workspaces: { ...s.workspaces, [conversationId]: info } })),

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
