/**
 * État du mode agent : approbations en attente (cartes « Autoriser / Refuser »), autorisations
 * mémorisées par conversation, compteur d'étapes, progression de la boucle et arrêt demandé par
 * l'utilisateur.
 */
import { create } from 'zustand';
import type { WorkspaceInfo } from '@/lib/agent/commands';
import type { AgentProgress, Decision, DecisionResult, ToolRisk } from '@/lib/agent/types';
import { useSettings } from './settings';

export interface PendingApproval {
  toolMessageId: string;
  conversationId: string;
  resolve: (result: DecisionResult) => void;
}

interface DecisionInput {
  conversationId: string;
  toolMessageId: string;
  risk: ToolRisk;
  key: string;
}

interface AgentState {
  pending: PendingApproval[];
  /** Clés « toujours autoriser » par conversation (nom d'outil ou `cmd:<programme>`). */
  allowed: Record<string, string[]>;
  /** Étapes (appels d'outils) consommées dans le tour utilisateur en cours, par conversation. */
  steps: Record<string, number>;
  /** Identifiant de l'outil en cours d'exécution côté Rust (pour l'annuler). */
  runningToolId: string | null;
  /** Boucle d'agent en cours (étape, phase, outil concerné), `null` au repos. */
  running: AgentProgress | null;
  aborted: boolean;
  /** Dossiers enregistrés côté Rust pendant cette session, par conversation (nom, dépôt Git). */
  workspaces: Record<string, WorkspaceInfo>;

  rememberWorkspace: (conversationId: string, info: WorkspaceInfo) => void;
  /** `true` si la politique et les autorisations mémorisées ne tranchent pas : la carte sera affichée. */
  willAsk: (input: Omit<DecisionInput, 'toolMessageId'>) => boolean;
  /** Décide selon la politique et les autorisations mémorisées, sinon attend la carte. */
  requestDecision: (input: DecisionInput) => Promise<DecisionResult>;
  /** Réponse de l'utilisateur ; `reason` (refus) est transmis au modèle pour qu'il corrige le tir. */
  decide: (toolMessageId: string, decision: Decision, reason?: string) => void;
  startTurn: (conversationId: string) => void;
  bumpSteps: (conversationId: string) => number;
  setRunning: (id: string | null) => void;
  setProgress: (progress: AgentProgress | null) => void;
  /** Arrêt demandé : refuse les approbations en attente et marque le tour comme interrompu. */
  abort: () => void;
}

export const useAgent = create<AgentState>()((set, get) => ({
  pending: [],
  allowed: {},
  steps: {},
  runningToolId: null,
  running: null,
  aborted: false,
  workspaces: {},

  rememberWorkspace: (conversationId, info) =>
    set((s) => ({ workspaces: { ...s.workspaces, [conversationId]: info } })),

  willAsk({ conversationId, risk, key }) {
    const policy = useSettings.getState().agentApproval;
    if (policy === 'autoAll') return false;
    if (policy === 'autoRead' && risk === 'read') return false;
    return !get().allowed[conversationId]?.includes(key);
  },

  requestDecision({ conversationId, toolMessageId, risk, key }) {
    if (!get().willAsk({ conversationId, risk, key })) {
      return Promise.resolve({ decision: 'allow' });
    }
    return new Promise<DecisionResult>((resolve) => {
      set((s) => ({
        pending: [
          ...s.pending,
          {
            toolMessageId,
            conversationId,
            resolve: (result) => {
              if (result.decision === 'allowAlways') {
                set((state) => ({
                  allowed: {
                    ...state.allowed,
                    [conversationId]: [...(state.allowed[conversationId] ?? []), key],
                  },
                }));
              }
              resolve(result);
            },
          },
        ],
      }));
    });
  },

  decide(toolMessageId, decision, reason) {
    const entry = get().pending.find((p) => p.toolMessageId === toolMessageId);
    if (!entry) return;
    set((s) => ({ pending: s.pending.filter((p) => p.toolMessageId !== toolMessageId) }));
    const trimmed = reason?.trim();
    entry.resolve(decision === 'deny' && trimmed ? { decision, reason: trimmed } : { decision });
  },

  startTurn: (conversationId) =>
    set((s) => ({ steps: { ...s.steps, [conversationId]: 0 }, aborted: false, running: null })),

  bumpSteps(conversationId) {
    const next = (get().steps[conversationId] ?? 0) + 1;
    set((s) => ({ steps: { ...s.steps, [conversationId]: next } }));
    return next;
  },

  setRunning: (id) => set({ runningToolId: id }),

  setProgress: (progress) => set({ running: progress }),

  abort() {
    const { pending } = get();
    set({ pending: [], aborted: true, running: null });
    for (const p of pending) p.resolve({ decision: 'deny' });
  },
}));
