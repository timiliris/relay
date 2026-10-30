import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { effectiveParams } from '@/lib/chat-service';
import type { Conversation } from '@/lib/db';
import { useConversations } from '@/stores/conversations';
import { defaultGeneration, useSettings } from '@/stores/settings';
import { Button } from './ui/button';
import { Dropdown } from './ui/dropdown';
import { Input } from './ui/input';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';

interface GenerationParamsProps {
  /** Conversation ouverte : les réglages lui sont propres ; `null` : valeurs globales. */
  conversation: Conversation | null;
}

/** Panneau des paramètres de génération, ancré au composer. */
export function GenerationParams({ conversation }: GenerationParamsProps) {
  const { t } = useTranslation();
  const settings = useSettings();
  const update = useConversations((s) => s.update);

  const values = conversation
    ? { ...effectiveParams(conversation), systemPrompt: conversation.systemPrompt ?? '' }
    : {
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens: settings.maxTokens,
        reasoning: settings.reasoning,
        webSearch: settings.webSearch,
        systemPrompt: settings.systemPrompt,
      };

  const set = (patch: {
    temperature?: number;
    topP?: number | null;
    maxTokens?: number | null;
    reasoning?: boolean;
    systemPrompt?: string;
  }) => {
    if (conversation) {
      void update(conversation.id, {
        ...(patch.temperature !== undefined ? { temperature: patch.temperature } : {}),
        ...(patch.topP !== undefined ? { topP: patch.topP } : {}),
        ...(patch.maxTokens !== undefined ? { maxTokens: patch.maxTokens } : {}),
        ...(patch.reasoning !== undefined ? { reasoning: patch.reasoning } : {}),
        ...(patch.systemPrompt !== undefined
          ? { systemPrompt: patch.systemPrompt.trim() || null }
          : {}),
      });
    } else {
      settings.patch(patch);
    }
  };

  const reset = () => {
    if (conversation) {
      void update(conversation.id, {
        temperature: null,
        topP: null,
        maxTokens: null,
        reasoning: null,
      });
    } else {
      settings.patch(defaultGeneration);
    }
  };

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
          <span className="font-mono text-xs">T {values.temperature.toFixed(1)}</span>
        </Button>
      )}
    >
      {() => (
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {conversation ? t('params.scopeConversation') : t('params.scopeGlobal')}
          </p>
          <Field label={t('params.temperature')} value={values.temperature.toFixed(2)}>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={values.temperature}
              onValueChange={(v) => set({ temperature: v })}
            />
          </Field>
          <Field
            label={t('params.topP')}
            value={values.topP === null ? t('params.maxTokensAuto') : values.topP.toFixed(2)}
          >
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={values.topP ?? 1}
              onValueChange={(v) => set({ topP: v >= 1 ? null : v })}
            />
          </Field>
          <Field label={t('params.maxTokens')}>
            <Input
              type="number"
              min={1}
              step={256}
              placeholder={t('params.maxTokensAuto')}
              value={values.maxTokens ?? ''}
              onChange={(e) => set({ maxTokens: e.target.value ? Number(e.target.value) : null })}
              className="h-8"
            />
          </Field>
          <Field label={t('params.systemPrompt')}>
            <Textarea
              value={values.systemPrompt}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              placeholder={t('params.systemPromptPlaceholder')}
              className="min-h-20 font-sans text-xs"
            />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs">{t('params.reasoning')}</span>
            <Switch
              checked={values.reasoning}
              onCheckedChange={(v) => set({ reasoning: v })}
              aria-label={t('params.reasoning')}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
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
