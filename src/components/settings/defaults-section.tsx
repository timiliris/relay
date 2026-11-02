import { MessagesSquare, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { defaultGeneration, useSettings } from '@/stores/settings';
import { ModelPicker } from '../model-picker';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Slider } from '../ui/slider';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import { Field, Group, Row, SettingsSection } from './primitives';

/** Valeurs reprises par chaque nouvelle conversation (modèle, génération, comportement). */
export function DefaultsSection() {
  const { t } = useTranslation();
  const settings = useSettings();

  return (
    <SettingsSection
      id="conversations"
      icon={MessagesSquare}
      title={t('settings.defaults')}
      description={t('settings.defaultsHelp')}
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => settings.patch(defaultGeneration)}
        >
          <RotateCcw />
          {t('params.reset')}
        </Button>
      }
    >
      <Row label={t('settings.defaultModel')}>
        <ModelPicker
          value={settings.defaultModel}
          onChange={(id) => settings.patch({ defaultModel: id })}
          align="end"
        />
      </Row>

      <Group title={t('settings.generation')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('params.temperature')} value={settings.temperature.toFixed(2)}>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={settings.temperature}
              onValueChange={(v) => settings.patch({ temperature: v })}
            />
          </Field>
          <Field
            label={t('params.topP')}
            value={settings.topP === null ? t('params.maxTokensAuto') : settings.topP.toFixed(2)}
          >
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={settings.topP ?? 1}
              onValueChange={(v) => settings.patch({ topP: v >= 1 ? null : v })}
            />
          </Field>
        </div>
        <Row label={t('params.maxTokens')} hint={t('settings.maxTokensHint')}>
          <Input
            type="number"
            min={1}
            step={256}
            className="h-8 w-32"
            placeholder={t('params.maxTokensAuto')}
            value={settings.maxTokens ?? ''}
            onChange={(e) =>
              settings.patch({ maxTokens: e.target.value ? Number(e.target.value) : null })
            }
          />
        </Row>
      </Group>

      <Group title={t('settings.behavior')}>
        <Field label={t('params.systemPrompt')} hint={t('settings.systemPromptHint')}>
          <Textarea
            value={settings.systemPrompt}
            onChange={(e) => settings.patch({ systemPrompt: e.target.value })}
            placeholder={t('params.systemPromptPlaceholder')}
            className="min-h-20 font-sans"
          />
        </Field>
        <Row label={t('params.reasoning')}>
          <Switch
            checked={settings.reasoning}
            onCheckedChange={(v) => settings.patch({ reasoning: v })}
            aria-label={t('params.reasoning')}
          />
        </Row>
        <Row label={t('params.webSearch')}>
          <Switch
            checked={settings.webSearch}
            onCheckedChange={(v) => settings.patch({ webSearch: v })}
            aria-label={t('params.webSearch')}
          />
        </Row>
        <Row label={t('settings.autoTitle')}>
          <Switch
            checked={settings.autoTitle}
            onCheckedChange={(v) => settings.patch({ autoTitle: v })}
            aria-label={t('settings.autoTitle')}
          />
        </Row>
      </Group>
    </SettingsSection>
  );
}
