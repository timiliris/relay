import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  History,
  RefreshCw,
  X,
} from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type GitFile, type GitFileStatus, gitCommands } from '@/lib/agent/commands';
import type { Conversation } from '@/lib/db';
import { devFixturesEnabled } from '@/lib/dev-fixtures';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useExplorer } from '@/stores/explorer';
import { demoDiff, demoSnapshot, type GitSnapshot, groupFiles, useGit } from '@/stores/git';
import { toast } from '@/stores/toast';
import { Button } from './ui/button';
import { Dropdown, DropdownItem } from './ui/dropdown';
import { IconButton } from './ui/tooltip-button';

const EMPTY_SNAPSHOT: GitSnapshot = {
  repo: true,
  status: null,
  log: [],
  branches: [],
  loading: false,
  error: null,
};

/** Lettre et couleur d'un statut de fichier, comme dans les éditeurs. */
const STATUS_BADGE: Record<GitFileStatus, { letter: string; className: string }> = {
  modified: { letter: 'M', className: 'text-warning' },
  added: { letter: 'A', className: 'text-success' },
  deleted: { letter: 'D', className: 'text-destructive' },
  renamed: { letter: 'R', className: 'text-info' },
  untracked: { letter: 'U', className: 'text-muted-foreground' },
  conflicted: { letter: '!', className: 'text-destructive' },
};

interface OpenDiff {
  file: GitFile;
  text: string;
  truncated: boolean;
}

/** Date relative courte (« il y a 3 h »), dans la langue de l'interface. */
function relativeDate(iso: string, language: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'narrow' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, seconds] of steps) {
    if (Math.abs(diff) >= seconds) return rtf.format(Math.round(diff / seconds), unit);
  }
  return rtf.format(0, 'minute');
}

/** Volet latéral : état Git du dossier de travail, indexation, commit et historique. */
export function GitPanel({
  conversation,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const inTauri = isTauri();
  const demo = !inTauri && devFixturesEnabled();
  const workspace = conversation.workspace ?? '';
  const conversationId = conversation.id;
  const version = useExplorer((s) => s.version);
  const live = useGit((s) => s.snapshots[conversationId]);
  const refresh = useGit((s) => s.refresh);
  const demoData = useMemo(() => (demo ? demoSnapshot() : null), [demo]);
  const snapshot = live ?? demoData ?? EMPTY_SNAPSHOT;
  const { repo, status, log, branches, loading, error } = snapshot;

  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<OpenDiff | null>(null);

  const groups = useMemo(() => groupFiles(status?.files ?? []), [status]);

  // Rechargé à l'ouverture, au changement de dossier et après chaque écriture de l'agent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` est le signal de rafraîchissement
  useEffect(() => {
    void refresh(conversationId, workspace);
  }, [version, conversationId, workspace, refresh]);

  const guard = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openDiff = useCallback(
    async (file: GitFile) => {
      if (demo) {
        setDiff({ file, text: demoDiff(file.path), truncated: false });
        return;
      }
      if (!inTauri) return;
      try {
        const result = await gitCommands.diff(workspace, file.path, file.staged);
        setDiff({ file, text: result.diff, truncated: result.truncated });
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    [demo, inTauri, workspace],
  );

  // Le diff ouvert suit les écritures de l'agent et disparaît avec son fichier.
  // biome-ignore lint/correctness/useExhaustiveDependencies: relecture déclenchée par `version` et `status`
  useEffect(() => {
    if (!diff || !status) return;
    const still = status.files.find(
      (f) => f.path === diff.file.path && f.staged === diff.file.staged,
    );
    if (still) void openDiff(still);
    else setDiff(null);
  }, [version, status]);

  const stage = (files: GitFile[], stage: boolean) =>
    guard(async () => {
      if (files.length === 0) return;
      await useGit.getState().stage(
        conversationId,
        workspace,
        files.map((f) => f.path),
        stage,
      );
    })();

  const commit = guard(async () => {
    const text = message.trim();
    if (!text || groups.staged.length === 0) return;
    const summary = await useGit.getState().commit(conversationId, workspace, text);
    setMessage('');
    toast.success(t('chat.git.committed', { summary }));
  });

  const checkout = (branch: string) =>
    guard(async () => {
      await useGit.getState().checkout(conversationId, workspace, branch);
    })();

  const init = guard(async () => {
    await useGit.getState().init(conversationId, workspace);
    toast.success(t('chat.git.initialized'));
  });

  const onMessageKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void commit();
    }
  };

  const canAct = (inTauri || demo) && !busy;
  const canCommit = canAct && groups.staged.length > 0 && message.trim().length > 0;
  const language = i18n.resolvedLanguage ?? i18n.language;

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l bg-card/40 sm:w-96 lg:w-[28rem]"
      aria-label={t('chat.git.title')}
    >
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-3">
        <GitBranch className="size-4 shrink-0 text-chart-2" aria-hidden="true" />
        {repo && status ? (
          <>
            <Dropdown
              align="start"
              trigger={({ open, toggle }) => (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn('min-w-0 gap-1 px-1.5', open && 'bg-accent')}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  title={t('chat.git.switchBranch')}
                  disabled={!canAct}
                  onClick={toggle}
                >
                  <span className="truncate font-mono text-xs">{status.branch}</span>
                  {status.detached && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {t('chat.git.detached')}
                    </span>
                  )}
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t('chat.git.switchBranch')}
                  </p>
                  {branches.length === 0 && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t('chat.git.noBranches')}
                    </p>
                  )}
                  {branches.map((b) => (
                    <DropdownItem
                      key={b.name}
                      disabled={b.current}
                      className="font-mono text-xs"
                      onClick={() => {
                        close();
                        void checkout(b.name);
                      }}
                    >
                      <Check className={cn(!b.current && 'invisible')} />
                      <span className="truncate">{b.name}</span>
                    </DropdownItem>
                  ))}
                </>
              )}
            </Dropdown>
            <span
              className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground"
              title={
                status.upstream
                  ? t('chat.git.upstream', { name: status.upstream })
                  : t('chat.git.noUpstream')
              }
            >
              {status.upstream ? (
                <>
                  <span className={cn('flex items-center', status.ahead > 0 && 'text-success')}>
                    <ArrowUp className="size-3" aria-hidden="true" />
                    <span aria-hidden="true">{status.ahead}</span>
                    <span className="sr-only">{t('chat.git.ahead', { count: status.ahead })}</span>
                  </span>
                  <span className={cn('flex items-center', status.behind > 0 && 'text-warning')}>
                    <ArrowDown className="size-3" aria-hidden="true" />
                    <span aria-hidden="true">{status.behind}</span>
                    <span className="sr-only">
                      {t('chat.git.behind', { count: status.behind })}
                    </span>
                  </span>
                </>
              ) : (
                <span>{t('chat.git.local')}</span>
              )}
            </span>
          </>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{t('chat.git.title')}</h2>
        )}
        <span className="flex-1" />
        <IconButton
          label={t('chat.git.refresh')}
          className="size-7"
          disabled={!inTauri || loading}
          onClick={() => void refresh(conversationId, workspace)}
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </IconButton>
        <IconButton label={t('common.close')} className="size-7" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      {!inTauri && (
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">{t('common.onlyInApp')}</p>
      )}
      {error && <p className="border-b px-3 py-2 text-xs text-destructive">{error}</p>}

      {!repo ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <GitBranch className="size-8 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t('chat.git.notRepo')}</p>
          <Button size="sm" disabled={!canAct} onClick={() => void init()}>
            {t('chat.git.init')}
          </Button>
        </div>
      ) : (
        <>
          <div className={cn('min-h-0 overflow-y-auto', diff ? 'flex-1 basis-0' : 'flex-1')}>
            {status && status.files.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground">{t('chat.git.clean')}</p>
            )}
            <FileGroup
              title={t('chat.git.staged')}
              files={groups.staged}
              staged
              selected={diff?.file ?? null}
              disabled={!canAct}
              actionLabel={t('chat.git.unstageAll')}
              onAction={() => void stage(groups.staged, false)}
              onToggle={(file) => void stage([file], false)}
              onSelect={(file) => void openDiff(file)}
            />
            <FileGroup
              title={t('chat.git.changes')}
              files={groups.changes}
              selected={diff?.file ?? null}
              disabled={!canAct}
              actionLabel={t('chat.git.stageAll')}
              onAction={() => void stage(groups.changes, true)}
              onToggle={(file) => void stage([file], true)}
              onSelect={(file) => void openDiff(file)}
            />
            <FileGroup
              title={t('chat.git.untracked')}
              files={groups.untracked}
              selected={diff?.file ?? null}
              disabled={!canAct}
              actionLabel={t('chat.git.stageAll')}
              onAction={() => void stage(groups.untracked, true)}
              onToggle={(file) => void stage([file], true)}
              onSelect={(file) => void openDiff(file)}
            />

            <div className="border-t px-3 py-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={onMessageKey}
                placeholder={t('chat.git.messagePlaceholder')}
                aria-label={t('chat.git.message')}
                disabled={!canAct}
                rows={3}
                spellCheck={false}
                className="w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {groups.staged.length === 0
                    ? t('chat.git.stagedNone')
                    : t('chat.git.stagedCount', { count: groups.staged.length })}
                </span>
                <Button size="sm" disabled={!canCommit} onClick={() => void commit()}>
                  <GitCommitHorizontal />
                  {t('chat.git.commit')}
                </Button>
              </div>
            </div>

            <section className="border-t" aria-label={t('chat.git.history')}>
              <h3 className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <History className="size-3.5" aria-hidden="true" />
                {t('chat.git.history')}
              </h3>
              {log.length === 0 ? (
                <p className="px-3 pb-3 text-xs text-muted-foreground">{t('chat.git.noHistory')}</p>
              ) : (
                <ol className="pb-2">
                  {log.map((entry) => (
                    <li
                      key={entry.hash}
                      className="flex items-baseline gap-2 px-3 py-1 text-xs"
                      title={`${entry.hash}\n${entry.author} · ${new Date(entry.date).toLocaleString(language)}`}
                    >
                      <span className="shrink-0 font-mono text-chart-2">{entry.short}</span>
                      <span className="min-w-0 flex-1 truncate">{entry.subject}</span>
                      <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                        {relativeDate(entry.date, language)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          {diff && (
            <div className="flex min-h-0 flex-1 basis-0 flex-col border-t">
              <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
                <StatusLetter file={diff.file} />
                <span className="min-w-0 flex-1 truncate font-mono" title={diff.file.path}>
                  {diff.file.path}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5',
                    diff.file.staged
                      ? 'bg-success/15 text-success'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {diff.file.staged ? t('chat.git.inIndex') : t('chat.git.inWorktree')}
                </span>
                <IconButton
                  label={t('chat.git.closeDiff')}
                  className="size-6"
                  onClick={() => setDiff(null)}
                >
                  <X className="size-3.5" />
                </IconButton>
              </div>
              {diff.truncated && (
                <p className="border-b bg-warning/10 px-3 py-1 text-xs text-warning">
                  {t('chat.git.diffTruncated')}
                </p>
              )}
              <DiffView text={diff.text} />
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function FileGroup({
  title,
  files,
  staged = false,
  selected,
  disabled,
  actionLabel,
  onAction,
  onToggle,
  onSelect,
}: {
  title: string;
  files: GitFile[];
  staged?: boolean;
  selected: GitFile | null;
  disabled: boolean;
  actionLabel: string;
  onAction: () => void;
  onToggle: (file: GitFile) => void;
  onSelect: (file: GitFile) => void;
}) {
  const { t } = useTranslation();
  if (files.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] tabular-nums">
          {files.length}
        </span>
        <button
          type="button"
          className="ml-auto normal-case tracking-normal hover:text-foreground hover:underline disabled:opacity-50"
          disabled={disabled}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      </h3>
      <ul>
        {files.map((file) => {
          const isSelected =
            selected !== null && selected.path === file.path && selected.staged === file.staged;
          const slash = file.path.lastIndexOf('/');
          const dir = slash === -1 ? '' : file.path.slice(0, slash + 1);
          const name = slash === -1 ? file.path : file.path.slice(slash + 1);
          return (
            <li
              key={`${file.staged}:${file.path}`}
              className={cn(
                'flex items-center gap-2 px-3 py-0.5 text-xs hover:bg-accent/60',
                isSelected && 'bg-accent',
              )}
            >
              <input
                type="checkbox"
                className="size-3.5 shrink-0 accent-chart-2"
                checked={staged}
                disabled={disabled}
                aria-label={staged ? t('chat.git.unstage') : t('chat.git.stage')}
                onChange={() => onToggle(file)}
              />
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
                title={
                  file.status === 'renamed' && file.origPath
                    ? t('chat.git.status.renamed', { from: file.origPath })
                    : t(`chat.git.status.${file.status}`)
                }
                onClick={() => onSelect(file)}
              >
                <span className="min-w-0 flex-1 truncate font-mono">
                  <span className="text-muted-foreground">{dir}</span>
                  <span className={cn(file.status === 'deleted' && 'line-through')}>{name}</span>
                </span>
                <StatusLetter file={file} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StatusLetter({ file }: { file: GitFile }) {
  const badge = STATUS_BADGE[file.status];
  return (
    <span className={cn('w-3 shrink-0 text-center font-mono font-semibold', badge.className)}>
      {badge.letter}
    </span>
  );
}

/** Diff unifié coloré : ajouts, suppressions, en-têtes de section. */
function DiffView({ text }: { text: string }) {
  const { t } = useTranslation();
  const lines = text.replace(/\n$/, '').split('\n');
  if (text.trim() === '') {
    return <p className="px-3 py-3 text-xs text-muted-foreground">{t('chat.git.diffEmpty')}</p>;
  }
  return (
    <pre className="min-h-0 flex-1 overflow-auto py-1 font-mono text-xs leading-relaxed">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lignes d'un texte figé, sans identité propre
        <div key={i} className={cn('whitespace-pre px-3', diffLineClass(line))}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith('@@')) return 'text-info';
  if (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename ') ||
    line.startsWith('Binary files')
  ) {
    return 'text-muted-foreground';
  }
  if (line.startsWith('+')) return 'bg-success/10 text-success';
  if (line.startsWith('-')) return 'bg-destructive/10 text-destructive';
  return '';
}
