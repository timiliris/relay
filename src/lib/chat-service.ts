/**
 * Orchestration d'un échange : persistance des messages (arbre de versions),
 * streaming de la réponse avec sauvegarde progressive, édition, régénération,
 * continuation, résumé du contexte, titre automatique et notification.
 * Indépendant de React (appelé depuis les pages).
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification';
import i18n, { resolveLanguage } from '@/i18n';
import { useChat } from '@/stores/chat';
import { useConversations } from '@/stores/conversations';
import { useModels } from '@/stores/models';
import { memoriesOf, usePersonaMemory } from '@/stores/persona-memory';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { toContentParts } from './attachments';
import {
  type Attachment,
  type Conversation,
  conversations as convRepo,
  type Message,
  messages as msgRepo,
  newId,
  type Preset,
} from './db';
import { truncateTitle } from './format';
import { imageAttachmentFromUrl, toImageParts } from './image-output';
import {
  type ChatMessageInput,
  type ChatRequest,
  openrouter,
  supportsImageOutput,
} from './openrouter';
import { buildSystemPrompt, greetingOf } from './persona';
import { formatMemoryBlock } from './persona-memory';
import { errorMessage } from './tauri';
import { activePath, siblingsOf, tail } from './tree';

/** Nombre de messages récents conservés en clair lors d'un résumé. */
const KEEP_RECENT_ON_SUMMARY = 6;
/** Intervalle de sauvegarde du texte partiel pendant le streaming. */
const PERSIST_INTERVAL_MS = 800;

const emptyAssistant = {
  reasoning: null,
  attachments: [] as Attachment[],
  promptTokens: null,
  completionTokens: null,
  cost: null,
  finishReason: null,
  durationMs: null,
};

/** Paramètres effectifs : ceux de la conversation, sinon les valeurs globales. */
export function effectiveParams(conversation: Conversation) {
  const s = useSettings.getState();
  return {
    temperature: conversation.temperature ?? s.temperature,
    topP: conversation.topP ?? s.topP,
    maxTokens: conversation.maxTokens ?? s.maxTokens,
    reasoning: conversation.reasoning ?? s.reasoning,
    webSearch: conversation.webSearch,
  };
}

/** Crée la conversation au premier message, avec les valeurs par défaut des paramètres. */
export async function ensureConversation(
  existing: Conversation | null,
  firstMessage: string,
): Promise<Conversation> {
  if (existing) return existing;
  const s = useSettings.getState();
  return useConversations.getState().create({
    title: truncateTitle(firstMessage) || i18n.t('chat.untitled'),
    model: s.defaultModel,
    systemPrompt: s.systemPrompt.trim() || null,
    webSearch: s.webSearch,
  });
}

export async function sendMessage(
  conversation: Conversation,
  text: string,
  attachments: Attachment[] = [],
): Promise<void> {
  const chat = useChat.getState();
  const parent = tail(chat.all);
  const user = await msgRepo.add({
    conversationId: conversation.id,
    parentId: parent?.id ?? null,
    role: 'user',
    content: text,
    model: null,
    ...emptyAssistant,
    attachments,
  });
  chat.upsert(user);
  await runAssistant(conversation, user.id);

  const userTurns = useChat.getState().messages.filter((m) => m.role === 'user').length;
  if (userTurns === 1 && useSettings.getState().autoTitle) void generateTitle(conversation, text);
}

/** Édite un message utilisateur : nouvelle version (frère) puis nouvelle réponse. */
export async function editMessage(
  conversation: Conversation,
  original: Message,
  text: string,
): Promise<void> {
  const edited = await msgRepo.add({
    conversationId: conversation.id,
    parentId: original.parentId,
    role: 'user',
    content: text,
    model: null,
    ...emptyAssistant,
    attachments: original.attachments,
  });
  useChat.getState().upsert(edited);
  await runAssistant(conversation, edited.id);
}

/**
 * Nouvelle réponse alternative pour le même message utilisateur. `modelOverride`
 * cible un autre modèle pour cette génération seulement (le modèle de la
 * conversation reste inchangé) : les versions sœurs gardent chacune leur modèle.
 */
export async function regenerate(
  conversation: Conversation,
  assistant: Message,
  modelOverride?: string,
): Promise<void> {
  await runAssistant(conversation, assistant.parentId, undefined, modelOverride);
}

/** Poursuit une réponse coupée (limite de tokens, arrêt, fermeture de l'app). */
export async function continueMessage(
  conversation: Conversation,
  assistant: Message,
): Promise<void> {
  await runAssistant(conversation, assistant.parentId, assistant);
}

/** Bascule vers un autre frère (version) et recharge le chemin actif. */
export async function switchVersion(message: Message, direction: 1 | -1): Promise<void> {
  const chat = useChat.getState();
  const siblings = siblingsOf(chat.all, message);
  const index = siblings.findIndex((m) => m.id === message.id);
  const target = siblings[index + direction];
  if (!target) return;
  await msgRepo.activate(message.conversationId, message.parentId, target.id);
  chat.setAll(
    chat.all.map((m) =>
      m.parentId === message.parentId && m.conversationId === message.conversationId
        ? { ...m, active: m.id === target.id }
        : m,
    ),
  );
}

export async function deleteMessage(message: Message): Promise<void> {
  const chat = useChat.getState();
  await msgRepo.removeSubtree(message.conversationId, message.id);
  await chat.reload();
}

/** Relance après une erreur : régénère la dernière réponse, ou répond au dernier message utilisateur. */
export async function retryLast(conversation: Conversation): Promise<void> {
  const last = useChat.getState().messages.at(-1);
  if (!last) return;
  if (last.role === 'assistant') await regenerate(conversation, last);
  else await runAssistant(conversation, last.id);
}

export function stopStreaming(): void {
  const stream = useChat.getState().stream;
  if (stream) void openrouter.cancelStream(stream.requestId);
}

/**
 * Remplace les anciens messages par un résumé (stocké sur la conversation) pour
 * libérer du contexte ; les `KEEP_RECENT_ON_SUMMARY` derniers restent en clair.
 */
export async function summarizeOlder(conversation: Conversation): Promise<boolean> {
  const path = useChat.getState().messages;
  const start = conversation.summaryUntilId
    ? path.findIndex((m) => m.id === conversation.summaryUntilId) + 1
    : 0;
  const candidates = path.slice(start, Math.max(start, path.length - KEEP_RECENT_ON_SUMMARY));
  if (candidates.length < 2) return false;

  const transcript = candidates
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  const previous = conversation.summary
    ? `${i18n.t('chat.summaryPrevious')}\n${conversation.summary}\n\n`
    : '';
  const { content: summary } = await openrouter.completeChat({
    model: conversation.model,
    messages: [
      { role: 'system', content: i18n.t('chat.summaryPrompt') },
      { role: 'user', content: `${previous}${transcript}` },
    ],
    temperature: 0.2,
    maxTokens: 600,
  });
  const lastId = candidates[candidates.length - 1]?.id ?? null;
  await useConversations
    .getState()
    .update(conversation.id, { summary: summary.trim(), summaryUntilId: lastId });
  return true;
}

/**
 * Historique envoyé à l'API : instruction système, mémoire du persona (souvenirs déjà
 * chargés dans `usePersonaMemory`), résumé, puis messages du chemin actif.
 */
export function buildHistory(conversation: Conversation, path: Message[]): ChatMessageInput[] {
  const input: ChatMessageInput[] = [];
  const memory = conversation.presetId
    ? formatMemoryBlock(
        memoriesOf(conversation.presetId),
        resolveLanguage(useSettings.getState().language),
      )
    : null;
  const system = [
    conversation.systemPrompt,
    memory,
    conversation.summary && `${i18n.t('chat.summaryLabel')}\n${conversation.summary}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  if (system) input.push({ role: 'system', content: system });

  const start = conversation.summaryUntilId
    ? path.findIndex((m) => m.id === conversation.summaryUntilId) + 1
    : 0;
  for (const m of path.slice(Math.max(0, start))) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant') {
      // Les images générées repartent dans `images`, pas dans `content` (édition multi-tours).
      const images = toImageParts(m.attachments);
      input.push({ role: m.role, content: m.content, ...(images.length ? { images } : {}) });
      continue;
    }
    input.push({ role: m.role, content: toContentParts(m.content, m.attachments) });
  }
  return input;
}

function buildRequest(
  conversation: Conversation,
  messages: ChatMessageInput[],
  model: string = conversation.model,
): ChatRequest {
  const s = useSettings.getState();
  const p = effectiveParams(conversation);
  return {
    model,
    messages,
    temperature: p.temperature,
    reasoning: p.reasoning,
    webSearch: p.webSearch,
    dataCollectionDeny: s.dataCollectionDeny,
    ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}),
    ...(p.topP !== null ? { topP: p.topP } : {}),
    ...(s.providerSort ? { providerSort: s.providerSort } : {}),
    ...(s.ignoreProviders.length ? { ignoreProviders: s.ignoreProviders } : {}),
    // Seuls les modèles à sortie image acceptent `modalities` : ne l'envoyer qu'à eux.
    ...(supportsImageOutput(useModels.getState().byId(conversation.model))
      ? { modalities: ['image', 'text'] as const }
      : {}),
  };
}

/**
 * Génère (ou poursuit) une réponse de l'assistant sous `parentId`.
 * Le message est créé immédiatement en base puis mis à jour pendant le flux,
 * pour qu'une fermeture de l'app ne perde pas le texte déjà reçu.
 * `modelOverride` remplace le modèle de la conversation pour cet appel seulement ;
 * une continuation reprend le modèle du message poursuivi.
 */
async function runAssistant(
  conversation: Conversation,
  parentId: string | null,
  resume?: Message,
  modelOverride?: string,
): Promise<void> {
  const chat = useChat.getState();
  const requestId = newId();
  const model = modelOverride ?? resume?.model ?? conversation.model;

  const assistant: Message =
    resume ??
    (await msgRepo.add({
      conversationId: conversation.id,
      parentId,
      role: 'assistant',
      content: '',
      model,
      ...emptyAssistant,
      finishReason: 'streaming',
    }));
  if (resume) await msgRepo.update(assistant.id, { finishReason: 'streaming' });
  chat.upsert({ ...assistant, finishReason: 'streaming' });

  // Souvenirs du persona prêts avant de composer l'instruction système.
  await usePersonaMemory.getState().ensure(conversation.presetId);

  // Historique = chemin actif jusqu'au message assistant inclus (préfixe pour une continuation).
  const path = activePath(useChat.getState().all);
  const upTo = path.findIndex((m) => m.id === assistant.id);
  const history = buildHistory(
    conversation,
    upTo >= 0 ? path.slice(0, upTo + (resume ? 1 : 0)) : path,
  );

  const acc = {
    content: resume?.content ?? '',
    reasoning: resume?.reasoning ?? '',
    attachments: [...(resume?.attachments ?? [])],
    usage: null as { promptTokens: number; completionTokens: number; cost: number | null } | null,
    finishReason: null as string | null,
    error: null as string | null,
  };
  const startedAt = Date.now();
  let lastPersist = startedAt;
  const persistPartial = async () => {
    lastPersist = Date.now();
    await msgRepo.update(assistant.id, { content: acc.content, reasoning: acc.reasoning || null });
  };

  // Les fragments arrivent plus vite que l'écran ne se rafraîchit : on les regroupe
  // par frame pour ne déclencher qu'un rendu React par ~16 ms.
  const pending = { content: '', reasoning: '', scheduled: false };
  const flush = () => {
    pending.scheduled = false;
    if (pending.content) useChat.getState().appendDelta(assistant.id, pending.content);
    if (pending.reasoning) useChat.getState().appendReasoning(assistant.id, pending.reasoning);
    pending.content = '';
    pending.reasoning = '';
  };
  const schedule = () => {
    if (pending.scheduled) return;
    pending.scheduled = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  };

  chat.beginStream(conversation.id, requestId, assistant.id);
  try {
    await openrouter.streamChat(requestId, buildRequest(conversation, history, model), (event) => {
      switch (event.type) {
        case 'delta':
          acc.content += event.content;
          pending.content += event.content;
          schedule();
          if (Date.now() - lastPersist > PERSIST_INTERVAL_MS) void persistPartial();
          break;
        case 'reasoning':
          acc.reasoning += event.content;
          pending.reasoning += event.content;
          schedule();
          break;
        case 'image': {
          // Persistée tout de suite : une image est rare, lourde et ne doit pas se perdre.
          const image = imageAttachmentFromUrl(event.url, acc.attachments.length + 1);
          acc.attachments.push(image);
          useChat.getState().appendAttachment(assistant.id, image);
          void msgRepo.update(assistant.id, { attachments: acc.attachments });
          break;
        }
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
    });
  } catch (err) {
    acc.error = errorMessage(err);
  }
  flush();

  const durationMs = Date.now() - startedAt + (resume?.durationMs ?? 0);
  const finishReason = acc.error ? 'error' : (acc.finishReason ?? 'stop');
  const final: Message = {
    ...assistant,
    content: acc.content,
    reasoning: acc.reasoning || null,
    attachments: acc.attachments,
    promptTokens: acc.usage?.promptTokens ?? resume?.promptTokens ?? null,
    completionTokens: (acc.usage?.completionTokens ?? 0) + (resume?.completionTokens ?? 0) || null,
    cost: (acc.usage?.cost ?? 0) + (resume?.cost ?? 0) || null,
    finishReason,
    durationMs,
  };

  if (!acc.content && !acc.reasoning && acc.attachments.length === 0) {
    // Rien reçu (erreur immédiate ou arrêt avant le premier token) : pas de message vide.
    await msgRepo.removeSubtree(conversation.id, assistant.id);
    useChat.getState().removeMany([assistant.id]);
  } else {
    await msgRepo.update(assistant.id, {
      content: final.content,
      reasoning: final.reasoning,
      attachments: final.attachments,
      promptTokens: final.promptTokens,
      completionTokens: final.completionTokens,
      cost: final.cost,
      finishReason,
      durationMs,
    });
    useChat.getState().upsert(final);
  }
  useChat.getState().endStream(acc.error);
  if (acc.error) toast.error(acc.error);

  const at = await convRepo.touch(conversation.id);
  useConversations.getState().touched(conversation.id, at);
  useSettings.getState().rememberModel(model);

  if (!acc.error && useSettings.getState().notifyOnComplete) {
    void notifyIfHidden(conversation.title, acc.content);
  }
}

async function generateTitle(conversation: Conversation, firstMessage: string): Promise<void> {
  try {
    const { content: raw } = await openrouter.completeChat({
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

/**
 * Applique un persona : à la conversation (instruction composée, paramètres, modèle) ou,
 * sans conversation, aux valeurs par défaut. Un persona en jeu de rôle démarre toujours une
 * conversation dédiée et y insère sa première réplique. Renvoie la conversation créée, à ouvrir.
 */
export async function applyPreset(
  conversation: Conversation | null,
  preset: Preset,
): Promise<Conversation | null> {
  const s = useSettings.getState();
  const language = resolveLanguage(s.language);
  const systemPrompt = buildSystemPrompt(preset, language);
  const params = {
    presetId: preset.id,
    systemPrompt,
    temperature: preset.temperature,
    topP: preset.topP,
    maxTokens: preset.maxTokens,
    // En jeu de rôle, le raisonnement affiché n'apporte rien et casse l'immersion.
    reasoning: preset.persona.mode === 'roleplay' ? false : preset.reasoning,
  };
  const greeting = greetingOf(preset, language);

  if (conversation) {
    await useConversations
      .getState()
      .update(conversation.id, { ...params, ...(preset.model ? { model: preset.model } : {}) });
    const chat = useChat.getState();
    if (greeting && chat.conversationId === conversation.id && chat.all.length === 0) {
      await addGreeting({ ...conversation, model: preset.model ?? conversation.model }, greeting);
    }
    return null;
  }

  if (preset.persona.mode === 'roleplay') {
    const created = await useConversations.getState().create({
      title: preset.name,
      model: preset.model ?? s.defaultModel,
      webSearch: s.webSearch,
      ...params,
    });
    if (greeting) await addGreeting(created, greeting);
    return created;
  }

  s.patch({
    systemPrompt: systemPrompt ?? '',
    ...(preset.temperature !== null ? { temperature: preset.temperature } : {}),
    ...(preset.topP !== null ? { topP: preset.topP } : {}),
    ...(preset.maxTokens !== null ? { maxTokens: preset.maxTokens } : {}),
    ...(preset.reasoning !== null ? { reasoning: preset.reasoning } : {}),
    ...(preset.model ? { defaultModel: preset.model } : {}),
  });
  return null;
}

/** Première réplique du personnage, enregistrée comme réponse de l'assistant (sans coût). */
async function addGreeting(conversation: Conversation, greeting: string): Promise<void> {
  const message = await msgRepo.add({
    conversationId: conversation.id,
    parentId: null,
    role: 'assistant',
    content: greeting,
    model: conversation.model,
    ...emptyAssistant,
    finishReason: 'stop',
  });
  const chat = useChat.getState();
  if (chat.conversationId === conversation.id) chat.upsert(message);
}
