import { AtSign, File } from 'lucide-react';
import { type KeyboardEvent, type RefObject, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { FileEntry } from '@/lib/agent/commands';
import {
  activeMention,
  applyMention,
  basename,
  filterPaths,
  listWorkspaceFiles,
  readWorkspaceAttachment,
} from '@/lib/agent/mentions';
import { AttachmentError } from '@/lib/attachments';
import type { Attachment } from '@/lib/db';
import { errorMessage } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useExplorer } from '@/stores/explorer';
import { toast } from '@/stores/toast';

/**
 * Lit un fichier du dossier de travail et le remet au composeur comme pièce jointe texte.
 * Les refus (binaire, trop gros, erreur de lecture) sont signalés par un toast.
 */
export async function attachWorkspaceFile(
  workspace: string,
  path: string,
  size: number | null | undefined,
  onAttach: (attachment: Attachment) => void,
): Promise<void> {
  try {
    onAttach(await readWorkspaceAttachment(workspace, path, size));
  } catch (err) {
    if (err instanceof AttachmentError) {
      toast.error(
        err.code === 'too_large'
          ? i18n.t('chat.attachmentTooLarge', { name: err.fileName })
          : i18n.t('chat.mention.binary', { name: err.fileName }),
      );
    } else {
      toast.error(errorMessage(err));
    }
  }
}

interface UseFileMentionMenuOptions {
  /** Dossier de travail de la conversation ; sans lui, `@` est un caractère comme un autre. */
  workspace: string | null | undefined;
  value: string;
  setValue: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onAttach: (attachment: Attachment) => void;
}

/**
 * Menu des fichiers du dossier de travail, affiché quand une mention `@` est en cours de
 * saisie. Choisir un fichier remplace la mention par `@chemin` et joint son contenu au
 * message. Même ergonomie que le menu « / » : le hook porte l'état et le clavier.
 */
export function useFileMentionMenu({
  workspace,
  value,
  setValue,
  textareaRef,
  onAttach,
}: UseFileMentionMenuOptions) {
  const [selected, setSelected] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const version = useExplorer((s) => s.version);
  const listId = useId();

  // Curseur relu après chaque rendu de la saisie : au moment du rendu, le DOM porte encore
  // l'ancienne sélection (notamment juste après l'insertion d'un chemin).
  // biome-ignore lint/correctness/useExhaustiveDependencies: relu à chaque changement de texte
  useEffect(() => {
    setCursor(textareaRef.current?.selectionStart ?? value.length);
  }, [value]);

  const mention = workspace ? activeMention(value, cursor) : null;
  const mentionStart = mention?.start ?? null;
  const query = mention?.query ?? null;
  const key = mention ? `${mention.start}:${mention.query}` : null;

  // Liste chargée à l'apparition d'une mention ; le cache absorbe les ouvertures suivantes,
  // invalidé par `version` (écritures de l'agent, rafraîchissement du volet Fichiers).
  useEffect(() => {
    if (!workspace || mentionStart === null) return;
    let cancelled = false;
    setLoading(true);
    listWorkspaceFiles(workspace, version)
      .then((entries) => {
        if (!cancelled) setFiles(entries);
      })
      .catch((err) => {
        if (cancelled) return;
        setFiles([]);
        toast.error(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, version, mentionStart]);

  const paths = useMemo(() => files?.map((f) => f.path) ?? [], [files]);
  const items = useMemo(() => (query === null ? [] : filterPaths(paths, query)), [paths, query]);
  const open = key !== null && dismissedFor !== key && (loading || items.length > 0);

  // Nouvelle saisie : la sélection repart du premier élément et un Échap antérieur s'oublie.
  // biome-ignore lint/correctness/useExhaustiveDependencies: réinitialisé à chaque changement de mention
  useEffect(() => {
    setSelected(0);
    if (dismissedFor !== null && dismissedFor !== key) setDismissedFor(null);
  }, [key]);

  const pick = (path: string) => {
    if (!mention || !workspace) return;
    const next = applyMention(value, mention, path);
    setValue(next.text);
    const el = textareaRef.current;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.cursor, next.cursor);
    });
    const entry = files?.find((f) => f.path === path);
    void attachWorkspaceFile(workspace, path, entry?.size, onAttach);
  };

  /** `true` si la touche a été consommée par le menu. */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return true;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setSelected((i) => (i + delta + items.length) % items.length);
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const path = items[selected];
      if (path) pick(path);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissedFor(key);
      return true;
    }
    return false;
  };

  const element = open ? (
    <FileMentionMenu
      id={listId}
      items={items}
      selected={selected}
      loading={loading && items.length === 0}
      onHover={setSelected}
      onPick={pick}
    />
  ) : null;

  return { open, listId, onKeyDown, element };
}

interface FileMentionMenuProps {
  id: string;
  items: string[];
  selected: number;
  loading: boolean;
  onHover: (index: number) => void;
  onPick: (path: string) => void;
}

export function FileMentionMenu({
  id,
  items,
  selected,
  loading,
  onHover,
  onPick,
}: FileMentionMenuProps) {
  const { t } = useTranslation();
  useEffect(() => {
    document.getElementById(`${id}-${selected}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [id, selected]);

  return (
    <div
      className="absolute bottom-full left-3 z-20 mb-2 w-[min(28rem,calc(100%-1.5rem))] animate-pop overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
      data-testid="file-mention-menu"
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium">
          <AtSign className="size-3.5" />
          {t('chat.mention.menuTitle')}
        </span>
        <span className="hidden sm:inline">{t('chat.mention.menuHint')}</span>
      </div>
      <div
        id={id}
        role="listbox"
        aria-label={t('chat.mention.menuTitle')}
        className="max-h-64 overflow-y-auto p-1"
      >
        {loading && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('chat.mention.loading')}</p>
        )}
        {items.map((path, index) => {
          const active = index === selected;
          const name = basename(path);
          const dir = path.slice(0, path.length - name.length);
          return (
            <div
              key={path}
              id={`${id}-${index}`}
              role="option"
              aria-selected={active}
              tabIndex={-1}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(e) => {
                // Garde le focus dans la zone de saisie.
                e.preventDefault();
                onPick(path);
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                active && 'bg-accent',
              )}
            >
              <File className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate font-medium">{name}</span>
              {dir && (
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {dir}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
