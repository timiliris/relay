import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { usePlaywrightInstall } from '@/stores/playwright-install';
import { Button } from '../ui/button';

/**
 * Dialogue in-app de progression de l'installation de Playwright : étape en cours, sortie ligne
 * par ligne, résultat ; Annuler pendant l'exécution, Fermer ensuite. L'état vit dans
 * `usePlaywrightInstall` ; ce composant n'est rendu que hors de l'état `idle`.
 */
export function PlaywrightInstallDialog() {
  const { t } = useTranslation();
  const { status, step, lines, exitCode, error, cancel, reset } = usePlaywrightInstall();
  const logRef = useRef<HTMLPreElement>(null);
  const running = status === 'running';

  // Fin de journal toujours visible.
  // biome-ignore lint/correctness/useExhaustiveDependencies: défilement à chaque nouvelle ligne
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (usePlaywrightInstall.getState().status === 'running') cancel();
      else reset();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cancel, reset]);

  const outcome = (() => {
    switch (status) {
      case 'success':
        return { ok: true, text: t('settings.developer.installSuccess') };
      case 'failed':
        return {
          ok: false,
          text: t('settings.developer.installFailed', { code: exitCode ?? '?' }),
        };
      case 'cancelled':
        return { ok: false, text: t('settings.developer.installCancelled') };
      case 'timedOut':
        return { ok: false, text: t('settings.developer.installTimedOut') };
      case 'error':
        return { ok: false, text: error ?? t('errors.unknown') };
      default:
        return null;
    }
  })();

  return (
    <div className="fixed inset-0 z-[95] flex animate-fade-in items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="playwright-install-title"
        aria-busy={running}
        className="flex w-full max-w-2xl animate-pop flex-col gap-4 rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full',
              running && 'bg-primary/10 text-primary',
              outcome?.ok && 'bg-green-500/10 text-green-600',
              outcome && !outcome.ok && 'bg-destructive/10 text-destructive',
            )}
          >
            {running ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : outcome?.ok ? (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="size-4" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="playwright-install-title" className="text-base font-semibold">
              {t('settings.developer.installTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
              {outcome
                ? outcome.text
                : step
                  ? t('settings.developer.installStep', {
                      index: step.index + 1,
                      total: step.total,
                      command: step.command,
                    })
                  : t('settings.developer.installStarting')}
            </p>
          </div>
        </div>

        <pre
          ref={logRef}
          className="max-h-72 min-h-32 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words"
        >
          {lines.map((line, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: journal en append seul
              key={i}
              className={cn(
                'block',
                line.command && 'font-semibold text-foreground',
                !line.command && line.stderr && 'text-amber-700 dark:text-amber-400',
                !line.command && !line.stderr && 'text-muted-foreground',
              )}
            >
              {line.text}
            </span>
          ))}
        </pre>

        <div className="flex justify-end gap-2">
          {running ? (
            <Button variant="ghost" onClick={cancel}>
              {t('common.cancel')}
            </Button>
          ) : (
            <Button onClick={reset} data-autofocus>
              {t('common.close')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
