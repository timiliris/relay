import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  ChevronRight,
  ExternalLink,
  File,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderTree,
  MessageSquarePlus,
  RefreshCw,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { agentCommands, type FileEntry } from '@/lib/agent/commands';
import type { Conversation } from '@/lib/db';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { dialog } from '@/stores/dialog';
import { useExplorer } from '@/stores/explorer';
import { toast } from '@/stores/toast';
import { Button } from './ui/button';
import { IconButton } from './ui/tooltip-button';
import { workspaceName } from './workspace-picker';

const ROOT = '.';
/** Au-delà, le fichier est affiché en lecture seule (la relecture Rust est plafonnée à 200 Ko). */
const MAX_EDIT_LINES = 20_000;

interface OpenFile {
  path: string;
  content: string;
  readOnly: boolean;
  totalLines: number;
}

const parentOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? ROOT : path.slice(0, i);
};

/** Volet latéral : arborescence du dossier de travail, lecture et édition manuelle des fichiers. */
export function WorkspaceExplorer({
  conversation,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inTauri = isTauri();
  const workspace = conversation.workspace ?? '';
  const version = useExplorer((s) => s.version);
  const pendingPath = useExplorer((s) => s.pendingPath);
  const consumePending = useExplorer((s) => s.consumePending);

  const [dirs, setDirs] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT]));
  const [file, setFile] = useState<OpenFile | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = file !== null && draft !== file.content;

  const loadDir = useCallback(
    async (dir: string) => {
      if (!inTauri) return;
      try {
        const result = await agentCommands.listFiles(workspace, dir, 1);
        setDirs((d) => ({ ...d, [dir]: result.entries }));
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [inTauri, workspace],
  );

  const openFile = useCallback(
    async (path: string) => {
      if (!inTauri) return;
      setBusy(true);
      try {
        const result = await agentCommands.readFile(workspace, path, 1, MAX_EDIT_LINES);
        const next: OpenFile = {
          path,
          content: result.content,
          readOnly: result.truncated,
          totalLines: result.totalLines,
        };
        setFile(next);
        setDraft(next.content);
        setError(null);
      } catch (err) {
        setFile(null);
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [inTauri, workspace],
  );

  // Dossiers dépliés rechargés à l'ouverture, au changement de dossier et après chaque écriture de l'agent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` est le signal de rafraîchissement
  useEffect(() => {
    for (const dir of expanded) void loadDir(dir);
    if (file && !dirty) void openFile(file.path);
  }, [version, workspace, loadDir]);

  // Fichier demandé depuis une carte d'outil : on déplie ses parents et on l'ouvre.
  useEffect(() => {
    if (!pendingPath) return;
    const parents: string[] = [];
    let p = parentOf(pendingPath);
    while (p !== ROOT) {
      parents.push(p);
      p = parentOf(p);
    }
    setExpanded((set) => new Set([...set, ROOT, ...parents]));
    for (const dir of parents) void loadDir(dir);
    void openFile(pendingPath);
    consumePending();
  }, [pendingPath, consumePending, loadDir, openFile]);

  const toggleDir = (dir: string) => {
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(dir)) next.delete(dir);
      else {
        next.add(dir);
        if (!dirs[dir]) void loadDir(dir);
      }
      return next;
    });
  };

  const selectFile = async (path: string) => {
    if (dirty && !(await confirmDiscard())) return;
    await openFile(path);
  };

  const confirmDiscard = () =>
    dialog.confirm({
      title: t('chat.explorer.unsavedTitle'),
      message: t('chat.explorer.unsavedBody'),
      confirmLabel: t('chat.explorer.discard'),
      destructive: true,
    });

  const save = async () => {
    if (!file || file.readOnly) return;
    setBusy(true);
    try {
      await agentCommands.applyChange(workspace, file.path, { kind: 'write', content: draft });
      setFile({ ...file, content: draft });
      toast.success(t('chat.explorer.saved', { name: file.path }));
      void loadDir(parentOf(file.path));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const createFile = async () => {
    const path = await dialog.prompt({
      title: t('chat.explorer.newFile'),
      message: t('chat.explorer.newFileBody'),
      placeholder: 'docs/notes.md',
    });
    const rel = path
      ?.trim()
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '');
    if (!rel) return;
    try {
      await agentCommands.applyChange(workspace, rel, { kind: 'write', content: '' });
      useExplorer.getState().refresh();
      useExplorer.getState().openFile(rel);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const reveal = async () => {
    const sep = workspace.includes('\\') ? '\\' : '/';
    const target = file ? `${workspace}${sep}${file.path.replace(/\//g, sep)}` : workspace;
    try {
      await revealItemInDir(target);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onEditorKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Tab') {
      // Tabulation : deux espaces, sans quitter l'éditeur.
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart, selectionEnd } = el;
      const next = `${draft.slice(0, selectionStart)}  ${draft.slice(selectionEnd)}`;
      setDraft(next);
      requestAnimationFrame(() => el.setSelectionRange(selectionStart + 2, selectionStart + 2));
    }
  };

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l bg-card/40 sm:w-96 lg:w-[28rem]"
      aria-label={t('chat.explorer.title')}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <FolderTree className="size-4 text-chart-3" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={workspace}>
          {workspaceName(workspace)}
        </h2>
        <IconButton
          label={t('chat.explorer.newFile')}
          className="size-7"
          disabled={!inTauri}
          onClick={() => void createFile()}
        >
          <FilePlus2 className="size-4" />
        </IconButton>
        <IconButton
          label={t('chat.explorer.reveal')}
          className="size-7"
          disabled={!inTauri}
          onClick={() => void reveal()}
        >
          <ExternalLink className="size-4" />
        </IconButton>
        <IconButton
          label={t('chat.explorer.refresh')}
          className="size-7"
          disabled={!inTauri}
          onClick={() => useExplorer.getState().refresh()}
        >
          <RefreshCw className="size-4" />
        </IconButton>
        <IconButton label={t('common.close')} className="size-7" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      {!inTauri && (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t('common.onlyInApp')}</p>
      )}
      {error && <p className="px-3 py-2 text-xs text-destructive">{error}</p>}

      <div className={cn('overflow-y-auto border-b', file ? 'max-h-[40%]' : 'flex-1')}>
        <Tree
          dir={ROOT}
          depth={0}
          dirs={dirs}
          expanded={expanded}
          selected={file?.path ?? null}
          onToggle={toggleDir}
          onSelect={(path) => void selectFile(path)}
        />
      </div>

      {file && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
            <File className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
              {file.path}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {t('chat.explorer.lines', { count: file.totalLines })}
            </span>
            {dirty && (
              <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-warning">
                {t('chat.explorer.unsaved')}
              </span>
            )}
          </div>
          {file.readOnly && (
            <p className="border-b bg-warning/10 px-3 py-1 text-xs text-warning">
              {t('chat.explorer.readOnly')}
            </p>
          )}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onEditorKey}
            readOnly={file.readOnly || busy}
            spellCheck={false}
            aria-label={file.path}
            className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 font-mono text-xs leading-relaxed outline-none"
          />
          <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty || busy}
              onClick={() => setDraft(file.content)}
            >
              <RotateCcw />
              {t('chat.explorer.revert')}
            </Button>
            <Button
              size="sm"
              disabled={!dirty || busy || file.readOnly}
              onClick={() => void save()}
            >
              <Save />
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}

function Tree({
  dir,
  depth,
  dirs,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  dir: string;
  depth: number;
  dirs: Record<string, FileEntry[]>;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (dir: string) => void;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();
  const requestAttach = useExplorer((s) => s.requestAttach);
  const entries = dirs[dir];
  if (!entries) return null;
  if (entries.length === 0 && depth === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{t('chat.explorer.empty')}</p>;
  }
  return (
    <ul className={cn(depth === 0 && 'py-1')}>
      {entries.map((entry) => {
        const open = expanded.has(entry.path);
        const name = entry.path.split('/').pop() ?? entry.path;
        return (
          <li key={entry.path}>
            {entry.kind === 'dir' ? (
              <>
                <TreeRow depth={depth} onClick={() => onToggle(entry.path)} aria-expanded={open}>
                  <ChevronRight
                    className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
                    aria-hidden="true"
                  />
                  {open ? (
                    <FolderOpen className="size-3.5 shrink-0 text-chart-3" aria-hidden="true" />
                  ) : (
                    <Folder className="size-3.5 shrink-0 text-chart-3" aria-hidden="true" />
                  )}
                  <span className="truncate">{name}</span>
                </TreeRow>
                {open && (
                  <Tree
                    dir={entry.path}
                    depth={depth + 1}
                    dirs={dirs}
                    expanded={expanded}
                    selected={selected}
                    onToggle={onToggle}
                    onSelect={onSelect}
                  />
                )}
              </>
            ) : (
              <div className="group/row relative">
                <TreeRow
                  depth={depth}
                  selected={selected === entry.path}
                  onClick={() => onSelect(entry.path)}
                  className="pr-8"
                >
                  <span className="size-3.5 shrink-0" aria-hidden="true" />
                  <File className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{name}</span>
                </TreeRow>
                {/* Visible au survol ou au focus : joint le fichier au message en cours. */}
                <IconButton
                  label={t('chat.mention.attach')}
                  className="absolute top-1/2 right-1 size-6 -translate-y-1/2 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                  onClick={() => requestAttach(entry.path, entry.size)}
                >
                  <MessageSquarePlus className="size-3.5" />
                </IconButton>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TreeRow({
  depth,
  selected,
  className,
  children,
  ...props
}: React.ComponentProps<'button'> & { depth: number; selected?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs hover:bg-accent/60',
        selected && 'bg-accent font-medium',
        className,
      )}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      {...props}
    >
      {children}
    </button>
  );
}

export const useExplorerDirtyGuard = () => useRef(false);
