import {
  Check,
  ChevronDown,
  Copy,
  FilePen,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderTree,
  Globe,
  Keyboard,
  type LucideIcon,
  MousePointerClick,
  Navigation,
  ScanText,
  Search,
  ShieldAlert,
  SquareCode,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolStatus } from '@/lib/agent/types';
import type { Message } from '@/lib/db';
import type { ToolCall } from '@/lib/openrouter';
import { cn } from '@/lib/utils';
import { useAgent } from '@/stores/agent';
import { useExplorer } from '@/stores/explorer';
import { AgentStatusBar, useAgentStatus } from './agent-status';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';

const ICONS: Record<string, LucideIcon> = {
  list_files: FolderTree,
  read_file: FileText,
  write_file: FilePlus2,
  edit_file: FilePen,
  search_files: Search,
  run_command: Terminal,
  fetch_url: Globe,
  browser_navigate: Navigation,
  browser_read: ScanText,
  browser_click: MousePointerClick,
  browser_type: Keyboard,
  browser_eval: SquareCode,
};

const STATUS_CLASS: Record<ToolStatus, string> = {
  pending: 'border-warning/50 bg-warning/10 text-warning',
  running: 'border-info/50 bg-info/10 text-info',
  done: 'border-success/40 bg-success/10 text-success',
  denied: 'border-border bg-muted text-muted-foreground',
  cancelled: 'border-border bg-muted text-muted-foreground',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
};

/** Au-delà de ce nombre de lignes, un diff est replié derrière « Tout afficher ». */
export const DIFF_FOLD_LINES = 40;

type NameKey =
  | 'fetch_url'
  | 'list_files'
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'search_files'
  | 'run_command'
  | 'browser_navigate'
  | 'browser_read'
  | 'browser_click'
  | 'browser_type'
  | 'browser_eval'
  | 'unknown';

const nameKey = (name: string | null | undefined): NameKey =>
  name && name in ICONS ? (name as NameKey) : 'unknown';

/** Nom de l'argument principal de chaque outil (affiché à côté du titre, masqué de la ligne d'arguments). */
const PRIMARY_ARG: Record<NameKey, string> = {
  run_command: 'command',
  search_files: 'pattern',
  fetch_url: 'url',
  browser_navigate: 'url',
  browser_read: 'selector',
  browser_click: 'target',
  browser_type: 'target',
  browser_eval: 'script',
  list_files: 'path',
  read_file: 'path',
  write_file: 'path',
  edit_file: 'path',
  unknown: 'path',
};

/** Argument principal affiché sous le titre : chemin, motif, commande, cible ou script. */
function primaryArg(name: string | null | undefined, args: Record<string, unknown>): string {
  const key = nameKey(name);
  const value = args[PRIMARY_ARG[key]];
  if (value === undefined || value === null) return key === 'list_files' ? '.' : '';
  const text = String(value);
  // Un script tient sur une ligne dans l'en-tête ; le détail reste dans la sortie.
  return key === 'browser_eval' ? (text.split('\n')[0] ?? '') : text;
}

/** Lignes ajoutées et supprimées d'un diff unifié (les en-têtes `+++`/`---` exclus). */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

/** Carte d'un message `tool` : outil, argument, état, détail repliable, approbation. */
export function ToolCallCard({ message }: { message: Message }) {
  const { t } = useTranslation();
  const awaiting = useAgent((s) => s.pending.some((p) => p.toolMessageId === message.id));
  const progress = useAgentStatus(message.conversationId);
  const meta = message.toolMeta ?? { args: {}, status: 'done' as const, risk: 'read' as const };
  const status: ToolStatus = awaiting ? 'pending' : meta.status;
  const key = nameKey(message.toolName);
  const Icon = ICONS[key] ?? Wrench;
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? (status === 'pending' || status === 'running' || status === 'error');
  const isDiff = key === 'write_file' || key === 'edit_file';
  const isCommand = key === 'run_command';
  const body = isDiff && meta.diff ? meta.diff : message.content;
  const path = typeof meta.args.path === 'string' ? meta.args.path : '';

  return (
    <div
      className={cn(
        'ml-10 overflow-hidden rounded-lg border bg-card text-sm shadow-xs transition-colors',
        status === 'pending' && 'border-warning/60',
        status === 'error' && 'border-destructive/50',
      )}
      role="group"
      aria-label={t(`chat.tools.names.${key}`)}
    >
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent/40"
        aria-expanded={expanded}
      >
        <Icon
          className={cn(
            'size-4 shrink-0',
            status === 'running' ? 'animate-pulse text-info' : 'text-muted-foreground',
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{t(`chat.tools.names.${key}`)}</span>
          {primaryArg(message.toolName, meta.args) && (
            <code className="ml-2 truncate font-mono text-xs text-muted-foreground">
              {primaryArg(message.toolName, meta.args)}
            </code>
          )}
        </span>
        <Badge className={cn('gap-1 px-1.5 font-sans', STATUS_CLASS[status])}>
          {status === 'running' && (
            <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
          )}
          {t(`chat.tools.status.${status}`)}
        </Badge>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {/* Suivi de la boucle, rendu dans la carte de l'outil en attente ou en cours. */}
      {progress?.toolMessageId === message.id && (
        <AgentStatusBar conversationId={message.conversationId} className="border-t" />
      )}

      {expanded && (
        <div className="border-t">
          {status === 'pending' && <Approval message={message} risk={meta.risk} name={key} />}
          <ArgsLine name={key} args={meta.args} />
          {isCommand && status === 'pending' && (
            <CommandPreview command={String(meta.args.command ?? '')} cwd={meta.cwd} />
          )}
          {(key === 'read_file' || isDiff) && path && status === 'done' && (
            <div className="flex justify-end border-b px-3 py-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs text-muted-foreground"
                onClick={() => useExplorer.getState().openFile(path)}
              >
                <FolderOpen />
                {t('chat.explorer.openFile')}
              </Button>
            </div>
          )}
          {body ? (
            isDiff ? (
              <DiffView diff={body} path={path} created={meta.created} />
            ) : (
              <Output text={body} copyable={isCommand} />
            )
          ) : (
            status !== 'pending' &&
            status !== 'running' && (
              <p className="px-3 py-2 text-xs text-muted-foreground">{t('chat.tools.noOutput')}</p>
            )
          )}
          <Footer meta={meta} />
        </div>
      )}
    </div>
  );
}

/** Zone d'approbation : Autoriser / Toujours / Refuser, avec motif de refus facultatif. */
function Approval({
  message,
  risk,
  name,
}: {
  message: Message;
  risk: 'read' | 'write';
  name: NameKey;
}) {
  const { t } = useTranslation();
  const decide = useAgent((s) => s.decide);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const deny = () => decide(message.id, 'deny', reason);
  const riskKey =
    risk !== 'write'
      ? 'chat.tools.riskRead'
      : name.startsWith('browser_')
        ? 'chat.tools.riskBrowser'
        : 'chat.tools.riskWrite';

  return (
    <div className="border-b bg-warning/5">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">{t(riskKey)}</span>
        <Button size="sm" className="h-7" onClick={() => decide(message.id, 'allow')}>
          <Check />
          {t('chat.tools.allow')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => decide(message.id, 'allowAlways')}
        >
          {t('chat.tools.allowAlways')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-destructive hover:text-destructive"
          aria-expanded={denying}
          onClick={() => (denying ? deny() : setDenying(true))}
        >
          <X />
          {t('chat.tools.deny')}
        </Button>
      </div>
      {denying && (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-warning/20 px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            deny();
          }}
        >
          <label className="text-xs text-muted-foreground" htmlFor={`deny-reason-${message.id}`}>
            {t('chat.toolsPreview.reasonLabel')}
          </label>
          <Input
            id={`deny-reason-${message.id}`}
            autoFocus
            className="h-7 min-w-40 flex-1 text-xs"
            maxLength={300}
            placeholder={t('chat.toolsPreview.reasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDenying(false);
            }}
          />
          <Button size="sm" variant="destructive" className="h-7" type="submit">
            <X />
            {t('chat.toolsPreview.confirmDeny')}
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setDenying(false)}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
    </div>
  );
}

/** Commande en attente : ligne complète et dossier d'exécution. */
function CommandPreview({ command, cwd }: { command: string; cwd?: string | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="border-b px-3 py-2">
      <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
        <span className="select-none text-muted-foreground">$ </span>
        {command}
      </pre>
      {cwd && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground" title={cwd}>
          {t('chat.toolsPreview.runIn', { cwd })}
        </p>
      )}
    </div>
  );
}

/** Sortie brute (commande, lecture, recherche), avec action « Copier » pour les commandes. */
function Output({ text, copyable }: { text: string; copyable: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // presse-papiers indisponible
    }
  };
  return (
    <div className="relative">
      {copyable && (
        <Button
          size="sm"
          variant="ghost"
          className="absolute top-1 right-2 h-6 bg-card/80 px-1.5 text-[11px] text-muted-foreground backdrop-blur-sm"
          onClick={copy}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      )}
      <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

/** Arguments secondaires (hors argument principal), compacts. */
function ArgsLine({ name, args }: { name: NameKey; args: Record<string, unknown> }) {
  const hidden = new Set(
    name === 'write_file' || name === 'edit_file'
      ? ['path', 'content', 'old', 'new']
      : [PRIMARY_ARG[name]],
  );
  const rest = Object.entries(args).filter(([k, v]) => !hidden.has(k) && v !== undefined);
  if (rest.length === 0) return null;
  return (
    <p className="truncate border-b px-3 py-1 font-mono text-[11px] text-muted-foreground">
      {rest.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ')}
    </p>
  );
}

function Footer({ meta }: { meta: NonNullable<Message['toolMeta']> }) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (meta.exitCode !== undefined && meta.exitCode !== null) {
    parts.push(t('chat.tools.exitCode', { code: meta.exitCode }));
  }
  if (meta.timedOut) parts.push(t('chat.tools.timedOut'));
  if (meta.truncated) parts.push(t('chat.tools.truncated'));
  if (meta.durationMs !== undefined) parts.push(`${(meta.durationMs / 1000).toFixed(1)} s`);
  if (meta.error) parts.push(meta.error);
  if (parts.length === 0) return null;
  return (
    <p
      className={cn(
        'border-t px-3 py-1 text-[11px] text-muted-foreground',
        meta.error && 'text-destructive',
      )}
    >
      {parts.join(' · ')}
    </p>
  );
}

/** Diff unifié coloré ligne par ligne, avec compteur, nom du fichier et repli au-delà de 40 lignes. */
function DiffView({
  diff,
  path,
  created,
}: {
  diff: string;
  path?: string | undefined;
  created?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const lines = diff.split('\n');
  const { added, removed } = diffStats(diff);
  const folded = !showAll && lines.length > DIFF_FOLD_LINES;
  const visible = folded ? lines.slice(0, DIFF_FOLD_LINES) : lines;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-1 text-[11px]">
        {path && <code className="truncate font-mono text-foreground">{path}</code>}
        {created && (
          <Badge className="px-1.5 font-sans border-success/40 bg-success/10 text-success">
            {t('chat.toolsPreview.newFile')}
          </Badge>
        )}
        <span className="ml-auto font-mono tabular-nums">
          <span className="text-success">+{added}</span>{' '}
          <span className="text-destructive">−{removed}</span>{' '}
          <span className="text-muted-foreground">
            {t('chat.toolsPreview.lines', { count: added + removed })}
          </span>
        </span>
      </div>
      <pre className="max-h-[32rem] overflow-auto px-0 py-1 font-mono text-xs leading-relaxed">
        {visible.map((line, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: lignes d'un diff statique
            key={i}
            className={cn(
              'px-3 whitespace-pre-wrap',
              line.startsWith('+') && !line.startsWith('+++') && 'bg-success/10 text-success',
              line.startsWith('-') &&
                !line.startsWith('---') &&
                'bg-destructive/10 text-destructive',
              line.startsWith('@@') && 'text-info',
              (line.startsWith('+++') || line.startsWith('---')) && 'text-muted-foreground',
            )}
          >
            {line || ' '}
          </div>
        ))}
      </pre>
      {lines.length > DIFF_FOLD_LINES && (
        <div className="flex justify-center border-t bg-muted/30 py-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-muted-foreground"
            onClick={() => setShowAll(!showAll)}
            aria-expanded={showAll}
          >
            <ChevronDown className={cn('size-3.5 transition-transform', showAll && 'rotate-180')} />
            {showAll
              ? t('chat.toolsPreview.collapse')
              : t('chat.toolsPreview.showAll', { count: lines.length - DIFF_FOLD_LINES })}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Résumé des appels demandés par un message assistant (les cartes détaillées suivent). */
export function ToolCallList({ calls, streaming }: { calls: ToolCall[]; streaming: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="my-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Wrench className="size-3.5" aria-hidden="true" />
      <span>{t('chat.tools.summary', { count: calls.length })}</span>
      {calls.map((call) => {
        const key = nameKey(call.name);
        const Icon = ICONS[key] ?? Wrench;
        return (
          <Badge
            key={call.id}
            className={cn(
              'gap-1 px-1.5 font-sans',
              streaming && !call.arguments && 'animate-pulse border-info/40 text-info',
            )}
          >
            <Icon className="size-3" aria-hidden="true" />
            {t(`chat.tools.names.${key}`)}
          </Badge>
        );
      })}
    </div>
  );
}
