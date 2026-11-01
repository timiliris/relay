import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useToasts } from '@/stores/toast';

const icons = { info: Info, success: CheckCircle2, error: AlertCircle } as const;
const tones = {
  info: { icon: 'text-info', border: 'border-info/40' },
  success: { icon: 'text-success', border: 'border-success/40' },
  error: { icon: 'text-destructive', border: 'border-destructive/40' },
} as const;

export function Toaster() {
  const { t } = useTranslation();
  const { toasts, dismiss } = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => {
        const Icon = icons[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto flex animate-slide-up items-start gap-2 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg',
              tones[toast.kind].border,
            )}
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', tones[toast.kind].icon)} />
            <span className="flex-1 break-words">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label={t('common.close')}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
