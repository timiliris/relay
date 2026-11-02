/**
 * Suivi de la boucle d'agent : « Étape N/25 · outil en cours » et bouton Arrêter.
 * `useAgentStatus` expose la progression d'une conversation ; `AgentStatusBar` la rend en une
 * fine barre (dans la carte d'outil en cours, ou au-dessus du composeur).
 */
import { Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentProgress } from '@/lib/agent/types';
import { stopStreaming } from '@/lib/chat-service';
import { cn } from '@/lib/utils';
import { useAgent } from '@/stores/agent';
import { Button } from './ui/button';

/** Progression de la boucle d'agent pour `conversationId`, `null` si aucun tour n'est en cours. */
export function useAgentStatus(conversationId: string | null | undefined): AgentProgress | null {
  return useAgent((s) =>
    conversationId && s.running?.conversationId === conversationId ? s.running : null,
  );
}

/** Libellé de la phase : outil en attente, en cours, ou modèle qui réfléchit. */
export function useAgentStatusLabel(progress: AgentProgress | null): string {
  const { t } = useTranslation();
  if (!progress) return '';
  const step = t('chat.toolsPreview.step', { step: progress.step, total: progress.total ?? '∞' });
  const tool = progress.toolName ? t(`chat.tools.names.${progress.toolName}`) : '';
  const phase =
    progress.phase === 'thinking' || !tool
      ? t('chat.toolsPreview.thinking')
      : progress.phase === 'pending'
        ? t('chat.toolsPreview.awaiting', { tool })
        : t('chat.toolsPreview.toolRunning', { tool });
  return `${step} · ${phase}`;
}

export function AgentStatusBar({
  conversationId,
  className,
}: {
  conversationId: string | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const progress = useAgentStatus(conversationId);
  const label = useAgentStatusLabel(progress);
  if (!progress) return null;
  return (
    <div
      className={cn(
        'flex items-center gap-2 bg-info/5 px-3 py-1 text-[11px] text-muted-foreground',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full bg-info',
          progress.phase !== 'pending' && 'animate-pulse',
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
        onClick={stopStreaming}
      >
        <Square className="size-3" />
        {t('chat.stop')}
      </Button>
    </div>
  );
}
