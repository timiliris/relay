/**
 * Volet « Processus » : commandes lancées par l'agent pendant la session (premier plan et
 * arrière-plan), avec leur sortie en direct. Rust diffuse les fragments par l'événement
 * `agent://command-output` et la fin par `agent://process-exit` ; `ensureListening` s'y abonne
 * une fois. Le tampon de sortie est borné aux derniers `MAX_OUTPUT_CHARS` caractères.
 */
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import {
  agentCommands,
  COMMAND_OUTPUT_EVENT,
  type CommandOutput,
  type OutputChunk,
  PROCESS_EXIT_EVENT,
  type ProcessInfo,
  type ProcessStatus,
} from '@/lib/agent/commands';
import { isTauri } from '@/lib/tauri';

/** Caractères conservés par processus (les derniers). */
export const MAX_OUTPUT_CHARS = 64 * 1024;

export interface ProcessEntry {
  /** Identifiant de l'appel d'outil (message `tool`), partagé avec Rust. */
  id: string;
  conversationId: string;
  command: string;
  cwd: string;
  pid: number | null;
  startedAt: number;
  endedAt: number | null;
  status: ProcessStatus;
  exitCode: number | null;
  background: boolean;
  timedOut: boolean;
  /** Sortie combinée (stdout et stderr dans l'ordre d'arrivée), bornée. */
  output: string;
  truncated: boolean;
}

/** Ajoute un fragment en ne gardant que la fin du tampon. */
export function appendBounded(output: string, chunk: string): { output: string; cut: boolean } {
  const joined = output + chunk;
  if (joined.length <= MAX_OUTPUT_CHARS) return { output: joined, cut: false };
  return { output: joined.slice(joined.length - MAX_OUTPUT_CHARS), cut: true };
}

interface TrackInput {
  id: string;
  conversationId: string;
  command: string;
  cwd: string;
  background: boolean;
}

interface ProcessesState {
  open: boolean;
  items: Record<string, ProcessEntry>;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  /** Enregistre une commande qui démarre (PID encore inconnu). */
  track: (input: TrackInput) => void;
  /** Résultat de `run_command` : PID, départ, état final ou « tourne encore ». */
  settle: (id: string, out: CommandOutput) => void;
  /** Fragment reçu de Rust. */
  append: (id: string, chunk: string) => void;
  /** Fin annoncée par Rust (ou fiche relue via `stop_process` / `list_processes`). */
  sync: (info: ProcessInfo) => void;
  /** Échec avant le lancement (dossier refusé, shell absent…). */
  fail: (id: string, message: string) => void;
  /** Tue le processus côté Rust puis met la fiche à jour. */
  stop: (id: string) => Promise<void>;
  /** Oublie les processus terminés d'une conversation. */
  clearFinished: (conversationId: string) => void;
  /** Abonnement aux événements Rust (une seule fois ; sans effet hors Tauri). */
  ensureListening: () => Promise<void>;
}

let listening: Promise<void> | null = null;

export const useProcesses = create<ProcessesState>()((set, get) => {
  const patch = (id: string, f: (entry: ProcessEntry) => Partial<ProcessEntry>) =>
    set((s) => {
      const entry = s.items[id];
      return entry ? { items: { ...s.items, [id]: { ...entry, ...f(entry) } } } : {};
    });

  return {
    open: false,
    items: {},
    toggle: () => set((s) => ({ open: !s.open })),
    setOpen: (open) => set({ open }),

    track: ({ id, conversationId, command, cwd, background }) =>
      set((s) => ({
        items: {
          ...s.items,
          [id]: {
            id,
            conversationId,
            command,
            cwd,
            pid: null,
            startedAt: Date.now(),
            endedAt: null,
            status: 'running',
            exitCode: null,
            background,
            timedOut: false,
            output: '',
            truncated: false,
          },
        },
      })),

    settle: (id, out) =>
      patch(id, (entry) => ({
        pid: out.pid,
        startedAt: out.startedAt || entry.startedAt,
        background: out.background,
        // Un processus déjà signalé terminé par l'événement de fin garde son état.
        ...(entry.status === 'running' && !out.running
          ? {
              status: out.exitCode === null ? 'killed' : 'done',
              exitCode: out.exitCode,
              timedOut: out.timedOut,
              endedAt: Date.now(),
            }
          : {}),
        ...(entry.output === '' ? bounded(out) : {}),
      })),

    append: (id, chunk) =>
      patch(id, (entry) => {
        const next = appendBounded(entry.output, chunk);
        return { output: next.output, truncated: entry.truncated || next.cut };
      }),

    sync: (info) =>
      patch(info.id, () => ({
        pid: info.pid,
        startedAt: info.startedAt,
        endedAt: info.endedAt,
        status: info.status,
        exitCode: info.exitCode,
        background: info.background,
        timedOut: info.timedOut,
      })),

    fail: (id, message) =>
      patch(id, (entry) => ({
        status: 'killed',
        endedAt: Date.now(),
        output: appendBounded(entry.output, `${message}\n`).output,
      })),

    async stop(id) {
      const info = await agentCommands.stopProcess(id);
      get().sync(info);
    },

    clearFinished: (conversationId) =>
      set((s) => ({
        items: Object.fromEntries(
          Object.entries(s.items).filter(
            ([, p]) => p.conversationId !== conversationId || p.status === 'running',
          ),
        ),
      })),

    ensureListening() {
      if (!isTauri()) return Promise.resolve();
      listening ??= Promise.all([
        listen<OutputChunk>(COMMAND_OUTPUT_EVENT, (event) => {
          get().append(event.payload.id, event.payload.chunk);
        }),
        listen<ProcessInfo>(PROCESS_EXIT_EVENT, (event) => {
          get().sync(event.payload);
        }),
      ]).then(() => undefined);
      return listening;
    },
  };
});

/** Sortie initiale d'un processus dont aucun fragment n'est arrivé par événement. */
const bounded = (out: CommandOutput): Partial<ProcessEntry> => {
  const text = [out.stdout, out.stderr].filter(Boolean).join('');
  const next = appendBounded('', text);
  return { output: next.output, truncated: out.truncated || next.cut };
};

/** Processus d'une conversation, les plus récents en premier (référence stable si aucun). */
const NONE: ProcessEntry[] = [];
const cache = new WeakMap<Record<string, ProcessEntry>, Record<string, ProcessEntry[]>>();
export const selectProcesses =
  (conversationId: string | null) =>
  (s: ProcessesState): ProcessEntry[] => {
    if (!conversationId) return NONE;
    let byConversation = cache.get(s.items);
    if (!byConversation) {
      byConversation = {};
      cache.set(s.items, byConversation);
    }
    byConversation[conversationId] ??= Object.values(s.items)
      .filter((p) => p.conversationId === conversationId)
      .sort((a, b) => b.startedAt - a.startedAt);
    return byConversation[conversationId].length ? byConversation[conversationId] : NONE;
  };

export const selectRunningCount =
  (conversationId: string | null) =>
  (s: ProcessesState): number =>
    conversationId
      ? Object.values(s.items).filter(
          (p) => p.conversationId === conversationId && p.status === 'running',
        ).length
      : 0;
