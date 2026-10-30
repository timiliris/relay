import { Bot, Brain, ChevronDown, Copy, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '@/lib/db';
import { formatCost } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Markdown } from './markdown';
import { IconButton } from './ui/tooltip-button';

interface MessageBubbleProps {
  message: Pick<
    Message,
    | 'role'
    | 'content'
    | 'reasoning'
    | 'model'
    | 'promptTokens'
    | 'completionTokens'
    | 'cost'
    | 'finishReason'
  >;
  streaming?: boolean;
  showReasoning: boolean;
  onCopy?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onRegenerate?: (() => void) | undefined;
}

export function MessageBubble({
  message,
  streaming = false,
  showReasoning,
  onCopy,
  onDelete,
  onRegenerate,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const hasUsage = message.promptTokens !== null && message.completionTokens !== null;

  if (isUser) {
    return (
      <div className="group flex justify-end">
        <div className="relative max-w-[75%]">
          <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
            {message.content}
          </div>
          <Actions className="right-0" onCopy={onCopy} onDelete={onDelete} />
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3">
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card">
        <Bot className="size-4 text-muted-foreground" />
      </div>
      <div className="relative min-w-0 flex-1">
        {showReasoning && message.reasoning && (
          <Reasoning text={message.reasoning} streaming={streaming && !message.content} />
        )}
        {message.content ? (
          <Markdown className="text-sm">{message.content}</Markdown>
        ) : (
          streaming && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-block size-2 animate-pulse rounded-full bg-muted-foreground" />
              {t('chat.thinking')}
            </p>
          )
        )}
        {streaming && message.content && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground align-text-bottom" />
        )}
        {!streaming && (
          <div className="mt-1 flex min-h-6 items-center gap-3 text-xs text-muted-foreground">
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
            {message.finishReason === 'cancelled' && <span>{t('chat.cancelled')}</span>}
            <Actions
              className="static ml-auto"
              onCopy={onCopy}
              onDelete={onDelete}
              onRegenerate={onRegenerate}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(streaming);
  return (
    <div className="mb-2 rounded-lg border border-dashed">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Brain className={cn('size-3.5', streaming && 'animate-pulse')} />
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

function Actions({
  className,
  onCopy,
  onDelete,
  onRegenerate,
}: {
  className?: string;
  onCopy?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onRegenerate?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'absolute -bottom-7 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [&_button]:size-6 [&_svg]:size-3.5',
        className,
      )}
    >
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
    </div>
  );
}
