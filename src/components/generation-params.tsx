import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { defaultGeneration, useSettings } from '@/stores/settings';
import { Button } from './ui/button';
import { Dropdown } from './ui/dropdown';
import { Input } from './ui/input';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';

/** Panneau des paramètres de génération (valeurs globales, appliquées aux prochains envois). */
export function GenerationParams({
  systemPrompt,
  onSystemPromptChange,
}: {
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const { temperature, maxTokens, topP, reasoning, patch } = useSettings();

  return (
    <Dropdown
      align="start"
      side="top"
      className="w-80 max-h-[70vh] overflow-y-auto p-3"
      trigger={({ toggle }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-label={t('params.title')}
          title={t('params.title')}
          className="gap-1.5 text-muted-foreground"
        >
          <SlidersHorizontal className="size-4" />
          <span className="font-mono text-xs">T {temperature.toFixed(1)}</span>
        </Button>
      )}
    >
      {() => (
        <div className="flex flex-col gap-4 text-sm">
          <Field label={t('params.temperature')} value={temperature.toFixed(2)}>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={temperature}
              onValueChange={(v) => patch({ temperature: v })}
            />
          </Field>
          <Field
            label={t('params.topP')}
            value={topP === null ? t('params.maxTokensAuto') : topP.toFixed(2)}
          >
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={topP ?? 1}
              onValueChange={(v) => patch({ topP: v >= 1 ? null : v })}
            />
          </Field>
          <Field label={t('params.maxTokens')}>
            <Input
              type="number"
              min={1}
              step={256}
              placeholder={t('params.maxTokensAuto')}
              value={maxTokens ?? ''}
              onChange={(e) => patch({ maxTokens: e.target.value ? Number(e.target.value) : null })}
              className="h-8"
            />
          </Field>
          <Field label={t('params.systemPrompt')}>
            <Textarea
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              placeholder={t('params.systemPromptPlaceholder')}
              className="min-h-20 font-sans text-xs"
            />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs">{t('params.reasoning')}</span>
            <Switch
              checked={reasoning}
              onCheckedChange={(v) => patch({ reasoning: v })}
              aria-label={t('params.reasoning')}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => patch(defaultGeneration)}>
            {t('params.reset')}
          </Button>
        </div>
      )}
    </Dropdown>
  );
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        {value && <span className="font-mono text-muted-foreground">{value}</span>}
      </div>
      {children}
    </div>
  );
}
