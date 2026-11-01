import { Pin, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { Message } from '@/lib/db';
import { IconButton } from './ui/tooltip-button';

/** Messages épinglés du chemin affiché, dans l'ordre de la conversation. */
export function pinnedMessages(messages: Message[]): Message[] {
  return messages.filter((m) => m.pinned);
}

/** Date courte dans la langue de l'UI (`12 oct., 14:03`). */
function formatPinDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(i18n.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface PinnedPanelProps {
  messages: Message[];
  onClose: () => void;
  /** Fait défiler jusqu'au message et le surligne. */
  onGoTo: (message: Message) => void;
}

/** Volet flottant listant les messages épinglés d'une conversation. */
export function PinnedPanel({ messages, onClose, onGoTo }: PinnedPanelProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const pinned = pinnedMessages(messages);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  return (
    <section
      ref={ref}
      aria-label={t('chat.pins.title')}
      className="absolute top-2 right-4 z-20 flex w-[min(24rem,calc(100%-2rem))] max-h-[min(60vh,32rem)] animate-pop flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Pin className="size-4 text-warning" />
        <h2 className="flex-1 text-sm font-medium">
          {t('chat.pins.count', { count: pinned.length })}
        </h2>
        <IconButton label={t('common.close')} className="size-7" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>
      {pinned.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">{t('chat.pins.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y overflow-y-auto">
          {pinned.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onGoTo(m)}
                title={t('chat.pins.goTo')}
                className="flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="flex w-full items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate font-mono">
                    {m.role === 'user' ? t('chat.pins.you') : (m.model ?? m.role)}
                  </span>
                  <span className="ml-auto shrink-0">{formatPinDate(m.createdAt)}</span>
                </span>
                <span className="line-clamp-2 text-sm">{m.content || '…'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
