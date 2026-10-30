import { ArrowUp, Square } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

interface ComposerProps {
  disabled?: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Texte injecté de l'extérieur (suggestions de l'écran vide). */
  draft?: string | undefined;
  children?: React.ReactNode;
}

/** Zone de saisie : auto-redimensionnée, Entrée envoie, Maj+Entrée saute une ligne. */
export function Composer({ disabled, streaming, onSend, onStop, draft, children }: ComposerProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draft !== undefined) {
      setValue(draft);
      ref.current?.focus();
    }
  }, [draft]);

  // Ajuste la hauteur au contenu ; l'observer couvre les changements de largeur
  // (mise en page initiale, redimensionnement de la fenêtre, repli du panneau).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => {
      el.style.height = '0px';
      el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: recalcul à chaque saisie
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || streaming) return;
    onSend(text);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        className={cn(
          'flex flex-col rounded-2xl border bg-card shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30',
          disabled && 'opacity-60',
        )}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.send')}
          disabled={disabled}
          rows={1}
          className="max-h-60 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
          {streaming ? (
            <Button
              size="icon"
              variant="secondary"
              className="size-8 rounded-full"
              onClick={onStop}
              aria-label={t('chat.stop')}
              title={t('chat.stop')}
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="size-8 rounded-full"
              onClick={submit}
              disabled={disabled || !value.trim()}
              aria-label={t('chat.send')}
              title={t('chat.send')}
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
