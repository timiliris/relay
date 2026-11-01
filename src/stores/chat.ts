/**
 * État de la conversation ouverte : tous les messages (toutes versions), le chemin
 * actif affiché et le flux en cours. La logique d'envoi vit dans `src/lib/chat-service.ts`.
 */
import { create } from 'zustand';
import { type Attachment, type Message, messages as repo } from '@/lib/db';
import { devFixturesEnabled, sampleMessages } from '@/lib/dev-fixtures';
import { isTauri } from '@/lib/tauri';
import { activePath } from '@/lib/tree';

export interface StreamState {
  conversationId: string;
  requestId: string;
  /** Message assistant en cours d'écriture (déjà présent dans `all`). */
  messageId: string;
  startedAt: number;
  /** Tokens reçus (approximation : fragments) pour l'indicateur de débit. */
  chunks: number;
}

interface ChatState {
  conversationId: string | null;
  all: Message[];
  messages: Message[];
  loading: boolean;
  stream: StreamState | null;
  error: string | null;
  open: (conversationId: string | null) => Promise<void>;
  reload: () => Promise<void>;
  setAll: (all: Message[]) => void;
  upsert: (message: Message) => void;
  removeMany: (ids: string[]) => void;
  beginStream: (conversationId: string, requestId: string, messageId: string) => void;
  appendDelta: (messageId: string, content: string) => void;
  appendReasoning: (messageId: string, content: string) => void;
  /** Ajoute une image générée (ou autre pièce jointe) au message en cours d'écriture. */
  appendAttachment: (messageId: string, attachment: Attachment) => void;
  endStream: (error: string | null) => void;
  setError: (error: string | null) => void;
}

const withPath = (all: Message[]) => ({ all, messages: activePath(all) });

export const useChat = create<ChatState>()((set, get) => ({
  conversationId: null,
  all: [],
  messages: [],
  loading: false,
  stream: null,
  error: null,

  async open(conversationId) {
    set({ conversationId, all: [], messages: [], error: null, loading: conversationId !== null });
    if (!conversationId || !isTauri()) {
      const demo =
        conversationId && devFixturesEnabled() ? (sampleMessages[conversationId] ?? []) : [];
      set({ ...withPath(demo), loading: false });
      return;
    }
    const all = await repo.list(conversationId);
    // L'utilisateur a pu changer de conversation pendant le chargement.
    if (get().conversationId === conversationId) set({ ...withPath(all), loading: false });
  },

  async reload() {
    const id = get().conversationId;
    if (!id || !isTauri()) return;
    const all = await repo.list(id);
    if (get().conversationId === id) set(withPath(all));
  },

  setAll: (all) => set(withPath(all)),

  upsert: (message) =>
    set((s) => {
      if (s.conversationId !== message.conversationId) return {};
      const exists = s.all.some((m) => m.id === message.id);
      const all = exists
        ? s.all.map((m) => (m.id === message.id ? message : m))
        : [
            // Le nouveau message devient actif parmi ses frères.
            ...s.all.map((m) => (m.parentId === message.parentId ? { ...m, active: false } : m)),
            { ...message, active: true },
          ];
      return withPath(all);
    }),

  removeMany: (ids) => set((s) => withPath(s.all.filter((m) => !ids.includes(m.id)))),

  beginStream: (conversationId, requestId, messageId) =>
    set({
      stream: { conversationId, requestId, messageId, startedAt: Date.now(), chunks: 0 },
      error: null,
    }),

  appendDelta: (messageId, content) =>
    set((s) => ({
      ...withPath(
        s.all.map((m) => (m.id === messageId ? { ...m, content: m.content + content } : m)),
      ),
      stream: s.stream ? { ...s.stream, chunks: s.stream.chunks + 1 } : null,
    })),

  appendReasoning: (messageId, content) =>
    set((s) =>
      withPath(
        s.all.map((m) =>
          m.id === messageId ? { ...m, reasoning: (m.reasoning ?? '') + content } : m,
        ),
      ),
    ),

  appendAttachment: (messageId, attachment) =>
    set((s) =>
      withPath(
        s.all.map((m) =>
          m.id === messageId ? { ...m, attachments: [...m.attachments, attachment] } : m,
        ),
      ),
    ),

  endStream: (error) => set({ stream: null, error }),
  setError: (error) => set({ error }),
}));
