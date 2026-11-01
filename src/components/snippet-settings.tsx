import { Pencil, Plus, Slash, Trash2 } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeTrigger, SNIPPET_PREFIX, type Snippet } from '@/lib/snippets';
import { dialog } from '@/stores/dialog';
import { seedSnippets, useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

type Draft = Pick<Snippet, 'trigger' | 'title' | 'body'>;
const emptyDraft: Draft = { trigger: '', title: '', body: '' };

/** Carte « Raccourcis de prompt » des paramètres : liste, ajout, édition inline, suppression, défauts. */
export function SnippetSettings() {
  const { t } = useTranslation();
  const snippets = useSettings((s) => s.snippets);
  const language = useSettings((s) => s.language);
  const patch = useSettings((s) => s.patch);
  /** `'new'` : formulaire d'ajout ; un id : édition inline de ce raccourci. */
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const ids = useId();

  const sorted = [...snippets].sort((a, b) => a.position - b.position);
  const templates = { selection: '{{selection}}', clipboard: '{{clipboard}}' };

  const startNew = () => {
    setDraft(emptyDraft);
    setEditing('new');
  };
  const startEdit = (s: Snippet) => {
    setDraft({ trigger: s.trigger, title: s.title, body: s.body });
    setEditing(s.id);
  };
  const cancel = () => setEditing(null);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const trigger = normalizeTrigger(draft.trigger);
    const title = draft.title.trim() || trigger;
    const body = draft.body.trim();
    if (!trigger || !body) return;
    if (snippets.some((s) => s.trigger === trigger && s.id !== editing)) {
      toast.error(t('chat.snippets.duplicate', { trigger }));
      return;
    }
    const next =
      editing === 'new'
        ? [
            ...snippets,
            {
              id: crypto.randomUUID(),
              trigger,
              title,
              body,
              position: Math.max(-1, ...snippets.map((s) => s.position)) + 1,
            },
          ]
        : snippets.map((s) => (s.id === editing ? { ...s, trigger, title, body } : s));
    patch({ snippets: next });
    setEditing(null);
    toast.success(t('chat.snippets.saved'));
  };

  const remove = async (s: Snippet) => {
    const ok = await dialog.confirm({
      title: t('common.delete'),
      message: t('chat.snippets.deleteConfirm', { trigger: s.trigger }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    patch({ snippets: snippets.filter((x) => x.id !== s.id) });
    if (editing === s.id) setEditing(null);
  };

  const restore = () => {
    const defaults = seedSnippets(language);
    // Les raccourcis personnalisés sont conservés ; les défauts manquants sont rajoutés.
    const missing = defaults.filter((d) => !snippets.some((s) => s.trigger === d.trigger));
    const offset = Math.max(-1, ...snippets.map((s) => s.position)) + 1;
    patch({
      snippets: [...snippets, ...missing.map((d, i) => ({ ...d, position: offset + i }))],
      snippetsSeeded: true,
    });
    toast.success(t('chat.snippets.restored', { count: missing.length }));
  };

  const form = (
    <form onSubmit={save} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label htmlFor={`${ids}-trigger`} className="flex flex-col gap-1 text-xs">
          <span>{t('chat.snippets.trigger')}</span>
          <div className="flex items-center gap-1">
            <span className="font-mono text-muted-foreground">{SNIPPET_PREFIX}</span>
            <Input
              autoFocus
              id={`${ids}-trigger`}
              value={draft.trigger}
              onChange={(e) => setDraft((d) => ({ ...d, trigger: e.target.value }))}
              placeholder={t('chat.snippets.triggerPlaceholder')}
              className="h-8 font-mono"
              required
            />
          </div>
        </label>
        <label htmlFor={`${ids}-title`} className="flex flex-col gap-1 text-xs">
          <span>{t('chat.snippets.titleLabel')}</span>
          <Input
            id={`${ids}-title`}
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder={t('chat.snippets.titlePlaceholder')}
            className="h-8"
          />
        </label>
      </div>
      <label htmlFor={`${ids}-body`} className="flex flex-col gap-1 text-xs">
        <span>{t('chat.snippets.body')}</span>
        <Textarea
          id={`${ids}-body`}
          value={draft.body}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          placeholder={t('chat.snippets.bodyPlaceholder', templates)}
          className="min-h-20 font-sans"
          required
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!draft.trigger.trim() || !draft.body.trim()}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );

  return (
    <Card id="snippets">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Slash className="size-4" />
          {t('chat.snippets.title')}
        </CardTitle>
        <CardDescription>{t('chat.snippets.description', templates)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {sorted.length === 0 && editing !== 'new' && (
          <p className="text-muted-foreground">{t('chat.snippets.none')}</p>
        )}
        <ul className="flex flex-col divide-y">
          {sorted.map((s) => (
            <li key={s.id} className="py-2">
              {editing === s.id ? (
                form
              ) : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded bg-muted px-1.5 font-mono text-xs text-primary">
                        {SNIPPET_PREFIX}
                        {s.trigger}
                      </span>
                      <p className="truncate font-medium">{s.title}</p>
                    </div>
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                      {s.body}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('chat.snippets.edit')}
                    title={t('chat.snippets.edit')}
                    onClick={() => startEdit(s)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    aria-label={t('chat.snippets.delete')}
                    title={t('chat.snippets.delete')}
                    onClick={() => void remove(s)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {editing === 'new' ? (
          form
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={startNew}>
              <Plus />
              {t('chat.snippets.add')}
            </Button>
            <Button variant="outline" size="sm" onClick={restore}>
              {t('chat.snippets.restoreDefaults')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
