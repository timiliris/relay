/**
 * État de la conversation ouverte : messages chargés et flux en cours.
 * La logique d'envoi vit dans `src/lib/chat-service.ts`.
 */
import { create } from 'zustand';
import { type Message, messages as repo } from '@/lib/db';
import { isTauri } from '@/lib/tauri';

export interface StreamState {
  conversationId: string;
  requestId: string;
  content: string;
  reasoning: string;
  startedAt: number;
}

interface ChatState {
  conversationId: string | null;
  messages: Message[];
  loading: boolean;
  stream: StreamState | null;
  error: string | null;
  open: (conversationId: string | null) => Promise<void>;
  addMessage: (message: Message) => void;
  removeMessage: (id: string) => void;
  beginStream: (conversationId: string, requestId: string) => void;
  appendDelta: (content: string) => void;
  appendReasoning: (content: string) => void;
  endStream: (error: string | null) => void;
  clearError: () => void;
}

export const useChat = create<ChatState>()((set, get) => ({
  conversationId: null,
  messages: [],
  loading: false,
  stream: null,
  error: null,

  async open(conversationId) {
    set({ conversationId, messages: [], error: null, loading: conversationId !== null });
    if (!conversationId || !isTauri()) {
      set({ loading: false });
      return;
    }
    const messages = await repo.list(conversationId);
    // L'utilisateur a pu changer de conversation pendant le chargement.
    if (get().conversationId === conversationId) set({ messages, loading: false });
  },

  addMessage: (message) =>
    set((s) =>
      s.conversationId === message.conversationId ? { messages: [...s.messages, message] } : {},
    ),
  removeMessage: (id) => set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),

  beginStream: (conversationId, requestId) =>
    set({
      stream: { conversationId, requestId, content: '', reasoning: '', startedAt: Date.now() },
      error: null,
    }),
  appendDelta: (content) =>
    set((s) => (s.stream ? { stream: { ...s.stream, content: s.stream.content + content } } : {})),
  appendReasoning: (content) =>
    set((s) =>
      s.stream ? { stream: { ...s.stream, reasoning: s.stream.reasoning + content } } : {},
    ),
  endStream: (error) => set({ stream: null, error }),
  clearError: () => set({ error: null }),
}));
