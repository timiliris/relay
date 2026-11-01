import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { ArrowDown, Download, Globe, KeyRound, Pin, Scissors, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Composer } from '@/components/composer';
import { GenerationParams } from '@/components/generation-params';
import { MessageBubble } from '@/components/message-bubble';
import { ModelPicker } from '@/components/model-picker';
import { PinnedPanel, pinnedMessages } from '@/components/pinned-panel';
import { PresetBadges } from '@/components/preset-avatar';
import { PresetPicker } from '@/components/preset-picker';
import { Button, buttonVariants } from '@/components/ui/button';
import { IconButton } from '@/components/ui/tooltip-button';
import { useWindowTitle } from '@/hooks/use-window-title';
import {
  continueMessage,
  deleteMessage,
  editMessage,
  effectiveParams,
  ensureConversation,
  regenerate,
  retryLast,
  sendMessage,
  stopStreaming,
  summarizeOlder,
  switchVersion,
  togglePin,
} from '@/lib/chat-service';
import { chartBg } from '@/lib/color';
import { estimateContext } from '@/lib/context';
import type { Attachment, Message } from '@/lib/db';
import { formatCost } from '@/lib/format';
import { supportsImages } from '@/lib/openrouter';
import { errorMessage, isTauri } from '@/lib/tauri';
import { siblingIndex } from '@/lib/tree';
import { cn } from '@/lib/utils';
import { useApiKey } from '@/stores/api-key';
import { useChat } from '@/stores/chat';
import { useConversations } from '@/stores/conversations';
import { dialog } from '@/stores/dialog';
import { useModels } from '@/stores/models';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';

interface ChatPageProps {
  /** `null` : écran « nouvelle conversation ». */
  conversationId: string | null;
}

export function ChatPage({ conversationId }: ChatPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hash = useRouterState({ select: (s) => s.location.hash });
  const conversation = useConversations(
    (s) => s.items.find((c) => c.id === conversationId) ?? null,
  );
  const updateConversation = useConversations((s) => s.update);
  const presetId = conversation?.presetId ?? null;
  const preset = useConversations(
    (s) => (presetId ? s.presets.find((p) => p.id === presetId) : undefined) ?? null,
  );
  const { all, messages, stream, error, open, setError } = useChat();
  const settings = useSettings();
  const apiKeyHint = useApiKey((s) => s.hint);
  const modelInfo = useModels((s) => s.byId(conversation?.model ?? settings.defaultModel));
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [composerState, setComposerState] = useState<{ text: string; attachments: Attachment[] }>({
    text: '',
    attachments: [],
  });
  const [visibleCount, setVisibleCount] = useState(settings.messagesPageSize);
  const [atBottom, setAtBottom] = useState(true);
  const [pinsOpen, setPinsOpen] = useState(false);
  /** Message à atteindre une fois rendu (volet des épinglés). */
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inTauri = isTauri();
  useWindowTitle(conversation?.title ?? null);

  useEffect(() => {
    void open(conversationId);
    setVisibleCount(settings.messagesPageSize);
    setPinsOpen(false);
  }, [conversationId, open, settings.messagesPageSize]);

  // Conversation rouverte au prochain lancement.
  const rememberConversation = settings.patch;
  useEffect(() => {
    if (conversationId) rememberConversation({ lastConversationId: conversationId });
  }, [conversationId, rememberConversation]);

  const streaming = stream !== null && stream.conversationId === conversationId;
  const model = conversation?.model ?? settings.defaultModel;
  const systemPrompt = conversation ? (conversation.systemPrompt ?? '') : settings.systemPrompt;
  const webSearch = conversation ? conversation.webSearch : settings.webSearch;
  const totalCost = useMemo(() => messages.reduce((sum, m) => sum + (m.cost ?? 0), 0), [messages]);
  const context = useMemo(
    () =>
      estimateContext(
        messages,
        composerState.text,
        composerState.attachments,
        systemPrompt,
        modelInfo?.contextLength ?? 0,
      ),
    [messages, composerState, systemPrompt, modelInfo],
  );

  // Défilement : seulement si l'utilisateur est déjà en bas (lecture non interrompue).
  const lastMessage = messages[messages.length - 1];
  // biome-ignore lint/correctness/useExhaustiveDependencies: déclenché par le contenu du dernier message
  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, lastMessage?.content.length, lastMessage?.reasoning?.length, atBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }, []);

  // Mise en évidence d'un message ciblé par la recherche (hash de l'URL).
  useEffect(() => {
    if (!hash || messages.length === 0) return;
    const el = document.getElementById(`message-${hash}`);
    if (!el) return;
    setAtBottom(false);
    el.scrollIntoView({ block: 'center' });
    el.classList.add('message-highlight');
    const timer = setTimeout(() => el.classList.remove('message-highlight'), 2000);
    return () => clearTimeout(timer);
  }, [hash, messages.length]);

  // Défilement vers un message épinglé, une fois rendu (il peut être dans la partie repliée).
  useEffect(() => {
    if (!scrollTarget) return;
    const el = document.getElementById(`message-${scrollTarget}`);
    if (!el) return;
    setScrollTarget(null);
    setAtBottom(false);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('message-highlight');
    const timer = setTimeout(() => el.classList.remove('message-highlight'), 2000);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  const goToMessage = (m: Message) => {
    const index = messages.findIndex((x) => x.id === m.id);
    // Révèle la page cachée si le message est au-delà des N derniers affichés.
    if (index >= 0 && index < messages.length - visibleCount) {
      setVisibleCount(messages.length - index);
    }
    setPinsOpen(false);
    setScrollTarget(m.id);
  };
  const pinned = useMemo(() => pinnedMessages(messages), [messages]);
  const closePins = useCallback(() => setPinsOpen(false), []);

  const guard = (fn: () => Promise<void>) => () => fn().catch((err) => setError(errorMessage(err)));
  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  const onSend = async (text: string, attachments: Attachment[]) => {
    try {
      setAtBottom(true);
      const target = await ensureConversation(conversation, text || attachments[0]?.name || '');
      if (!conversation) {
        await navigate({ to: '/chat/$conversationId', params: { conversationId: target.id } });
      }
      await sendMessage(target, text, attachments);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const confirm = (message: string) =>
    dialog.confirm({
      title: t('common.delete'),
      message,
      confirmLabel: t('common.delete'),
      destructive: true,
    });

  const onDelete = (m: Message) =>
    guard(async () => {
      if (await confirm(t('chat.deleteMessageConfirm'))) await deleteMessage(m);
    })();

  const onSummarize = guard(async () => {
    if (!conversation) return;
    const done = await summarizeOlder(conversation);
    toast[done ? 'success' : 'info'](done ? t('chat.summarized') : t('chat.summaryTooShort'));
  });

  const exportMarkdown = guard(async () => {
    if (!conversation) return;
    const path = await save({
      defaultPath: `${conversation.title.replace(/[\\/:*?"<>|]/g, '-')}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!path) return;
    await writeTextFile(path, toMarkdown(conversation.title, messages, t('chat.youLabel')));
    toast.success(t('chat.exported'));
  });

  const lastUserMessage = () =>
    [...messages].reverse().find((m) => m.role === 'user')?.content ?? null;
  const showEmpty = !conversationId && messages.length === 0 && !streaming;
  const suggestions = t('chat.suggestions', { returnObjects: true }) as string[];
  const hidden = Math.max(0, messages.length - visibleCount);
  const visible = messages.slice(hidden);
  const showReasoning = conversation ? effectiveParams(conversation).reasoning : settings.reasoning;

  return (
    <div className="flex h-full flex-col">
      <p className="sr-only" role="status" aria-live="polite">
        {streaming
          ? t('chat.responding')
          : lastMessage?.role === 'assistant'
            ? t('chat.responseDone')
            : ''}
      </p>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {conversation?.title ?? (showEmpty ? t('chat.emptyTitle') : t('chat.untitled'))}
        </p>
        {preset && <PresetBadges preset={preset} className="hidden sm:inline-flex" />}
        {totalCost > 0 && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t('chat.conversationCost', { cost: formatCost(totalCost) })}
          </span>
        )}
        {conversation && pinned.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className={cn('gap-1.5 px-2', pinsOpen && 'bg-accent')}
            aria-pressed={pinsOpen}
            aria-label={t('chat.pins.title')}
            title={t('chat.pins.title')}
            onClick={() => setPinsOpen((o) => !o)}
          >
            <Pin className="size-4 text-warning" />
            <span className="font-mono text-xs tabular-nums">{pinned.length}</span>
          </Button>
        )}
        {conversation && messages.length > 8 && (
          <IconButton label={t('chat.summarize')} onClick={onSummarize} disabled={streaming}>
            <Scissors />
          </IconButton>
        )}
        {conversation && messages.length > 0 && (
          <IconButton label={t('chat.export')} onClick={exportMarkdown} disabled={!inTauri}>
            <Download />
          </IconButton>
        )}
      </header>

      {inTauri && apiKeyHint === null && (
        <div className="flex items-center gap-3 border-b bg-amber-500/10 px-4 py-2 text-sm">
          <KeyRound className="size-4 shrink-0 text-amber-600" />
          <span className="flex-1">
            <strong>{t('chat.noKeyTitle')}</strong> — {t('chat.noKeyBody')}
          </span>
          <Link to="/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('chat.goToSettings')}
          </Link>
        </div>
      )}

      {/* Le volet des épinglés est hors de la zone défilante pour rester en place. */}
      {pinsOpen && conversation && (
        <div className="relative z-20">
          <PinnedPanel messages={messages} onClose={closePins} onGoTo={goToMessage} />
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto">
        {showEmpty ? (
          <EmptyState suggestions={suggestions} onPick={setDraft} />
        ) : (
          <div className="message-list mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6">
            {hidden > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="self-center"
                onClick={() => setVisibleCount((n) => n + settings.messagesPageSize)}
              >
                {t('chat.showEarlier', { count: Math.min(hidden, settings.messagesPageSize) })}
              </Button>
            )}
            {visible.map((m, index) => {
              const isLast = hidden + index === messages.length - 1;
              const isStreamingThis = streaming && stream?.messageId === m.id;
              const canAct = conversation !== null && !streaming;
              return (
                <div key={m.id} id={`message-${m.id}`}>
                  <MessageBubble
                    message={m}
                    streaming={isStreamingThis}
                    showReasoning={showReasoning}
                    persona={preset ?? undefined}
                    version={siblingIndex(all, m)}
                    onSwitchVersion={canAct ? (dir) => void switchVersion(m, dir) : undefined}
                    onCopy={() => void copy(m.content)}
                    onTogglePin={
                      conversation !== null && !isStreamingThis
                        ? guard(() => togglePin(m))
                        : undefined
                    }
                    onDelete={canAct ? () => onDelete(m) : undefined}
                    onEdit={
                      canAct && m.role === 'user'
                        ? (text) => guard(() => editMessage(conversation, m, text))()
                        : undefined
                    }
                    onRegenerate={
                      canAct && m.role === 'assistant' && isLast
                        ? guard(() => regenerate(conversation, m))
                        : undefined
                    }
                    onContinue={
                      canAct && m.role === 'assistant' && isLast
                        ? guard(() => continueMessage(conversation, m))
                        : undefined
                    }
                  />
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
        {!atBottom && !showEmpty && (
          <button
            type="button"
            onClick={() => {
              setAtBottom(true);
              bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
            }}
            aria-label={t('chat.scrollToBottom')}
            title={t('chat.scrollToBottom')}
            className="sticky bottom-3 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border bg-card shadow-md hover:bg-accent"
          >
            <ArrowDown className="size-4" />
          </button>
        )}
      </div>

      <div className="shrink-0 px-4 pt-2 pb-4">
        {error && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span className="flex-1">{error}</span>
            {conversation && (
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={guard(() => retryLast(conversation))}
              >
                {t('common.retry')}
              </Button>
            )}
            <IconButton
              label={t('common.close')}
              className="size-6 text-destructive"
              onClick={() => setError(null)}
            >
              <X />
            </IconButton>
          </div>
        )}
        <Composer
          streaming={streaming}
          disabled={!inTauri}
          onSend={(text, attachments) => void onSend(text, attachments)}
          onStop={stopStreaming}
          draft={draft}
          onRecallLast={lastUserMessage}
          context={context}
          onContextChange={(text, attachments) => setComposerState({ text, attachments })}
          acceptsImages={supportsImages(modelInfo)}
        >
          <ModelPicker
            value={model}
            onChange={(id) =>
              conversation
                ? void updateConversation(conversation.id, { model: id })
                : settings.patch({ defaultModel: id })
            }
            side="top"
          />
          <GenerationParams conversation={conversation} />
          <PresetPicker conversation={conversation} />
          <Button
            variant="ghost"
            size="sm"
            title={webSearch ? t('chat.webSearchOn') : t('chat.webSearch')}
            className={cn('gap-1.5', webSearch ? 'text-primary' : 'text-muted-foreground')}
            aria-pressed={webSearch}
            onClick={() =>
              conversation
                ? void updateConversation(conversation.id, { webSearch: !webSearch })
                : settings.patch({ webSearch: !webSearch })
            }
          >
            <Globe className="size-4" />
            <span className="hidden text-xs lg:inline">{t('chat.webSearch')}</span>
          </Button>
          {systemPrompt.trim() && (
            <span
              className="hidden truncate text-xs text-muted-foreground md:inline"
              title={systemPrompt}
            >
              · {t('chat.systemPromptActive')}
            </span>
          )}
        </Composer>
        {!inTauri && (
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
            {t('common.onlyInApp')}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (text: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-full max-w-2xl animate-slide-up flex-col items-center justify-center gap-6 px-4 py-8 text-center">
      <div className="relative">
        <div
          className="absolute -inset-6 animate-float rounded-full bg-gradient-to-tr from-chart-1/40 via-chart-2/30 to-chart-3/40 blur-2xl"
          aria-hidden="true"
        />
        <div className="relative flex size-12 items-center justify-center rounded-2xl border bg-card shadow-sm">
          <Sparkles className="size-6 text-primary" />
        </div>
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('chat.emptyTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('chat.emptySubtitle')}</p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {suggestions.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="group flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-accent"
          >
            <span
              className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full transition-transform group-hover:scale-125',
                chartBg(i),
              )}
              aria-hidden="true"
            />
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function toMarkdown(title: string, messages: Message[], youLabel: string): string {
  const parts = [`# ${title}`, ''];
  for (const m of messages) {
    const author = m.role === 'user' ? youLabel : (m.model ?? m.role);
    parts.push(`## ${author}`, '');
    if (m.attachments.length) parts.push(...m.attachments.map((a) => `> 📎 ${a.name}`), '');
    parts.push(m.content, '');
  }
  return parts.join('\n');
}
