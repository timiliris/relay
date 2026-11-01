import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  NotebookPen,
  Pencil,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useThrottledValue } from '@/hooks/use-throttled-value';
import { formatBytes } from '@/lib/attachments';
import { hueStyle } from '@/lib/color';
import type { Attachment, Message, Preset } from '@/lib/db';
import { formatCost } from '@/lib/format';
import { dataUrlToBytes } from '@/lib/image-output';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useModels } from '@/stores/models';
import { toast } from '@/stores/toast';
import { Markdown } from './markdown';
import { ModelPicker } from './model-picker';
import { PresetAvatar } from './preset-avatar';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { IconButton } from './ui/tooltip-button';

export interface MessageBubbleProps {
  message: Message;
  streaming?: boolean;
  showReasoning: boolean;
  /** Persona de la conversation : son avatar remplace l'icône générique de l'assistant. */
  persona?: Preset | undefined;
  /** Position parmi les versions (frères) ; masqué si total ≤ 1. `models` : modèle de chaque version. */
  version?: { index: number; total: number; models?: (string | null)[] } | undefined;
  onSwitchVersion?: ((direction: 1 | -1) => void) | undefined;
  onCopy?: (() => void) | undefined;
  /** Ajoute un souvenir au persona de la conversation à partir de ce message. */
  onMemorize?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onRegenerate?: (() => void) | undefined;
  /** Régénère avec un autre modèle, choisi dans un sélecteur (la conversation garde le sien). */
  onRegenerateWith?: ((modelId: string) => void) | undefined;
  onContinue?: (() => void) | undefined;
  onEdit?: ((text: string) => void) | undefined;
  /** Épingle ou désépingle le message (bouton Épingler/Désépingler). */
  onTogglePin?: (() => void) | undefined;
}

export function MessageBubble({
  message,
  streaming = false,
  showReasoning,
  persona,
  version,
  onSwitchVersion,
  onCopy,
  onMemorize,
  onDelete,
  onRegenerate,
  onRegenerateWith,
  onContinue,
  onEdit,
  onTogglePin,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const modelById = useModels((s) => s.byId);
  const modelName = (id: string | null) =>
    id ? (modelById(id)?.name ?? id) : t('chat.regenerate.unknownModel');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  // Le sélecteur s'ouvre vers le haut quand la bulle est proche du bas (cas du dernier message).
  const [pickerSide, setPickerSide] = useState<'top' | 'bottom'>('bottom');
  // Pendant le streaming, le Markdown est re-rendu au plus toutes les 80 ms.
  const displayed = useThrottledValue(message.content, 80, streaming);
  const isUser = message.role === 'user';
  const hasUsage = message.promptTokens !== null && message.completionTokens !== null;
  const seconds = message.durationMs ? message.durationMs / 1000 : null;
  const tps =
    seconds && message.completionTokens ? Math.round(message.completionTokens / seconds) : null;

  // Info-bulle : position, puis le modèle de chaque version pour les comparer d'un coup d'œil.
  const versionTitle = version
    ? [
        t('chat.version', version),
        ...(version.models?.some(Boolean)
          ? [
              `${t('chat.regenerate.versions')} :`,
              ...version.models.map((m, i) => `${i + 1}. ${modelName(m)}`),
            ]
          : []),
      ].join('\n')
    : '';

  const pinButton = onTogglePin && (
    <IconButton
      label={message.pinned ? t('chat.pins.unpin') : t('chat.pins.pin')}
      aria-pressed={message.pinned}
      className={cn(message.pinned && 'text-warning')}
      onClick={onTogglePin}
    >
      {message.pinned ? <PinOff /> : <Pin />}
    </IconButton>
  );

  const versionNav = version && version.total > 1 && onSwitchVersion && (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
      <button
        type="button"
        className="rounded p-0.5 hover:text-foreground disabled:opacity-40"
        aria-label={t('chat.previousVersion')}
        disabled={version.index <= 1}
        onClick={() => onSwitchVersion(-1)}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <span className="font-mono" title={versionTitle}>
        {version.index}/{version.total}
      </span>
      <button
        type="button"
        className="rounded p-0.5 hover:text-foreground disabled:opacity-40"
        aria-label={t('chat.nextVersion')}
        disabled={version.index >= version.total}
        onClick={() => onSwitchVersion(1)}
      >
        <ChevronRight className="size-3.5" />
      </button>
    </span>
  );

  if (isUser) {
    if (editing && onEdit) {
      return (
        <div className="flex justify-end">
          <form
            className="flex w-full max-w-[85%] flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (text && text !== message.content) onEdit(text);
              setEditing(false);
            }}
          >
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              className="min-h-20 font-sans"
              aria-label={t('chat.edit')}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={!draft.trim()}>
                {t('chat.editSend')}
              </Button>
            </div>
          </form>
        </div>
      );
    }
    return (
      <div
        className={cn(
          'group flex animate-slide-up flex-col items-end gap-1',
          message.pinned && 'border-l-2 border-warning pl-3',
        )}
      >
        {message.attachments.length > 0 && <AttachmentList attachments={message.attachments} />}
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {message.content}
        </div>
        <div className="flex h-6 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [&_button]:size-6 [&_svg]:size-3.5">
          {versionNav}
          {pinButton}
          {onEdit && (
            <IconButton
              label={t('chat.edit')}
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              <Pencil />
            </IconButton>
          )}
          {onCopy && (
            <IconButton label={t('chat.copyMessage')} onClick={onCopy}>
              <Copy />
            </IconButton>
          )}
          {onMemorize && (
            <IconButton label={t('presets.memory.memorize')} onClick={onMemorize}>
              <NotebookPen />
            </IconButton>
          )}
          {onDelete && (
            <IconButton label={t('chat.deleteMessage')} onClick={onDelete}>
              <Trash2 />
            </IconButton>
          )}
        </div>
      </div>
    );
  }

  const interrupted = !streaming && message.finishReason === 'streaming';
  const truncated = !streaming && message.finishReason === 'length';

  return (
    <div
      className={cn(
        'group flex animate-slide-up gap-3',
        message.pinned && 'border-l-2 border-warning pl-3',
      )}
    >
      {persona ? (
        <PresetAvatar preset={persona} className="mt-1 size-7 text-xs shadow-sm" />
      ) : (
        <div
          className="hue-soft mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border"
          style={hueStyle(message.model ?? 'assistant')}
        >
          <Bot className="hue-text size-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        {showReasoning && message.reasoning && (
          <Reasoning text={message.reasoning} streaming={streaming && !message.content} />
        )}
        {displayed ? (
          <Markdown className="text-sm">{displayed}</Markdown>
        ) : (
          streaming && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                <span className="size-1.5 animate-dot rounded-full bg-chart-1" />
                <span className="size-1.5 animate-dot rounded-full bg-chart-2 [animation-delay:0.15s]" />
                <span className="size-1.5 animate-dot rounded-full bg-chart-3 [animation-delay:0.3s]" />
              </span>
              {t('chat.thinking')}
            </p>
          )
        )}
        {streaming && displayed && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground align-text-bottom" />
        )}
        {message.attachments.length > 0 && <GeneratedImages attachments={message.attachments} />}
        {!streaming && (
          <div className="mt-1 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {versionNav}
            {message.model && (
              <span className="truncate font-mono" title={message.model}>
                {modelName(message.model)}
              </span>
            )}
            {hasUsage && (
              <span>
                {t('chat.tokens', {
                  prompt: message.promptTokens,
                  completion: message.completionTokens,
                })}
              </span>
            )}
            {message.cost !== null && (
              <span>{t('chat.cost', { cost: formatCost(message.cost) })}</span>
            )}
            {seconds !== null && (
              <span>
                {t('chat.duration', { seconds: seconds.toFixed(1) })}
                {tps ? ` · ${t('chat.tokensPerSecond', { tps })}` : ''}
              </span>
            )}
            {message.finishReason === 'cancelled' && <span>{t('chat.cancelled')}</span>}
            {interrupted && <span className="text-amber-600">{t('chat.interrupted')}</span>}
            {truncated && <span className="text-amber-600">{t('chat.truncated')}</span>}
            {onContinue && (interrupted || truncated || message.finishReason === 'cancelled') && (
              <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onContinue}>
                <Play className="size-3" />
                {t('chat.continue')}
              </Button>
            )}
            <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [&_button]:size-6 [&_svg]:size-3.5">
              {pinButton}
              {onCopy && (
                <IconButton label={t('chat.copyMessage')} onClick={onCopy}>
                  <Copy />
                </IconButton>
              )}
              {onMemorize && (
                <IconButton label={t('presets.memory.memorize')} onClick={onMemorize}>
                  <NotebookPen />
                </IconButton>
              )}
              {onRegenerate && (
                <IconButton label={t('chat.regenerate.action')} onClick={onRegenerate}>
                  <RefreshCw />
                </IconButton>
              )}
              {onRegenerateWith && (
                <ModelPicker
                  value={message.model ?? ''}
                  onChange={onRegenerateWith}
                  align="end"
                  side={pickerSide}
                  trigger={({ open, toggle }) => (
                    <IconButton
                      label={t('chat.regenerate.with')}
                      aria-haspopup="menu"
                      aria-expanded={open}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        const below = window.innerHeight - r.bottom;
                        setPickerSide(below < 400 && r.top > below ? 'top' : 'bottom');
                        toggle();
                      }}
                      className={cn(open && 'bg-accent')}
                    >
                      <Shuffle />
                    </IconButton>
                  )}
                />
              )}
              {onDelete && (
                <IconButton label={t('chat.deleteMessage')} onClick={onDelete}>
                  <Trash2 />
                </IconButton>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function AttachmentList({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove?: ((id: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-2">
      {attachments.map((a) => (
        <li key={a.id} className="group/att relative">
          {a.kind === 'image' && a.data ? (
            <img
              src={a.data}
              alt={t('chat.imageAlt', { name: a.name })}
              className="h-24 max-w-48 rounded-lg border object-cover"
            />
          ) : (
            <span className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs">
              <FileText className="size-4 text-muted-foreground" />
              <span className="max-w-40 truncate">{a.name}</span>
              <span className="text-muted-foreground">{formatBytes(a.size)}</span>
            </span>
          )}
          {onRemove && (
            <button
              type="button"
              aria-label={t('chat.removeAttachment')}
              onClick={() => onRemove(a.id)}
              className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-foreground text-background group-hover/att:flex"
            >
              <Check className="size-3 rotate-45" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Images produites par l'assistant : grille cliquable, ouverture en grand et enregistrement. */
export function GeneratedImages({ attachments }: { attachments: Attachment[] }) {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const images = attachments.filter((a) => a.kind === 'image' && a.data);
  if (images.length === 0) return null;
  const single = images.length === 1;
  const opened = openIndex === null ? undefined : images[openIndex];
  return (
    <>
      <ul
        className={cn(
          'mt-2 grid gap-2',
          single ? 'max-w-md grid-cols-1' : 'max-w-2xl grid-cols-2 sm:grid-cols-3',
        )}
        aria-label={t('chat.images.filter')}
      >
        {images.map((a, i) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => setOpenIndex(i)}
              title={t('chat.images.open')}
              className="group/img block w-full overflow-hidden rounded-lg border bg-card focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src={a.data}
                alt={t('chat.images.alt', { name: a.name })}
                loading="lazy"
                className={cn(
                  'w-full object-cover transition-transform group-hover/img:scale-[1.02]',
                  single ? 'max-h-80 object-contain' : 'aspect-square',
                )}
              />
            </button>
          </li>
        ))}
      </ul>
      {opened && <ImageLightbox image={opened} onClose={() => setOpenIndex(null)} />}
    </>
  );
}

/** Enregistre une image générée via le sélecteur natif « Enregistrer sous ». */
export async function saveGeneratedImage(image: Attachment): Promise<boolean> {
  if (!image.data) return false;
  const ext = image.name.slice(image.name.lastIndexOf('.') + 1) || 'png';
  const path = await save({
    defaultPath: image.name,
    filters: [{ name: 'Image', extensions: [ext] }],
  });
  if (!path) return false;
  await writeFile(path, dataUrlToBytes(image.data));
  return true;
}

function ImageLightbox({ image, onClose }: { image: Attachment; onClose: () => void }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const inTauri = isTauri();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = async () => {
    setSaving(true);
    try {
      if (await saveGeneratedImage(image)) toast.success(t('chat.images.saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // Portail : les bulles sont animées par `transform`, ce qui confinerait un `fixed` à la bulle.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      className="fixed inset-0 z-[95] flex animate-fade-in flex-col items-center justify-center gap-3 bg-black/85 p-4"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <img
        src={image.data}
        alt={t('chat.images.alt', { name: image.name })}
        className="max-h-[82vh] max-w-full animate-pop rounded-lg object-contain shadow-2xl"
      />
      <div className="flex items-center gap-3 text-xs text-white/80">
        <span className="font-mono">{image.name}</span>
        <span>{formatBytes(image.size)}</span>
        <Button
          size="sm"
          variant="secondary"
          className="h-7"
          onClick={() => void download()}
          disabled={!inTauri || saving}
          title={inTauri ? t('chat.images.download') : t('chat.images.onlyInApp')}
        >
          <Download className="size-3.5" />
          {t('chat.images.download')}
        </Button>
        <IconButton
          label={t('common.close')}
          autoFocus
          onClick={onClose}
          className="text-white hover:bg-white/10 hover:text-white"
        >
          <X />
        </IconButton>
      </div>
    </div>,
    document.body,
  );
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(streaming);
  return (
    <div className="mb-2 rounded-lg border border-dashed border-chart-1/40 bg-chart-1/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Brain className={cn('size-3.5 text-chart-1', streaming && 'animate-pulse')} />
        {t('chat.reasoning')}
        <ChevronDown
          className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t px-3 py-2 text-xs text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
}
