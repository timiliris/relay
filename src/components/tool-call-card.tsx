import {
  Check,
  ChevronDown,
  FilePen,
  FilePlus2,
  FileText,
  FolderTree,
  type LucideIcon,
  Search,
  ShieldAlert,
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
import { Badge } from './ui/badge';
import { Button } from './ui/button';

const ICONS: Record<string, LucideIcon> = {
  list_files: FolderTree,
  read_file: FileText,
  write_file: FilePlus2,
  edit_file: FilePen,
  search_files: Search,
  run_command: Terminal,
};

const STATUS_CLASS: Record<ToolStatus, string> = {
  pending: 'border-warning/50 bg-warning/10 text-warning',
  running: 'border-info/50 bg-info/10 text-info',
  done: 'border-success/40 bg-success/10 text-success',
  denied: 'border-border bg-muted text-muted-foreground',
  cancelled: 'border-border bg-muted text-muted-foreground',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
};

type NameKey =
  | 'list_files'
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'search_files'
  | 'run_command'
  | 'unknown';

const nameKey = (name: string | null | undefined): NameKey =>
  name && name in ICONS ? (name as NameKey) : 'unknown';

/** Argument principal affiché sous le titre : chemin, motif ou commande. */
function primaryArg(name: string | null | undefined, args: Record<string, unknown>): string {
  switch (name) {
    case 'run_command':
      return String(args.command ?? '');
    case 'search_files':
      return String(args.pattern ?? '');
    case 'list_files':
      return String(args.path ?? '.');
    default:
      return String(args.path ?? '');
  }
}

/** Carte d'un message `tool` : outil, argument, état, détail repliable, approbation. */
export function ToolCallCard({ message }: { message: Message }) {
  const { t } = useTranslation();
  const decide = useAgent((s) => s.decide);
  const awaiting = useAgent((s) => s.pending.some((p) => p.toolMessageId === message.id));
  const meta = message.toolMeta ?? { args: {}, status: 'done' as const, risk: 'read' as const };
  const status: ToolStatus = awaiting ? 'pending' : meta.status;
  const key = nameKey(message.toolName);
  const Icon = ICONS[key] ?? Wrench;
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? (status === 'pending' || status === 'running' || status === 'error');
  const isDiff = key === 'write_file' || key === 'edit_file';
  const body = isDiff && meta.diff ? meta.diff : message.content;

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

      {expanded && (
        <div className="border-t">
          {status === 'pending' && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-warning/5 px-3 py-2">
              <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {t(meta.risk === 'write' ? 'chat.tools.riskWrite' : 'chat.tools.riskRead')}
              </span>
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
                onClick={() => decide(message.id, 'deny')}
              >
                <X />
                {t('chat.tools.deny')}
              </Button>
            </div>
          )}
          <ArgsLine name={key} args={meta.args} />
          {body ? (
            isDiff ? (
              <DiffView diff={body} />
            ) : (
              <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {body}
              </pre>
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

/** Arguments secondaires (hors argument principal), compacts. */
function ArgsLine({ name, args }: { name: NameKey; args: Record<string, unknown> }) {
  const hidden = new Set(
    name === 'run_command'
      ? ['command']
      : name === 'search_files'
        ? ['pattern']
        : ['path', 'content', 'old', 'new'],
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

/** Diff unifié coloré ligne par ligne. */
function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="max-h-80 overflow-auto px-0 py-1 font-mono text-xs leading-relaxed">
      {diff.split('\n').map((line, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: lignes d'un diff statique
          key={i}
          className={cn(
            'px-3 whitespace-pre-wrap',
            line.startsWith('+') && !line.startsWith('+++') && 'bg-success/10 text-success',
            line.startsWith('-') && !line.startsWith('---') && 'bg-destructive/10 text-destructive',
            line.startsWith('@@') && 'text-info',
            (line.startsWith('+++') || line.startsWith('---')) && 'text-muted-foreground',
          )}
        >
          {line || ' '}
        </div>
      ))}
    </pre>
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
