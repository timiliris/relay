import { Columns3, Plus, Square, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { ModelPicker } from '@/components/model-picker';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { IconButton } from '@/components/ui/tooltip-button';
import { useWindowTitle } from '@/hooks/use-window-title';
import { newId } from '@/lib/db';
import { formatCost } from '@/lib/format';
import { openrouter } from '@/lib/openrouter';
import { errorMessage, isTauri } from '@/lib/tauri';
import { useSettings } from '@/stores/settings';

interface Column {
  id: string;
  model: string;
  content: string;
  reasoning: string;
  status: 'idle' | 'running' | 'done' | 'error';
  error: string | null;
  cost: number | null;
  tokens: number | null;
  durationMs: number | null;
}

const MAX_COLUMNS = 3;

/** Même question envoyée à plusieurs modèles, réponses côte à côte (non persistées). */
export function ComparePage() {
  const { t } = useTranslation();
  useWindowTitle(t('compare.title'));
  const settings = useSettings();
  const inTauri = isTauri();
  const [prompt, setPrompt] = useState('');
  const [columns, setColumns] = useState<Column[]>(() => [blank(settings.defaultModel)]);
  const requests = useRef<Map<string, string>>(new Map());
  const running = columns.some((c) => c.status === 'running');

  const patchColumn = (id: string, patch: Partial<Column> | ((c: Column) => Partial<Column>)) =>
    setColumns((cols) =>
      cols.map((c) =>
        c.id === id ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c,
      ),
    );

  const run = async () => {
    const text = prompt.trim();
    if (!text || running) return;
    await Promise.all(
      columns.map(async (column) => {
        const requestId = newId();
        requests.current.set(column.id, requestId);
        const startedAt = Date.now();
        patchColumn(column.id, {
          content: '',
          reasoning: '',
          status: 'running',
          error: null,
          cost: null,
          tokens: null,
          durationMs: null,
        });
        try {
          await openrouter.streamChat(
            requestId,
            {
              model: column.model,
              messages: [
                ...(settings.systemPrompt.trim()
                  ? [{ role: 'system' as const, content: settings.systemPrompt }]
                  : []),
                { role: 'user', content: text },
              ],
              temperature: settings.temperature,
              reasoning: settings.reasoning,
              ...(settings.maxTokens ? { maxTokens: settings.maxTokens } : {}),
            },
            (event) => {
              if (event.type === 'delta')
                patchColumn(column.id, (c) => ({ content: c.content + event.content }));
              else if (event.type === 'reasoning')
                patchColumn(column.id, (c) => ({ reasoning: c.reasoning + event.content }));
              else if (event.type === 'usage')
                patchColumn(column.id, { cost: event.cost, tokens: event.completionTokens });
              else if (event.type === 'error')
                patchColumn(column.id, { status: 'error', error: event.message });
            },
          );
          patchColumn(column.id, (c) => ({
            status: c.status === 'error' ? 'error' : 'done',
            durationMs: Date.now() - startedAt,
          }));
        } catch (err) {
          patchColumn(column.id, {
            status: 'error',
            error: errorMessage(err),
            durationMs: Date.now() - startedAt,
          });
        } finally {
          requests.current.delete(column.id);
        }
      }),
    );
  };

  const stop = () => {
    for (const requestId of requests.current.values()) void openrouter.cancelStream(requestId);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Columns3 className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">{t('compare.title')}</h1>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">
          · {t('compare.description')}
        </span>
      </header>

      <div className="flex flex-1 gap-3 overflow-x-auto p-4">
        {columns.map((column) => (
          <section
            key={column.id}
            className="flex min-w-72 flex-1 flex-col rounded-xl border bg-card"
          >
            <div className="flex items-center gap-1 border-b p-2">
              <ModelPicker
                value={column.model}
                onChange={(model) => patchColumn(column.id, { model })}
                className="max-w-none flex-1"
              />
              {columns.length > 1 && (
                <IconButton
                  label={t('compare.removeModel')}
                  className="size-7"
                  onClick={() => setColumns((cols) => cols.filter((c) => c.id !== column.id))}
                  disabled={running}
                >
                  <X />
                </IconButton>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
              {column.status === 'idle' && (
                <p className="text-muted-foreground">{t('compare.empty')}</p>
              )}
              {column.status === 'running' && !column.content && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <span className="inline-block size-2 animate-pulse rounded-full bg-muted-foreground" />
                  {column.reasoning ? t('chat.thinking') : t('compare.waiting')}
                </p>
              )}
              {column.content && <Markdown>{column.content}</Markdown>}
              {column.error && <p className="mt-2 text-destructive">{column.error}</p>}
            </div>
            {(column.status === 'done' || column.status === 'error') && (
              <div className="flex gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
                {column.durationMs !== null && (
                  <span>
                    {t('chat.duration', { seconds: (column.durationMs / 1000).toFixed(1) })}
                  </span>
                )}
                {column.tokens !== null && column.durationMs && (
                  <span>
                    {t('chat.tokensPerSecond', {
                      tps: Math.round(column.tokens / (column.durationMs / 1000)),
                    })}
                  </span>
                )}
                {column.cost !== null && (
                  <span>{t('chat.cost', { cost: formatCost(column.cost) })}</span>
                )}
              </div>
            )}
          </section>
        ))}
        {columns.length < MAX_COLUMNS && (
          <button
            type="button"
            onClick={() => setColumns((cols) => [...cols, blank(settings.defaultModel)])}
            disabled={running}
            className="flex w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label={t('compare.addModel')}
            title={t('compare.addModel')}
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>

      <div className="shrink-0 border-t p-4">
        <div className="mx-auto flex max-w-4xl items-end gap-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void run();
              }
            }}
            placeholder={t('compare.placeholder')}
            aria-label={t('compare.placeholder')}
            className="min-h-12 flex-1 font-sans"
            disabled={!inTauri}
          />
          {running ? (
            <Button variant="secondary" onClick={stop}>
              <Square className="size-3.5 fill-current" />
              {t('chat.stop')}
            </Button>
          ) : (
            <Button onClick={() => void run()} disabled={!inTauri || !prompt.trim()}>
              {t('compare.run')}
            </Button>
          )}
        </div>
        {!inTauri && (
          <p className="mt-2 text-center text-xs text-muted-foreground">{t('common.onlyInApp')}</p>
        )}
      </div>
    </div>
  );
}

function blank(model: string): Column {
  return {
    id: newId(),
    model,
    content: '',
    reasoning: '',
    status: 'idle',
    error: null,
    cost: null,
    tokens: null,
    durationMs: null,
  };
}
