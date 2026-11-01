import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Pencil,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useThrottledValue } from '@/hooks/use-throttled-value';
import { formatBytes } from '@/lib/attachments';
import { hueStyle } from '@/lib/color';
import type { Attachment, Message, Preset } from '@/lib/db';
import { formatCost } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Markdown } from './markdown';
import { PresetAvatar } from './preset-avatar';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { IconButton } from './ui/tooltip-button';

export interface MessageBubbleProps {
  message: Message;
  streaming?: boolean;
  showReasoning: boolean;
  /** Persona de la conversation : son avatar remplace l'icône générique de l'assistant. */
  persona?: Preset | undefined;
  /** Position parmi les versions (frères) ; masqué si total ≤ 1. */
  version?: { index: number; total: number } | undefined;
  onSwitchVersion?: ((direction: 1 | -1) => void) | undefined;
  onCopy?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onRegenerate?: (() => void) | undefined;
  onContinue?: (() => void) | undefined;
  onEdit?: ((text: string) => void) | undefined;
  /** Épingle ou désépingle le message (bouton Épingler/Désépingler). */
  onTogglePin?: (() => void) | undefined;
}

export function MessageBubble({
  message,
  streaming = false,
  showReasoning,
  persona,
  version,
  onSwitchVersion,
  onCopy,
  onDelete,
  onRegenerate,
  onContinue,
  onEdit,
  onTogglePin,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  // Pendant le streaming, le Markdown est re-rendu au plus toutes les 80 ms.
  const displayed = useThrottledValue(message.content, 80, streaming);
  const isUser = message.role === 'user';
  const hasUsage = message.promptTokens !== null && message.completionTokens !== null;
  const seconds = message.durationMs ? message.durationMs / 1000 : null;
  const tps =
    seconds && message.completionTokens ? Math.round(message.completionTokens / seconds) : null;

  const pinButton = onTogglePin && (
    <IconButton
      label={message.pinned ? t('chat.pins.unpin') : t('chat.pins.pin')}
      aria-pressed={message.pinned}
      className={cn(message.pinned && 'text-warning')}
      onClick={onTogglePin}
    >
      {message.pinned ? <PinOff /> : <Pin />}
    </IconButton>
  );

  const versionNav = version && version.total > 1 && onSwitchVersion && (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
      <button
        type="button"
        className="rounded p-0.5 hover:text-foreground disabled:opacity-40"
        aria-label={t('chat.previousVersion')}
        disabled={version.index <= 1}
        onClick={() => onSwitchVersion(-1)}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <span className="font-mono" title={t('chat.version', version)}>
        {version.index}/{version.total}
      </span>
      <button
        type="button"
        className="rounded p-0.5 hover:text-foreground disabled:opacity-40"
        aria-label={t('chat.nextVersion')}
        disabled={version.index >= version.total}
        onClick={() => onSwitchVersion(1)}
      >
        <ChevronRight className="size-3.5" />
      </button>
    </span>
  );

  if (isUser) {
    if (editing && onEdit) {
      return (
        <div className="flex justify-end">
          <form
            className="flex w-full max-w-[85%] flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (text && text !== message.content) onEdit(text);
              setEditing(false);
            }}
          >
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              className="min-h-20 font-sans"
              aria-label={t('chat.edit')}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={!draft.trim()}>
                {t('chat.editSend')}
              </Button>
            </div>
          </form>
        </div>
      );
    }
    return (
      <div
        className={cn(
          'group flex animate-slide-up flex-col items-end gap-1',
          message.pinned && 'border-l-2 border-warning pl-3',
        )}
      >
        {message.attachments.length > 0 && <AttachmentList attachments={message.attachments} />}
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {message.content}
        </div>
        <div className="flex h-6 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [&_button]:size-6 [&_svg]:size-3.5">
          {versionNav}
          {pinButton}
          {onEdit && (
            <IconButton
              label={t('chat.edit')}
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              <Pencil />
            </IconButton>
          )}
          {onCopy && (
            <IconButton label={t('chat.copyMessage')} onClick={onCopy}>
              <Copy />
            </IconButton>
          )}
          {onDelete && (
            <IconButton label={t('chat.deleteMessage')} onClick={onDelete}>
              <Trash2 />
            </IconButton>
          )}
        </div>
      </div>
    );
  }

  const interrupted = !streaming && message.finishReason === 'streaming';
  const truncated = !streaming && message.finishReason === 'length';

  return (
    <div
      className={cn(
        'group flex animate-slide-up gap-3',
        message.pinned && 'border-l-2 border-warning pl-3',
      )}
    >
      {persona ? (
        <PresetAvatar preset={persona} className="mt-1 size-7 text-xs shadow-sm" />
      ) : (
        <div
          className="hue-soft mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border"
          style={hueStyle(message.model ?? 'assistant')}
        >
          <Bot className="hue-text size-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        {showReasoning && message.reasoning && (
          <Reasoning text={message.reasoning} streaming={streaming && !message.content} />
        )}
        {displayed ? (
          <Markdown className="text-sm">{displayed}</Markdown>
        ) : (
          streaming && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                <span className="size-1.5 animate-dot rounded-full bg-chart-1" />
                <span className="size-1.5 animate-dot rounded-full bg-chart-2 [animation-delay:0.15s]" />
                <span className="size-1.5 animate-dot rounded-full bg-chart-3 [animation-delay:0.3s]" />
              </span>
              {t('chat.thinking')}
            </p>
          )
        )}
        {streaming && displayed && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground align-text-bottom" />
        )}
        {!streaming && (
          <div className="mt-1 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {versionNav}
            {message.model && <span className="truncate font-mono">{message.model}</span>}
            {hasUsage && (
              <span>
                {t('chat.tokens', {
                  prompt: message.promptTokens,
                  completion: message.completionTokens,
                })}
              </span>
            )}
            {message.cost !== null && (
              <span>{t('chat.cost', { cost: formatCost(message.cost) })}</span>
            )}
            {seconds !== null && (
              <span>
                {t('chat.duration', { seconds: seconds.toFixed(1) })}
                {tps ? ` · ${t('chat.tokensPerSecond', { tps })}` : ''}
              </span>
            )}
            {message.finishReason === 'cancelled' && <span>{t('chat.cancelled')}</span>}
            {interrupted && <span className="text-amber-600">{t('chat.interrupted')}</span>}
            {truncated && <span className="text-amber-600">{t('chat.truncated')}</span>}
            {onContinue && (interrupted || truncated || message.finishReason === 'cancelled') && (
              <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onContinue}>
                <Play className="size-3" />
                {t('chat.continue')}
              </Button>
            )}
            <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [&_button]:size-6 [&_svg]:size-3.5">
              {pinButton}
              {onCopy && (
                <IconButton label={t('chat.copyMessage')} onClick={onCopy}>
                  <Copy />
                </IconButton>
              )}
              {onRegenerate && (
                <IconButton label={t('chat.regenerate')} onClick={onRegenerate}>
                  <RefreshCw />
                </IconButton>
              )}
              {onDelete && (
                <IconButton label={t('chat.deleteMessage')} onClick={onDelete}>
                  <Trash2 />
                </IconButton>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function AttachmentList({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove?: ((id: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-2">
      {attachments.map((a) => (
        <li key={a.id} className="group/att relative">
          {a.kind === 'image' && a.data ? (
            <img
              src={a.data}
              alt={t('chat.imageAlt', { name: a.name })}
              className="h-24 max-w-48 rounded-lg border object-cover"
            />
          ) : (
            <span className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs">
              <FileText className="size-4 text-muted-foreground" />
              <span className="max-w-40 truncate">{a.name}</span>
              <span className="text-muted-foreground">{formatBytes(a.size)}</span>
            </span>
          )}
          {onRemove && (
            <button
              type="button"
              aria-label={t('chat.removeAttachment')}
              onClick={() => onRemove(a.id)}
              className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-foreground text-background group-hover/att:flex"
            >
              <Check className="size-3 rotate-45" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(streaming);
  return (
    <div className="mb-2 rounded-lg border border-dashed border-chart-1/40 bg-chart-1/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Brain className={cn('size-3.5 text-chart-1', streaming && 'animate-pulse')} />
        {t('chat.reasoning')}
        <ChevronDown
          className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t px-3 py-2 text-xs text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
}
