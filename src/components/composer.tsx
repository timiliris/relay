import { ArrowUp, Paperclip, Square } from 'lucide-react';
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AttachmentError, attachmentFromFile, pickAttachments } from '@/lib/attachments';
import type { ContextEstimate } from '@/lib/context';
import type { Attachment } from '@/lib/db';
import { formatTokens } from '@/lib/format';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { AttachmentList } from './message-bubble';
import { Button } from './ui/button';
import { IconButton } from './ui/tooltip-button';

interface ComposerProps {
  disabled?: boolean;
  streaming: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  /** Texte injecté de l'extérieur (suggestions, rappel du dernier message). */
  draft?: string | undefined;
  /** Appelé quand on appuie sur ↑ dans un champ vide. */
  onRecallLast?: (() => string | null) | undefined;
  /** Estimation du contexte pour la jauge. */
  context?: ContextEstimate | undefined;
  onContextChange?: ((draft: string, attachments: Attachment[]) => void) | undefined;
  acceptsImages?: boolean;
  children?: React.ReactNode;
}

const MAX_HEIGHT = 240;

/** Zone de saisie : auto-redimensionnée, pièces jointes, jauge de contexte. */
export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
  draft,
  onRecallLast,
  context,
  onContextChange,
  acceptsImages = true,
  children,
}: ComposerProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draft !== undefined) {
      setValue(draft);
      ref.current?.focus();
    }
  }, [draft]);

  // Ajuste la hauteur au contenu ; l'observer couvre les changements de largeur.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => {
      el.style.height = '0px';
      el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
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
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    onContextChange?.(value, attachments);
  }, [value, attachments]);

  const addAttachments = (items: Attachment[]) => {
    if (items.length === 0) return;
    if (!acceptsImages && items.some((a) => a.kind === 'image')) {
      toast.error(t('chat.attachmentsNotSupported'));
      items = items.filter((a) => a.kind !== 'image');
    }
    setAttachments((prev) => [...prev, ...items]);
  };

  const reportAttachmentError = (err: unknown) => {
    if (err instanceof AttachmentError) {
      toast.error(
        err.code === 'too_large'
          ? t('chat.attachmentTooLarge', { name: err.fileName })
          : t('chat.attachmentUnsupported', { name: err.fileName }),
      );
    } else {
      toast.error(errorMessage(err));
    }
  };

  const addFiles = async (files: Iterable<File>) => {
    const read: Attachment[] = [];
    for (const file of files) {
      try {
        read.push(await attachmentFromFile(file));
      } catch (err) {
        reportAttachmentError(err);
      }
    }
    addAttachments(read);
  };

  const pick = async () => {
    try {
      addAttachments(await pickAttachments(t('chat.filesFilter')));
    } catch (err) {
      reportAttachmentError(err);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const submit = () => {
    const text = value.trim();
    if ((!text && attachments.length === 0) || disabled || streaming) return;
    onSend(text, attachments);
    setValue('');
    setAttachments([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp' && value === '' && onRecallLast) {
      const last = onRecallLast();
      if (last) {
        e.preventDefault();
        setValue(last);
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {context && context.level !== 'ok' && (
        <p
          className={cn(
            'mb-2 text-center text-xs',
            context.level === 'over' ? 'text-destructive' : 'text-amber-600',
          )}
        >
          {context.level === 'over' ? t('chat.contextOver') : t('chat.contextWarn')}
        </p>
      )}
      <section
        aria-label={t('chat.send')}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'relative flex flex-col rounded-2xl border bg-card shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30',
          disabled && 'opacity-60',
          dragging && 'border-primary ring-2 ring-primary/30',
        )}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-card/90 text-sm font-medium">
            {t('chat.dropHere')}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="px-3 pt-3">
            <AttachmentList
              attachments={attachments}
              onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
            />
          </div>
        )}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.send')}
          disabled={disabled}
          rows={1}
          className="max-h-60 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <IconButton
            label={t('chat.attach')}
            className="size-8 text-muted-foreground"
            onClick={() => void pick()}
            disabled={disabled || !isTauri()}
          >
            <Paperclip className="size-4" />
          </IconButton>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">{children}</div>
          {context && <ContextGauge estimate={context} />}
          {streaming ? (
            <Button
              size="icon"
              variant="secondary"
              className="size-8 shrink-0 rounded-full"
              onClick={onStop}
              aria-label={t('chat.stop')}
              title={t('chat.stop')}
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="size-8 shrink-0 rounded-full"
              onClick={submit}
              disabled={disabled || (!value.trim() && attachments.length === 0)}
              aria-label={t('chat.send')}
              title={t('chat.send')}
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function ContextGauge({ estimate }: { estimate: ContextEstimate }) {
  const { t } = useTranslation();
  const percent = Math.min(100, Math.round(estimate.ratio * 100));
  const detail = t('chat.contextDetail', {
    used: formatTokens(estimate.used),
    limit: formatTokens(estimate.limit),
  });
  return (
    <div
      className="mr-1 hidden shrink-0 items-center gap-1.5 sm:flex"
      role="img"
      title={`${t('chat.context')} : ${detail}`}
      aria-label={`${t('chat.context')} : ${detail}`}
    >
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            estimate.level === 'over'
              ? 'bg-destructive'
              : estimate.level === 'warn'
                ? 'bg-amber-500'
                : 'bg-primary/60',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">
        {formatTokens(estimate.used)}
      </span>
    </div>
  );
}
