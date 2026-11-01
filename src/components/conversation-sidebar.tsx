import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  ChevronDown,
  Columns3,
  Folder,
  FolderInput,
  FolderPlus,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hueStyle } from '@/lib/color';
import type { Conversation, Folder as FolderType } from '@/lib/db';
import { groupConversations } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useChat } from '@/stores/chat';
import { useConversations } from '@/stores/conversations';
import { dialog } from '@/stores/dialog';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { Button } from './ui/button';
import { Dropdown, DropdownItem } from './ui/dropdown';
import { Input } from './ui/input';
import { IconButton } from './ui/tooltip-button';

const MIN_WIDTH = 200;
const MAX_WIDTH = 440;

interface SidebarProps {
  onOpenSearch: () => void;
}

export function ConversationSidebar({ onOpenSearch }: SidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const store = useConversations();
  const { items, folders, loaded, load } = store;
  const { sidebarCollapsed, sidebarWidth, showArchived, patch } = useSettings();
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const dragging = useRef(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const confirm = (message: string) =>
    dialog.confirm({
      title: t('common.delete'),
      message,
      confirmLabel: t('common.delete'),
      destructive: true,
    });

  const active = items.filter((c) => !c.archived);
  const archived = items.filter((c) => c.archived);
  const unfiled = useMemo(() => groupConversations(active.filter((c) => !c.folderId)), [active]);

  const leaveIfCurrent = (id: string) => {
    if (params.conversationId === id) void navigate({ to: '/' });
  };

  const removeConversation = async (c: Conversation) => {
    if (!(await confirm(t('sidebar.deleteConfirm', { title: c.title })))) return;
    await store.remove(c.id);
    leaveIfCurrent(c.id);
  };

  const removeFolder = async (f: FolderType) => {
    if (!(await confirm(t('sidebar.deleteFolderConfirm', { name: f.name })))) return;
    await store.removeFolder(f.id);
  };

  const removeArchived = async () => {
    if (!(await confirm(t('sidebar.deleteArchivedConfirm', { count: archived.length })))) return;
    const wasCurrentArchived = archived.some((c) => c.id === params.conversationId);
    await store.removeArchived();
    if (wasCurrentArchived) void navigate({ to: '/' });
  };

  // Redimensionnement par glisser du bord droit.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return;
      patch({
        sidebarWidth: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + ev.clientX - startX)),
      });
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (sidebarCollapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2">
        <IconButton label={t('sidebar.expand')} onClick={() => patch({ sidebarCollapsed: false })}>
          <PanelLeftOpen />
        </IconButton>
        <IconButton label={t('sidebar.newChat')} onClick={() => void navigate({ to: '/' })}>
          <Plus />
        </IconButton>
        <IconButton label={t('search.title')} onClick={onOpenSearch}>
          <Search />
        </IconButton>
        <div className="flex-1" />
        <IconButton label={t('nav.compare')} onClick={() => void navigate({ to: '/compare' })}>
          <Columns3 />
        </IconButton>
        <IconButton label={t('nav.usage')} onClick={() => void navigate({ to: '/usage' })}>
          <BarChart3 />
        </IconButton>
        <IconButton label={t('common.settings')} onClick={() => void navigate({ to: '/settings' })}>
          <Settings />
        </IconButton>
      </aside>
    );
  }

  const renderRow = (c: Conversation) => (
    <ConversationRow
      key={c.id}
      conversation={c}
      folders={folders}
      active={c.id === params.conversationId}
      editing={editing?.id === c.id ? editing.title : null}
      onEdit={(title) => setEditing(title === null ? null : { id: c.id, title })}
      onRename={(title) => {
        if (title.trim()) void store.rename(c.id, title.trim());
        setEditing(null);
      }}
      onTogglePin={() => void store.togglePin(c.id)}
      onArchive={() => {
        void store.setArchived(c.id, !c.archived);
        if (!c.archived) leaveIfCurrent(c.id);
      }}
      onMove={(folderId) => void store.moveToFolder(c.id, folderId)}
      onDelete={() => void removeConversation(c)}
    />
  );

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r bg-card/40"
      style={{ width: sidebarWidth }}
    >
      <div className="flex items-center gap-1 p-2">
        <Button
          size="sm"
          className="flex-1 justify-start gap-2 shadow-sm shadow-primary/20"
          onClick={() => void navigate({ to: '/' })}
        >
          <Plus className="size-4" />
          {t('sidebar.newChat')}
        </Button>
        <IconButton label={t('sidebar.collapse')} onClick={() => patch({ sidebarCollapsed: true })}>
          <PanelLeftClose />
        </IconButton>
      </div>
      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-input px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
        >
          <Search className="size-3.5" />
          {t('sidebar.search')}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label={t('nav.chat')}>
        {!loaded && (
          <div className="flex flex-col gap-2 px-2 py-3" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-7" style={{ width: `${70 + ((i * 13) % 30)}%` }} />
            ))}
          </div>
        )}
        {loaded && items.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t('sidebar.empty')}
          </p>
        )}

        {folders.map((f) => {
          const inFolder = active.filter((c) => c.folderId === f.id);
          const collapsed = collapsedFolders.has(f.id);
          return (
            <div key={f.id} className="mb-1">
              <div className="group flex items-center">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedFolders((s) => {
                      const next = new Set(s);
                      if (next.has(f.id)) next.delete(f.id);
                      else next.add(f.id);
                      return next;
                    })
                  }
                  className="flex flex-1 items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  aria-expanded={!collapsed}
                >
                  <ChevronDown
                    className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')}
                  />
                  <Folder className="hue-text size-3.5" style={hueStyle(f.id)} />
                  <span className="truncate">{f.name}</span>
                  <span className="ml-auto font-mono text-[10px]">{inFolder.length}</span>
                </button>
                <Dropdown
                  trigger={({ toggle }) => (
                    <button
                      type="button"
                      onClick={toggle}
                      aria-label={t('common.actions')}
                      className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <DropdownItem
                        onClick={() => {
                          close();
                          void dialog
                            .prompt({
                              title: t('sidebar.renameFolder'),
                              defaultValue: f.name,
                              confirmLabel: t('common.rename'),
                            })
                            .then((name) => {
                              if (name?.trim()) void store.renameFolder(f.id, name.trim());
                            });
                        }}
                      >
                        <Pencil />
                        {t('sidebar.renameFolder')}
                      </DropdownItem>
                      <DropdownItem
                        destructive
                        onClick={() => {
                          close();
                          void removeFolder(f);
                        }}
                      >
                        <Trash2 />
                        {t('sidebar.deleteFolder')}
                      </DropdownItem>
                    </>
                  )}
                </Dropdown>
              </div>
              {!collapsed && <div className="ml-3 border-l pl-1">{inFolder.map(renderRow)}</div>}
            </div>
          );
        })}

        {newFolder !== null ? (
          <form
            className="px-1 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newFolder.trim();
              if (name) {
                store.createFolder(name).catch((err) => toast.error(String(err)));
              }
              setNewFolder(null);
            }}
          >
            <Input
              autoFocus
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onBlur={() => setNewFolder(null)}
              onKeyDown={(e) => e.key === 'Escape' && setNewFolder(null)}
              placeholder={t('sidebar.folderName')}
              aria-label={t('sidebar.folderName')}
              className="h-7 text-xs"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setNewFolder('')}
            className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <FolderPlus className="size-3.5" />
            {t('sidebar.newFolder')}
          </button>
        )}

        {unfiled.map((group) => (
          <div key={group.key} className="mb-2">
            <p className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(`sidebar.${group.key}`)}
            </p>
            {group.items.map(renderRow)}
          </div>
        ))}

        {archived.length > 0 && (
          <div className="mb-2 border-t pt-2">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => patch({ showArchived: !showArchived })}
                className="flex flex-1 items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-expanded={showArchived}
              >
                <Archive className="size-3.5" />
                {t('sidebar.archived')}
                <span className="ml-auto font-mono text-[10px]">{archived.length}</span>
              </button>
              {showArchived && (
                <IconButton
                  label={t('sidebar.deleteArchived')}
                  className="size-7 text-muted-foreground"
                  onClick={() => void removeArchived()}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              )}
            </div>
            {showArchived && archived.map(renderRow)}
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-0.5 border-t p-2">
        <NavLink to="/compare" icon={<Columns3 className="size-4" />} label={t('nav.compare')} />
        <NavLink to="/usage" icon={<BarChart3 className="size-4" />} label={t('nav.usage')} />
        <NavLink
          to="/settings"
          icon={<Settings className="size-4" />}
          label={t('common.settings')}
        />
      </div>

      <div
        role="separator"
        aria-label={t('sidebar.resize')}
        aria-orientation="vertical"
        onPointerDown={startResize}
        className="absolute top-0 -right-1 h-full w-2 cursor-col-resize hover:bg-primary/20"
      />
    </aside>
  );
}

function NavLink({
  to,
  icon,
  label,
}: {
  to: '/compare' | '/usage' | '/settings';
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      activeProps={{ className: 'bg-accent text-accent-foreground' }}
    >
      {icon}
      {label}
    </Link>
  );
}

interface RowProps {
  conversation: Conversation;
  folders: FolderType[];
  active: boolean;
  editing: string | null;
  onEdit: (title: string | null) => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
}

function ConversationRow({
  conversation: c,
  folders,
  active,
  editing,
  onEdit,
  onRename,
  onTogglePin,
  onArchive,
  onMove,
  onDelete,
}: RowProps) {
  const { t } = useTranslation();
  const streaming = useChat((s) => s.stream?.conversationId === c.id);

  return (
    <div
      className={cn(
        'group relative flex items-center rounded-md text-sm transition-colors hover:bg-accent',
        active &&
          'bg-accent before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary',
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
            {streaming && (
              <span
                className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-success align-middle"
                aria-hidden="true"
              />
            )}
          </Link>
          <Dropdown
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-label={t('common.actions')}
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
                {folders.length > 0 && (
                  <>
                    <p className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('sidebar.moveToFolder')}
                    </p>
                    {c.folderId && (
                      <DropdownItem
                        onClick={() => {
                          onMove(null);
                          close();
                        }}
                      >
                        <FolderInput />
                        {t('sidebar.noFolder')}
                      </DropdownItem>
                    )}
                    {folders
                      .filter((f) => f.id !== c.folderId)
                      .map((f) => (
                        <DropdownItem
                          key={f.id}
                          onClick={() => {
                            onMove(f.id);
                            close();
                          }}
                        >
                          <Folder />
                          <span className="truncate">{f.name}</span>
                        </DropdownItem>
                      ))}
                  </>
                )}
                <DropdownItem
                  onClick={() => {
                    onArchive();
                    close();
                  }}
                >
                  {c.archived ? <ArchiveRestore /> : <Archive />}
                  {c.archived ? t('sidebar.unarchive') : t('sidebar.archive')}
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
