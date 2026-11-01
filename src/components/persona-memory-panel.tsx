import { Brain, Check, Pencil, Pin, PinOff, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveLanguage } from '@/i18n';
import type { Conversation, Message, PersonaMemory, Preset } from '@/lib/db';
import { estimateMemoryTokens, extractFacts } from '@/lib/persona-memory';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { dialog } from '@/stores/dialog';
import { usePersonaMemory } from '@/stores/persona-memory';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { IconButton } from './ui/tooltip-button';

interface PersonaMemoryPanelProps {
  preset: Preset;
  conversation: Conversation;
  /** Chemin actif, relu par l'extraction de faits. */
  messages: Message[];
  streaming: boolean;
  onClose: () => void;
}

/** Volet latéral : carnet de faits du persona de la conversation ouverte. */
export function PersonaMemoryPanel({
  preset,
  conversation,
  messages,
  streaming,
  onClose,
}: PersonaMemoryPanelProps) {
  const { t } = useTranslation();
  const language = useSettings((s) => resolveLanguage(s.language));
  const { items, loading, add, update, remove, removeAll } = usePersonaMemory();
  const [draft, setDraft] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [candidates, setCandidates] = useState<Array<{ text: string; keep: boolean }> | null>(null);
  const tokens = estimateMemoryTokens(items, language);

  const guard = (fn: () => Promise<void>) => () =>
    fn().catch((err) => toast.error(errorMessage(err)));

  const onAdd = guard(async () => {
    const content = draft.trim();
    if (!content) return;
    await add({ presetId: preset.id, content, sourceConversationId: conversation.id });
    setDraft('');
    toast.success(t('presets.memory.saved'));
  });

  const onClearAll = guard(async () => {
    const ok = await dialog.confirm({
      title: t('presets.memory.clearAll'),
      message: t('presets.memory.clearAllConfirm', { count: items.length, name: preset.name }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (ok) await removeAll(preset.id);
  });

  const onExtract = guard(async () => {
    setExtracting(true);
    try {
      const facts = await extractFacts(conversation.model, messages, items);
      if (facts.length === 0) toast.info(t('presets.memory.extractNone'));
      setCandidates(facts.length ? facts.map((text) => ({ text, keep: true })) : null);
    } finally {
      setExtracting(false);
    }
  });

  const onKeepCandidates = guard(async () => {
    const kept = (candidates ?? []).filter((c) => c.keep);
    for (const c of kept) {
      await add({ presetId: preset.id, content: c.text, sourceConversationId: conversation.id });
    }
    setCandidates(null);
    if (kept.length) toast.success(t('presets.memory.savedMany', { count: kept.length }));
  });

  const canExtract =
    isTauri() && !streaming && !extracting && messages.filter((m) => m.content.trim()).length >= 2;

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l bg-card/40 sm:w-80"
      aria-label={t('presets.memory.panelTitle', { name: preset.name })}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Brain className="size-4 text-chart-1" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {t('presets.memory.panelTitle', { name: preset.name })}
        </h2>
        <IconButton label={t('presets.memory.closePanel')} className="size-7" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span>{t('presets.memory.count', { count: items.length })}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono">{t('presets.memory.tokens', { count: tokens })}</span>
        {items.length > 0 && (
          <button
            type="button"
            className="ml-auto text-destructive hover:underline"
            onClick={onClearAll}
          >
            {t('presets.memory.clearAll')}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">{t('presets.memory.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {items.map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                fromHere={m.sourceConversationId === conversation.id}
                onChange={(content) => guard(() => update(m.id, { content }))()}
                onTogglePin={guard(() => update(m.id, { pinned: !m.pinned }))}
                onRemove={guard(async () => {
                  await remove(m.id);
                  toast.info(t('presets.memory.removed'));
                })}
              />
            ))}
          </ul>
        )}

        {candidates && (
          <section className="m-3 rounded-lg border border-dashed border-chart-1/40 bg-chart-1/5 p-3 text-sm">
            <h3 className="flex items-center gap-1.5 font-medium">
              <Sparkles className="size-3.5 text-chart-1" aria-hidden="true" />
              {t('presets.memory.extractTitle')}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('presets.memory.extractHint')}
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {candidates.map((c, index) => (
                <li key={c.text}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-primary"
                      checked={c.keep}
                      onChange={(e) =>
                        setCandidates((list) =>
                          list
                            ? list.map((item, i) =>
                                i === index ? { ...item, keep: e.target.checked } : item,
                              )
                            : list,
                        )
                      }
                    />
                    <span>{c.text}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCandidates(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={!candidates.some((c) => c.keep)}
                onClick={onKeepCandidates}
              >
                <Check className="size-3.5" />
                {t('presets.memory.extractKeep')}
              </Button>
            </div>
          </section>
        )}
      </div>

      <form
        className="flex shrink-0 flex-col gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onAdd();
        }}
      >
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('presets.memory.addPlaceholder')}
            aria-label={t('presets.memory.add')}
            className="h-8 text-sm"
          />
          <IconButton
            type="submit"
            label={t('presets.memory.add')}
            className="size-8 border"
            disabled={!draft.trim()}
          >
            <Plus className="size-4" />
          </IconButton>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="justify-center"
          disabled={!canExtract}
          title={isTauri() ? undefined : t('common.onlyInApp')}
          onClick={onExtract}
        >
          <Sparkles className={cn('size-3.5', extracting && 'animate-pulse')} />
          {extracting ? t('presets.memory.extracting') : t('presets.memory.extract')}
        </Button>
      </form>
    </aside>
  );
}

function MemoryRow({
  memory,
  fromHere,
  onChange,
  onTogglePin,
  onRemove,
}: {
  memory: PersonaMemory;
  fromHere: boolean;
  onChange: (content: string) => void;
  onTogglePin: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);

  const commit = () => {
    const content = draft.trim();
    if (content && content !== memory.content) onChange(content);
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="px-3 py-2">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            onBlur={commit}
            aria-label={t('presets.memory.edit')}
            className="h-8 text-sm"
          />
          <IconButton type="submit" label={t('common.save')} className="size-8">
            <Check className="size-4" />
          </IconButton>
        </form>
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-2 px-3 py-2 text-sm">
      <button
        type="button"
        aria-pressed={memory.pinned}
        aria-label={memory.pinned ? t('presets.memory.unpin') : t('presets.memory.pin')}
        title={memory.pinned ? t('presets.memory.unpin') : t('presets.memory.pin')}
        onClick={onTogglePin}
        className={cn(
          'mt-0.5 shrink-0 rounded p-0.5 transition-colors hover:text-foreground',
          memory.pinned ? 'text-chart-1' : 'text-muted-foreground/60',
        )}
      >
        {memory.pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
      </button>
      <button
        type="button"
        className="min-w-0 flex-1 text-left leading-snug hover:text-foreground"
        title={fromHere ? t('presets.memory.source') : t('presets.memory.edit')}
        onClick={() => {
          setDraft(memory.content);
          setEditing(true);
        }}
      >
        {memory.content}
      </button>
      <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [&_button]:size-6 [&_svg]:size-3.5">
        <IconButton
          label={t('presets.memory.edit')}
          onClick={() => {
            setDraft(memory.content);
            setEditing(true);
          }}
        >
          <Pencil />
        </IconButton>
        <IconButton
          label={t('presets.memory.delete')}
          className="text-destructive"
          onClick={onRemove}
        >
          <Trash2 />
        </IconButton>
      </span>
    </li>
  );
}
