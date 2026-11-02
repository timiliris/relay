/**
 * Volet « Processus » : commandes lancées par l'agent dans la conversation, vivantes ou
 * terminées, avec PID, durée qui court, état, code de sortie, bouton Arrêter et sortie
 * dépliable (alimentée en direct par `useProcesses`).
 */
import { Activity, ChevronDown, Square, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { type ProcessEntry, selectProcesses, useProcesses } from '@/stores/processes';
import { toast } from '@/stores/toast';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { IconButton } from './ui/tooltip-button';

const STATUS_CLASS: Record<ProcessEntry['status'], string> = {
  running: 'border-info/50 bg-info/10 text-info',
  done: 'border-success/40 bg-success/10 text-success',
  killed: 'border-border bg-muted text-muted-foreground',
};

/** Durée lisible : « 12,3 s » sous la minute, « 2 min 05 s » au-delà. */
export function formatDuration(ms: number, language = 'fr'): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) {
    return `${seconds.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes} min ${String(rest).padStart(2, '0')} s`;
}

/** Horloge rafraîchie chaque seconde tant que `active` (durées qui courent). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Bouton Arrêter d'un processus : appelle Rust, signale l'erreur éventuelle. */
export function StopButton({ id, className }: { id: string; className?: string }) {
  const { t } = useTranslation();
  const stop = useProcesses((s) => s.stop);
  const [stopping, setStopping] = useState(false);
  const onStop = async () => {
    setStopping(true);
    try {
      await stop(id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStopping(false);
    }
  };
  return (
    <Button
      size="sm"
      variant="ghost"
      className={cn('h-6 px-2 text-[11px] text-destructive hover:text-destructive', className)}
      disabled={stopping}
      onClick={() => void onStop()}
    >
      <Square className="size-3" />
      {stopping ? t('chat.processes.stopping') : t('chat.processes.stop')}
    </Button>
  );
}

/** Sortie monospace à défilement automatique (reste en bas tant que l'utilisateur n'y touche pas). */
export function OutputPane({
  text,
  truncated,
  live,
  className,
}: {
  text: string;
  truncated: boolean;
  live: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: défile à chaque nouveau fragment
  useEffect(() => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div className={className}>
      {truncated && (
        <p className="px-3 pt-1 text-[11px] text-muted-foreground">
          {t('chat.processes.truncated')}
        </p>
      )}
      <pre
        ref={ref}
        className="max-h-72 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap"
        aria-live={live ? 'polite' : 'off'}
        onScroll={() => {
          const el = ref.current;
          if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {text || (live ? t('chat.processes.noOutput') : t('chat.tools.noOutput'))}
      </pre>
    </div>
  );
}

function ProcessRow({ entry, now }: { entry: ProcessEntry; now: number }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(entry.status === 'running');
  const running = entry.status === 'running';
  const duration = formatDuration((entry.endedAt ?? now) - entry.startedAt, i18n.language);
  const details = [
    entry.pid !== null ? t('chat.processes.pid', { pid: entry.pid }) : null,
    entry.exitCode !== null ? t('chat.processes.exitCode', { code: entry.exitCode }) : null,
    entry.timedOut ? t('chat.processes.timedOut') : null,
    entry.background ? t('chat.processes.background') : null,
    duration,
  ].filter(Boolean);
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.command}>
          {entry.command}
        </code>
        <Badge className={cn('gap-1 px-1.5 font-sans', STATUS_CLASS[entry.status])}>
          {running && (
            <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
          )}
          {t(`chat.processes.${entry.status}`)}
        </Badge>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate tabular-nums">{details.join(' · ')}</span>
        {running && <StopButton id={entry.id} />}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11px] text-muted-foreground"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          {open ? t('chat.processes.hideOutput') : t('chat.processes.showOutput')}
        </Button>
      </div>
      {open && (
        <OutputPane
          text={entry.output}
          truncated={entry.truncated}
          live={running}
          className="mt-1 rounded-md border bg-card"
        />
      )}
    </li>
  );
}

/** Volet latéral : processus de la conversation, les plus récents en premier. */
export function ProcessPanel({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const items = useProcesses(selectProcesses(conversationId));
  const clearFinished = useProcesses((s) => s.clearFinished);
  const running = items.filter((p) => p.status === 'running').length;
  const now = useNow(running > 0);
  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l bg-card/40 sm:w-96"
      aria-label={t('chat.processes.title')}
    >
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-3">
        <Activity className="size-4 shrink-0 text-info" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t('chat.processes.title')}
        </span>
        {running > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('chat.processes.runningCount', { count: running })}
          </span>
        )}
        {items.length > running && (
          <IconButton
            label={t('chat.processes.clearFinished')}
            onClick={() => clearFinished(conversationId)}
          >
            <Trash2 />
          </IconButton>
        )}
        <IconButton label={t('common.close')} onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="flex-1 overflow-y-auto">
        {!isTauri() && (
          <p className="border-b px-3 py-2 text-xs text-muted-foreground">
            {t('chat.processes.onlyInApp')}
          </p>
        )}
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {t('chat.processes.empty')}
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((entry) => (
              <ProcessRow key={entry.id} entry={entry} now={now} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
