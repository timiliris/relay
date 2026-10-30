/**
 * Orchestration d'un échange : persistance des messages, streaming de la réponse,
 * titre automatique et notification. Indépendant de React (appelé depuis les pages).
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification';
import i18n from '@/i18n';
import { useChat } from '@/stores/chat';
import { useConversations } from '@/stores/conversations';
import { useSettings } from '@/stores/settings';
import {
  type Conversation,
  conversations as convRepo,
  type Message,
  messages as msgRepo,
} from './db';
import { truncateTitle } from './format';
import { type ChatMessageInput, openrouter } from './openrouter';
import { errorMessage } from './tauri';

const emptyMeta = {
  reasoning: null,
  model: null,
  promptTokens: null,
  completionTokens: null,
  cost: null,
  finishReason: null,
};

/** Crée la conversation au premier message, avec les valeurs par défaut des paramètres. */
export async function ensureConversation(
  existing: Conversation | null,
  firstMessage: string,
): Promise<Conversation> {
  if (existing) return existing;
  const settings = useSettings.getState();
  return useConversations.getState().create({
    title: truncateTitle(firstMessage) || i18n.t('chat.untitled'),
    model: settings.defaultModel,
    systemPrompt: settings.systemPrompt.trim() || null,
  });
}

export async function sendMessage(conversation: Conversation, text: string): Promise<void> {
  const chat = useChat.getState();
  const user = await msgRepo.add({
    conversationId: conversation.id,
    role: 'user',
    content: text,
    ...emptyMeta,
  });
  chat.addMessage(user);
  const history = [...chat.messages.filter((m) => m.id !== user.id), user];
  await runAssistant(conversation, history);

  const isFirstExchange = history.filter((m) => m.role === 'user').length === 1;
  if (isFirstExchange && useSettings.getState().autoTitle) {
    void generateTitle(conversation, text);
  }
}

/** Supprime la dernière réponse et relance la génération. */
export async function regenerate(conversation: Conversation): Promise<void> {
  const chat = useChat.getState();
  const last = chat.messages.at(-1);
  if (last?.role === 'assistant') {
    await msgRepo.remove(last.id);
    chat.removeMessage(last.id);
  }
  await runAssistant(conversation, useChat.getState().messages);
}

export function stopStreaming(): void {
  const stream = useChat.getState().stream;
  if (stream) void openrouter.cancelStream(stream.requestId);
}

export async function deleteMessage(id: string): Promise<void> {
  await msgRepo.remove(id);
  useChat.getState().removeMessage(id);
}

async function runAssistant(conversation: Conversation, history: Message[]): Promise<void> {
  const settings = useSettings.getState();
  const chat = useChat.getState();
  const requestId = crypto.randomUUID();

  const input: ChatMessageInput[] = [];
  if (conversation.systemPrompt) input.push({ role: 'system', content: conversation.systemPrompt });
  for (const m of history) {
    if (m.role !== 'system') input.push({ role: m.role, content: m.content });
  }

  const acc = {
    content: '',
    reasoning: '',
    usage: null as { promptTokens: number; completionTokens: number; cost: number | null } | null,
    finishReason: null as string | null,
    error: null as string | null,
  };

  chat.beginStream(conversation.id, requestId);
  try {
    await openrouter.streamChat(
      requestId,
      {
        model: conversation.model,
        messages: input,
        temperature: settings.temperature,
        reasoning: settings.reasoning,
        ...(settings.maxTokens ? { maxTokens: settings.maxTokens } : {}),
        ...(settings.topP !== null ? { topP: settings.topP } : {}),
      },
      (event) => {
        switch (event.type) {
          case 'delta':
            acc.content += event.content;
            useChat.getState().appendDelta(event.content);
            break;
          case 'reasoning':
            acc.reasoning += event.content;
            useChat.getState().appendReasoning(event.content);
            break;
          case 'usage':
            acc.usage = event;
            break;
          case 'done':
            acc.finishReason = event.finishReason;
            break;
          case 'error':
            acc.error = event.message;
            break;
        }
      },
    );
  } catch (err) {
    acc.error = errorMessage(err);
  }

  if (acc.content || acc.reasoning) {
    const assistant = await msgRepo.add({
      conversationId: conversation.id,
      role: 'assistant',
      content: acc.content,
      reasoning: acc.reasoning || null,
      model: conversation.model,
      promptTokens: acc.usage?.promptTokens ?? null,
      completionTokens: acc.usage?.completionTokens ?? null,
      cost: acc.usage?.cost ?? null,
      finishReason: acc.finishReason,
    });
    useChat.getState().addMessage(assistant);
  }
  useChat.getState().endStream(acc.error);

  const at = await convRepo.touch(conversation.id);
  useConversations.getState().touched(conversation.id, at);
  useSettings.getState().rememberModel(conversation.model);

  if (!acc.error && settings.notifyOnComplete) {
    void notifyIfHidden(conversation.title, acc.content);
  }
}

async function generateTitle(conversation: Conversation, firstMessage: string): Promise<void> {
  try {
    const raw = await openrouter.completeChat({
      model: conversation.model,
      messages: [
        { role: 'system', content: i18n.t('chat.titlePrompt') },
        { role: 'user', content: firstMessage.slice(0, 2000) },
      ],
      temperature: 0.3,
      maxTokens: 24,
    });
    const title = truncateTitle(raw.replace(/^["'«»\s]+|["'«».\s]+$/g, ''), 60);
    if (title) await useConversations.getState().rename(conversation.id, title);
  } catch (err) {
    console.warn('titre automatique indisponible :', errorMessage(err));
  }
}

async function notifyIfHidden(title: string, body: string): Promise<void> {
  try {
    const win = getCurrentWindow();
    if ((await win.isFocused()) && (await win.isVisible())) return;
    if (!(await isPermissionGranted())) return;
    sendNotification({ title, body: truncateTitle(body, 120) });
  } catch {
    // notifications indisponibles : on ignore
  }
}
