import { Link, useNavigate } from '@tanstack/react-router';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { Download, KeyRound, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Composer } from '@/components/composer';
import { GenerationParams } from '@/components/generation-params';
import { MessageBubble } from '@/components/message-bubble';
import { ModelPicker } from '@/components/model-picker';
import { buttonVariants } from '@/components/ui/button';
import { IconButton } from '@/components/ui/tooltip-button';
import {
  deleteMessage,
  ensureConversation,
  regenerate,
  sendMessage,
  stopStreaming,
} from '@/lib/chat-service';
import type { Message } from '@/lib/db';
import { formatCost } from '@/lib/format';
import { errorMessage, isTauri } from '@/lib/tauri';
import { useApiKey } from '@/stores/api-key';
import { useChat } from '@/stores/chat';
import { useConversations } from '@/stores/conversations';
import { useSettings } from '@/stores/settings';

interface ChatPageProps {
  /** `null` : écran « nouvelle conversation ». */
  conversationId: string | null;
}

export function ChatPage({ conversationId }: ChatPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const conversation = useConversations(
    (s) => s.items.find((c) => c.id === conversationId) ?? null,
  );
  const { setModel, setSystemPrompt } = useConversations();
  const { messages, stream, error, open, clearError } = useChat();
  const settings = useSettings();
  const apiKeyHint = useApiKey((s) => s.hint);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inTauri = isTauri();

  useEffect(() => {
    void open(conversationId);
  }, [conversationId, open]);

  const streaming = stream !== null && stream.conversationId === conversationId;
  const model = conversation?.model ?? settings.defaultModel;
  const systemPrompt = conversation ? (conversation.systemPrompt ?? '') : settings.systemPrompt;
  const totalCost = useMemo(() => messages.reduce((sum, m) => sum + (m.cost ?? 0), 0), [messages]);

  // Défilement automatique vers le bas pendant le streaming.
  // biome-ignore lint/correctness/useExhaustiveDependencies: déclenché par le contenu, pas par la ref
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, stream?.content.length, stream?.reasoning.length]);

  const onModelChange = (id: string) => {
    if (conversation) void setModel(conversation.id, id);
    else settings.patch({ defaultModel: id });
  };

  const onSystemPromptChange = (value: string) => {
    if (conversation) void setSystemPrompt(conversation.id, value.trim() || null);
    else settings.patch({ systemPrompt: value });
  };

  const onSend = async (text: string) => {
    try {
      const target = await ensureConversation(conversation, text);
      if (!conversation) {
        await navigate({ to: '/chat/$conversationId', params: { conversationId: target.id } });
      }
      await sendMessage(target, text);
    } catch (err) {
      useChat.getState().endStream(errorMessage(err));
    }
  };

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  const exportMarkdown = async () => {
    if (!conversation) return;
    try {
      const path = await save({
        defaultPath: `${conversation.title.replace(/[\\/:*?"<>|]/g, '-')}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!path) return;
      await writeTextFile(path, toMarkdown(conversation.title, messages, t('chat.youLabel')));
      setNotice(t('chat.exported'));
      setTimeout(() => setNotice(null), 2500);
    } catch (err) {
      useChat.getState().endStream(errorMessage(err));
    }
  };

  const showEmpty = !conversationId && messages.length === 0 && !streaming;
  const suggestions = t('chat.suggestions', { returnObjects: true }) as string[];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {conversation?.title ?? (showEmpty ? t('chat.emptyTitle') : t('chat.untitled'))}
        </p>
        {totalCost > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('chat.conversationCost', { cost: formatCost(totalCost) })}
          </span>
        )}
        {notice && <span className="text-xs text-muted-foreground">{notice}</span>}
        {conversation && messages.length > 0 && (
          <IconButton
            label={t('chat.export')}
            onClick={() => void exportMarkdown()}
            disabled={!inTauri}
          >
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

      <div className="flex-1 overflow-y-auto">
        {showEmpty ? (
          <EmptyState suggestions={suggestions} onPick={setDraft} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6">
            {messages.map((m, index) => (
              <MessageBubble
                key={m.id}
                message={m}
                showReasoning={settings.reasoning}
                onCopy={() => void copy(m.content)}
                onDelete={() => void deleteMessage(m.id)}
                onRegenerate={
                  conversation &&
                  m.role === 'assistant' &&
                  index === messages.length - 1 &&
                  !streaming
                    ? () => void regenerate(conversation)
                    : undefined
                }
              />
            ))}
            {streaming && stream && (
              <MessageBubble
                streaming
                showReasoning={settings.reasoning}
                message={{
                  role: 'assistant',
                  content: stream.content,
                  reasoning: stream.reasoning || null,
                  model,
                  promptTokens: null,
                  completionTokens: null,
                  cost: null,
                  finishReason: null,
                }}
              />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pt-2 pb-4">
        {error && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span className="flex-1">{error}</span>
            <IconButton
              label={t('common.close')}
              className="size-6 text-destructive"
              onClick={clearError}
            >
              <X />
            </IconButton>
          </div>
        )}
        <Composer
          streaming={streaming}
          disabled={!inTauri}
          onSend={(text) => void onSend(text)}
          onStop={stopStreaming}
          draft={draft}
        >
          <ModelPicker value={model} onChange={onModelChange} side="top" />
          <GenerationParams
            systemPrompt={systemPrompt}
            onSystemPromptChange={onSystemPromptChange}
          />
          {systemPrompt.trim() && (
            <span className="truncate text-xs text-muted-foreground" title={systemPrompt}>
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
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-6 px-4 py-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border bg-card shadow-sm">
        <Sparkles className="size-6 text-primary" />
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('chat.emptyTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('chat.emptySubtitle')}</p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-accent"
          >
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
    parts.push(`## ${author}`, '', m.content, '');
  }
  return parts.join('\n');
}
