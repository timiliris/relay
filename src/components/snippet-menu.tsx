import { Slash } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  expandSnippet,
  filterSnippets,
  SNIPPET_PREFIX,
  type Snippet,
  usesClipboard,
} from '@/lib/snippets';
import { cn } from '@/lib/utils';
import { useSettings } from '@/stores/settings';

/**
 * Menu des raccourcis de prompt, affiché au-dessus du composeur quand le texte
 * commence par `/`. Le premier mot est le déclencheur recherché, le reste la
 * « sélection » insérée dans le corps. Le hook porte l'état et le clavier ; le
 * composeur ne fait que le câbler.
 */
export function useSnippetMenu(value: string, setValue: (text: string) => void) {
  const snippets = useSettings((s) => s.snippets);
  const [selected, setSelected] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const listId = useId();

  const match = /^\/(\S*)(?:\s+([\s\S]*))?$/.exec(value);
  const query = match?.[1] ?? null;
  const selection = match?.[2] ?? '';
  const items = useMemo(
    () => (query === null ? [] : filterSnippets(snippets, query)),
    [snippets, query],
  );
  const open = query !== null && items.length > 0 && dismissedFor !== query;

  // Nouvelle saisie : la sélection repart du premier élément et un Échap antérieur s'oublie.
  // biome-ignore lint/correctness/useExhaustiveDependencies: réinitialisé à chaque changement de requête
  useEffect(() => {
    setSelected(0);
    if (dismissedFor !== null && dismissedFor !== query) setDismissedFor(null);
  }, [query]);

  const pick = (snippet: Snippet) => {
    void expandSnippet(snippet, selection).then(setValue);
  };

  /** `true` si la touche a été consommée par le menu. */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setSelected((i) => (i + delta + items.length) % items.length);
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const snippet = items[selected];
      if (snippet) pick(snippet);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissedFor(query);
      return true;
    }
    return false;
  };

  const element = open ? (
    <SnippetMenu
      id={listId}
      items={items}
      selected={selected}
      onHover={setSelected}
      onPick={pick}
      hasSelection={selection.trim().length > 0}
    />
  ) : null;

  return { open, listId, onKeyDown, element };
}

interface SnippetMenuProps {
  id: string;
  items: Snippet[];
  selected: number;
  hasSelection: boolean;
  onHover: (index: number) => void;
  onPick: (snippet: Snippet) => void;
}

export function SnippetMenu({
  id,
  items,
  selected,
  hasSelection,
  onHover,
  onPick,
}: SnippetMenuProps) {
  const { t } = useTranslation();
  useEffect(() => {
    document.getElementById(`${id}-${selected}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [id, selected]);

  return (
    <div
      className="absolute bottom-full left-3 z-20 mb-2 w-[min(28rem,calc(100%-1.5rem))] animate-pop overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
      data-testid="snippet-menu"
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium">
          <Slash className="size-3.5" />
          {t('chat.snippets.menuTitle')}
        </span>
        <span className="hidden sm:inline">{t('chat.snippets.menuHint')}</span>
      </div>
      <div
        id={id}
        role="listbox"
        aria-label={t('chat.snippets.menuTitle')}
        className="max-h-64 overflow-y-auto p-1"
      >
        {items.map((s, index) => {
          const active = index === selected;
          return (
            <div
              key={s.id}
              id={`${id}-${index}`}
              role="option"
              aria-selected={active}
              tabIndex={-1}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(e) => {
                // Garde le focus dans la zone de saisie.
                e.preventDefault();
                onPick(s);
              }}
              className={cn(
                'flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm',
                active && 'bg-accent',
              )}
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-primary">
                  {SNIPPET_PREFIX}
                  {s.trigger}
                </span>
                <span className="truncate font-medium">{s.title}</span>
                {usesClipboard(s.body) && (
                  <span className="ml-auto rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                    {'{{clipboard}}'}
                  </span>
                )}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {hasSelection ? s.body : s.body.replace(/\{\{\s*selection\s*\}\}/gi, '…')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
