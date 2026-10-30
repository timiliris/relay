import { AlertTriangle } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { type DialogRequest, useDialog } from '@/stores/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

/** Affiche le dialogue courant (voir `stores/dialog.ts`) : modal, focus piégé, Échap annule. */
export function DialogHost() {
  const current = useDialog((s) => s.current);
  if (!current) return null;
  return <DialogView key={current.title + current.kind} request={current} />;
}

function DialogView({ request }: { request: DialogRequest }) {
  const { t } = useTranslation();
  const next = useDialog((s) => s.next);
  const [value, setValue] = useState(request.kind === 'prompt' ? (request.defaultValue ?? '') : '');
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const finish = (result: boolean | string | null) => {
    if (request.kind === 'confirm') request.resolve(Boolean(result));
    else if (request.kind === 'prompt') request.resolve(typeof result === 'string' ? result : null);
    else request.resolve();
    next();
  };

  // Focus initial, restitution du focus et piège du Tab dans le panneau.
  // biome-ignore lint/correctness/useExhaustiveDependencies: monté une fois par dialogue
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])') ??
          [],
      ).filter((el) => !el.hasAttribute('disabled'));
    const initial = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
    initial?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Tab') {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previousFocus.current?.focus();
    };
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    finish(request.kind === 'prompt' ? value : true);
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex animate-fade-in items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => e.target === e.currentTarget && finish(null)}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="relay-dialog-title"
        className="w-full max-w-md animate-pop rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            {request.destructive && (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="size-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 id="relay-dialog-title" className="text-base font-semibold">
                {request.title}
              </h2>
              {request.message && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {request.message}
                </p>
              )}
            </div>
          </div>

          {request.kind === 'prompt' && (
            <div className="flex flex-col gap-1.5 text-sm">
              {request.label && <label htmlFor="relay-dialog-input">{request.label}</label>}
              <Input
                id="relay-dialog-input"
                data-autofocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={request.placeholder}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            {request.kind !== 'alert' && (
              <Button type="button" variant="ghost" onClick={() => finish(null)}>
                {request.cancelLabel ?? t('common.cancel')}
              </Button>
            )}
            <Button
              type="submit"
              data-autofocus={request.kind !== 'prompt' ? true : undefined}
              className={cn(
                request.destructive && 'bg-destructive text-white hover:bg-destructive/90',
              )}
              disabled={request.kind === 'prompt' && !value.trim()}
            >
              {request.confirmLabel ??
                (request.kind === 'alert' ? t('common.close') : t('common.confirm'))}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
