import { useNavigate } from '@tanstack/react-router';
import { MessageSquare, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type SearchHit, search } from '@/lib/db';
import { isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useConversations } from '@/stores/conversations';

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

/** Recherche globale (Ctrl+K) : titres de conversations et contenu des messages. */
export function SearchPalette({ open, onClose }: SearchPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const conversations = useConversations((s) => s.items);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Recherche avec un léger délai pour ne pas interroger SQLite à chaque frappe.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits(
        conversations.slice(0, 8).map((c) => ({
          conversationId: c.id,
          conversationTitle: c.title,
          messageId: null,
          role: null,
          snippet: c.title,
          updatedAt: c.updatedAt,
        })),
      );
      return;
    }
    if (!isTauri()) return;
    const timer = setTimeout(() => {
      search(q)
        .then(setHits)
        .catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(timer);
  }, [query, open, conversations]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: réinitialise la sélection quand les résultats changent
  useEffect(() => setSelected(0), [hits]);

  if (!open) return null;

  const go = (hit: SearchHit) => {
    onClose();
    void navigate({
      to: '/chat/$conversationId',
      params: { conversationId: hit.conversationId },
      ...(hit.messageId ? { hash: hit.messageId } : {}),
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      const hit = hits[selected];
      if (hit) go(hit);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const titles = hits.filter((h) => h.messageId === null);
  const messages = hits.filter((h) => h.messageId !== null);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 pt-[12vh]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('search.title')}
        className="w-[36rem] max-w-[92vw] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1">
          {hits.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">{t('search.noResults')}</p>
          )}
          {titles.length > 0 && <Group label={t('search.conversations')} />}
          {titles.map((hit) => (
            <Row
              key={hit.conversationId}
              hit={hit}
              active={hits.indexOf(hit) === selected}
              onClick={() => go(hit)}
            />
          ))}
          {messages.length > 0 && <Group label={t('search.messages')} />}
          {messages.map((hit) => (
            <Row
              key={hit.messageId}
              hit={hit}
              active={hits.indexOf(hit) === selected}
              onClick={() => go(hit)}
            />
          ))}
        </div>
        <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">{t('search.hint')}</p>
      </div>
    </div>
  );
}

function Group({ label }: { label: string }) {
  return (
    <p className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
  );
}

function Row({ hit, active, onClick }: { hit: SearchHit; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {hit.messageId ? hit.snippet : hit.conversationTitle}
        </span>
        {hit.messageId && (
          <span className="block truncate text-xs text-muted-foreground">
            {hit.conversationTitle}
          </span>
        )}
      </span>
    </button>
  );
}
