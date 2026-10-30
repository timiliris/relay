import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ask } from '@tauri-apps/plugin-dialog';
import {
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@/lib/db';
import { groupConversations } from '@/lib/format';
import { isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useConversations } from '@/stores/conversations';
import { useSettings } from '@/stores/settings';
import { Button } from './ui/button';
import { Dropdown, DropdownItem } from './ui/dropdown';
import { Input } from './ui/input';
import { IconButton } from './ui/tooltip-button';

export function ConversationSidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const { items, loaded, load, rename, togglePin, remove } = useConversations();
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const patch = useSettings((s) => s.patch);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((c) => c.title.toLowerCase().includes(q)) : items;
    return groupConversations(list);
  }, [items, query]);

  const confirmDelete = async (c: Conversation) => {
    const message = t('sidebar.deleteConfirm', { title: c.title });
    const ok = isTauri()
      ? await ask(message, {
          title: t('common.delete'),
          kind: 'warning',
          okLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
        })
      : window.confirm(message);
    if (!ok) return;
    await remove(c.id);
    if (params.conversationId === c.id) void navigate({ to: '/' });
  };

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2">
        <IconButton label={t('sidebar.expand')} onClick={() => patch({ sidebarCollapsed: false })}>
          <PanelLeftOpen />
        </IconButton>
        <IconButton label={t('sidebar.newChat')} onClick={() => void navigate({ to: '/' })}>
          <Plus />
        </IconButton>
        <div className="flex-1" />
        <IconButton label={t('common.settings')} onClick={() => void navigate({ to: '/settings' })}>
          <Settings />
        </IconButton>
      </aside>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card/40">
      <div className="flex items-center gap-1 p-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 justify-start gap-2"
          onClick={() => void navigate({ to: '/' })}
        >
          <Plus className="size-4" />
          {t('sidebar.newChat')}
        </Button>
        <IconButton label={t('sidebar.collapse')} onClick={() => patch({ sidebarCollapsed: true })}>
          <PanelLeftClose />
        </IconButton>
      </div>
      <div className="relative px-2 pb-2">
        <Search className="pointer-events-none absolute top-2.5 left-4 size-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('sidebar.search')}
          aria-label={t('sidebar.search')}
          className="h-8 pl-8 text-xs"
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="Conversations">
        {loaded && items.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t('sidebar.empty')}
          </p>
        )}
        {loaded && items.length > 0 && groups.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t('sidebar.noResults')}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.key} className="mb-2">
            <p className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(`sidebar.${group.key}`)}
            </p>
            {group.items.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={c.id === params.conversationId}
                editing={editing?.id === c.id ? editing.title : null}
                onEdit={(title) => setEditing(title === null ? null : { id: c.id, title })}
                onRename={(title) => {
                  if (title.trim()) void rename(c.id, title.trim());
                  setEditing(null);
                }}
                onTogglePin={() => void togglePin(c.id)}
                onDelete={() => void confirmDelete(c)}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t p-2">
        <Link
          to="/settings"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          activeProps={{ className: 'bg-accent text-accent-foreground' }}
        >
          <Settings className="size-4" />
          {t('common.settings')}
        </Link>
      </div>
    </aside>
  );
}

interface RowProps {
  conversation: Conversation;
  active: boolean;
  /** Titre en cours d'édition, ou `null` si la ligne n'est pas en édition. */
  editing: string | null;
  onEdit: (title: string | null) => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

function ConversationRow({
  conversation: c,
  active,
  editing,
  onEdit,
  onRename,
  onTogglePin,
  onDelete,
}: RowProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'group flex items-center rounded-md text-sm hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      {editing !== null ? (
        <form
          className="flex-1 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            onRename(editing);
          }}
        >
          <Input
            autoFocus
            value={editing}
            onChange={(e) => onEdit(e.target.value)}
            onBlur={() => onEdit(null)}
            onKeyDown={(e) => e.key === 'Escape' && onEdit(null)}
            className="h-7 text-xs"
            aria-label={t('common.rename')}
          />
        </form>
      ) : (
        <>
          <Link
            to="/chat/$conversationId"
            params={{ conversationId: c.id }}
            className="min-w-0 flex-1 truncate px-2 py-1.5"
            title={c.title}
          >
            {c.pinned && <Pin className="mr-1.5 inline size-3 text-muted-foreground" />}
            {c.title}
          </Link>
          <Dropdown
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-label="Actions"
                className={cn(
                  'mr-1 rounded p-1 text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100',
                  active && 'opacity-100',
                )}
              >
                <MoreHorizontal className="size-4" />
              </button>
            )}
          >
            {(close) => (
              <>
                <DropdownItem
                  onClick={() => {
                    onTogglePin();
                    close();
                  }}
                >
                  {c.pinned ? <PinOff /> : <Pin />}
                  {c.pinned ? t('sidebar.unpin') : t('sidebar.pin')}
                </DropdownItem>
                <DropdownItem
                  onClick={() => {
                    onEdit(c.title);
                    close();
                  }}
                >
                  <Pencil />
                  {t('common.rename')}
                </DropdownItem>
                <DropdownItem
                  destructive
                  onClick={() => {
                    close();
                    onDelete();
                  }}
                >
                  <Trash2 />
                  {t('common.delete')}
                </DropdownItem>
              </>
            )}
          </Dropdown>
        </>
      )}
    </div>
  );
}
