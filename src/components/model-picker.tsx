import { Check, ChevronDown, RefreshCw, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPrice, formatTokens } from '@/lib/format';
import type { ModelInfo } from '@/lib/openrouter';
import { cn } from '@/lib/utils';
import { useModels } from '@/stores/models';
import { useSettings } from '@/stores/settings';
import { Button } from './ui/button';
import { Dropdown } from './ui/dropdown';
import { Input } from './ui/input';

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
  align?: 'start' | 'end';
}

/** Sélecteur de modèle avec recherche, favoris, prix et taille de contexte. */
export function ModelPicker({ value, onChange, className, align = 'start' }: ModelPickerProps) {
  const { t } = useTranslation();
  const { models, status, load, byId } = useModels();
  const favorites = useSettings((s) => s.favoriteModels);
  const recents = useSettings((s) => s.recentModels);
  const toggleFavorite = useSettings((s) => s.toggleFavorite);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const current = byId(value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : models;
    const fav = list.filter((m) => favorites.includes(m.id));
    const rec = list.filter((m) => !favorites.includes(m.id) && recents.includes(m.id));
    const rest = list.filter((m) => !favorites.includes(m.id) && !recents.includes(m.id));
    return { fav, rec, rest };
  }, [models, query, favorites, recents]);

  return (
    <Dropdown
      align={align}
      className="w-[26rem] max-w-[90vw] p-0"
      trigger={({ toggle }) => (
        <Button
          variant="outline"
          size="sm"
          onClick={toggle}
          className={cn('max-w-72 justify-between gap-2 font-normal', className)}
          title={current?.id ?? value}
        >
          <span className="truncate">{current?.name ?? value}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      )}
    >
      {(close) => (
        <div className="flex max-h-[28rem] flex-col">
          <div className="flex items-center gap-2 border-b p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('model.search')}
              aria-label={t('model.search')}
              className="h-8"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={t('model.refresh')}
              title={t('model.refresh')}
              onClick={() => void load(true)}
              disabled={status === 'loading'}
            >
              <RefreshCw className={cn('size-4', status === 'loading' && 'animate-spin')} />
            </Button>
          </div>
          <div className="overflow-y-auto p-1">
            {status === 'error' && models.length === 0 && (
              <p className="p-3 text-sm text-destructive">{t('model.loadError')}</p>
            )}
            {status === 'loading' && models.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">{t('common.loading')}</p>
            )}
            {filtered.fav.length > 0 && <Group label={t('model.favorites')} />}
            {filtered.fav.map((m) => (
              <Row
                key={m.id}
                model={m}
                selected={m.id === value}
                favorite
                onSelect={() => {
                  onChange(m.id);
                  close();
                }}
                onFavorite={() => toggleFavorite(m.id)}
              />
            ))}
            {filtered.rec.length > 0 && <Group label={t('model.all')} />}
            {filtered.rec.map((m) => (
              <Row
                key={m.id}
                model={m}
                selected={m.id === value}
                favorite={false}
                onSelect={() => {
                  onChange(m.id);
                  close();
                }}
                onFavorite={() => toggleFavorite(m.id)}
              />
            ))}
            {filtered.rest.map((m) => (
              <Row
                key={m.id}
                model={m}
                selected={m.id === value}
                favorite={false}
                onSelect={() => {
                  onChange(m.id);
                  close();
                }}
                onFavorite={() => toggleFavorite(m.id)}
              />
            ))}
            {models.length > 0 &&
              filtered.fav.length + filtered.rec.length + filtered.rest.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">{t('model.noResults')}</p>
              )}
          </div>
          <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
            {t('model.count', { count: models.length })}
          </div>
        </div>
      )}
    </Dropdown>
  );
}

function Group({ label }: { label: string }) {
  return (
    <p className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
  );
}

function Row({
  model,
  selected,
  favorite,
  onSelect,
  onFavorite,
}: {
  model: ModelInfo;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onFavorite: () => void;
}) {
  const { t } = useTranslation();
  const free = model.promptPrice === 0 && model.completionPrice === 0;
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent',
        selected && 'bg-accent/60',
      )}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{model.name}</span>
          {selected && <Check className="size-3.5 shrink-0 text-primary" />}
        </div>
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <span className="truncate font-mono">{model.id}</span>
          <span className="shrink-0">
            {t('model.context', { tokens: formatTokens(model.contextLength) })}
          </span>
          <span className="shrink-0">
            {free
              ? t('model.free')
              : t('model.price', {
                  prompt: formatPrice(model.promptPrice),
                  completion: formatPrice(model.completionPrice),
                })}
          </span>
        </div>
      </button>
      <button
        type="button"
        onClick={onFavorite}
        aria-label={favorite ? t('model.unfavorite') : t('model.favorite')}
        title={favorite ? t('model.unfavorite') : t('model.favorite')}
        className={cn(
          'rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground',
          favorite && 'opacity-100 text-amber-500',
        )}
      >
        <Star className={cn('size-4', favorite && 'fill-current')} />
      </button>
    </div>
  );
}
