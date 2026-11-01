import { BarChart3, Coins, Hash, type LucideIcon, MessagesSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { useWindowTitle } from '@/hooks/use-window-title';
import { chartBg } from '@/lib/color';
import { type UsageRow, usage } from '@/lib/db';
import { formatCost, formatTokens } from '@/lib/format';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';

type Period = '7' | '30' | '90';

/** Dépenses et tokens par modèle et par jour, à partir des réponses enregistrées. */
export function UsagePage() {
  const { t } = useTranslation();
  useWindowTitle(t('usage.title'));
  const [period, setPeriod] = useState<Period>('30');
  const [rows, setRows] = useState<UsageRow[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    usage(Number(period))
      .then(setRows)
      .catch((err) => toast.error(errorMessage(err)));
  }, [period]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          cost: acc.cost + r.cost,
          tokens: acc.tokens + r.promptTokens + r.completionTokens,
          messages: acc.messages + r.messages,
        }),
        { cost: 0, tokens: 0, messages: 0 },
      ),
    [rows],
  );

  const byModel = useMemo(() => aggregate(rows, (r) => r.model), [rows]);
  const byDay = useMemo(
    () => aggregate(rows, (r) => r.day).sort((a, b) => b.key.localeCompare(a.key)),
    [rows],
  );
  const maxModelCost = Math.max(0, ...byModel.map((m) => m.cost));
  const maxDayCost = Math.max(0, ...byDay.map((d) => d.cost));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <BarChart3 className="size-4 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t('usage.title')}</h1>
          <Segmented
            className="ml-auto"
            label={t('usage.title')}
            value={period}
            onChange={setPeriod}
            options={[
              { value: '7', label: t('usage.period7') },
              { value: '30', label: t('usage.period30') },
              { value: '90', label: t('usage.period90') },
            ]}
          />
        </div>
        <p className="text-sm text-muted-foreground">{t('usage.description')}</p>

        <div className="grid gap-3 sm:grid-cols-3">
          <Tile
            label={t('usage.totalCost')}
            value={`${formatCost(totals.cost)} $`}
            icon={Coins}
            tone="bg-success/15 text-success"
          />
          <Tile
            label={t('usage.totalTokens')}
            value={formatTokens(totals.tokens)}
            icon={Hash}
            tone="bg-info/15 text-info"
          />
          <Tile
            label={t('usage.totalMessages')}
            value={String(totals.messages)}
            icon={MessagesSquare}
            tone="bg-chart-1/15 text-chart-1"
          />
        </div>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {isTauri() ? t('usage.noData') : t('common.onlyInApp')}
          </p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{t('usage.byModel')}</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  items={byModel.map((m) => ({
                    key: m.key,
                    label: m.key,
                    cost: m.cost,
                    detail: `${formatTokens(m.promptTokens)} ${t('usage.promptTokens')} · ${formatTokens(m.completionTokens)} ${t('usage.completionTokens')} · ${m.messages}`,
                  }))}
                  max={maxModelCost}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('usage.byDay')}</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  items={byDay.map((d) => ({
                    key: d.key,
                    label: new Date(`${d.key}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    }),
                    cost: d.cost,
                    detail: `${formatTokens(d.promptTokens + d.completionTokens)} · ${d.messages}`,
                  }))}
                  max={maxDayCost}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

interface Aggregate {
  key: string;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  messages: number;
}

function aggregate(rows: UsageRow[], keyOf: (r: UsageRow) => string): Aggregate[] {
  const map = new Map<string, Aggregate>();
  for (const r of rows) {
    const key = keyOf(r);
    const acc = map.get(key) ?? { key, cost: 0, promptTokens: 0, completionTokens: 0, messages: 0 };
    acc.cost += r.cost;
    acc.promptTokens += r.promptTokens;
    acc.completionTokens += r.completionTokens;
    acc.messages += r.messages;
    map.set(key, acc);
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost);
}

function Tile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
      <div
        className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', tone)}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate font-mono text-xl font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function BarList({
  items,
  max,
}: {
  items: Array<{ key: string; label: string; cost: number; detail: string }>;
  max: number;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => (
        <li key={item.key} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs">
              <span className={cn('size-2 shrink-0 rounded-full', chartBg(i))} aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums">
              {formatCost(item.cost)} $
            </span>
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <div
              className={cn('h-full rounded-full transition-all', chartBg(i))}
              style={{ width: `${max > 0 ? Math.max(2, (item.cost / max) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}
