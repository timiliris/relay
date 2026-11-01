import { Drama, RotateCcw, ShieldAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveLanguage } from '@/i18n';
import type { Preset } from '@/lib/db';
import {
  buildSystemPrompt,
  defaultPersona,
  NEUTRAL,
  type Persona,
  type Roleplay,
  TRAIT_KEYS,
  type TraitKey,
  traitLevel,
} from '@/lib/persona';
import { cn } from '@/lib/utils';
import { dialog } from '@/stores/dialog';
import { useSettings } from '@/stores/settings';
import { ModelPicker } from './model-picker';
import { PresetAvatar } from './preset-avatar';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Segmented } from './ui/segmented';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';

type Tab = 'identity' | 'personality' | 'roleplay' | 'advanced';

interface PersonaEditorProps {
  preset: Preset;
  onChange: (preset: Preset) => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Éditeur complet d'un persona : identité et mode, traits par curseurs, fiche de jeu
 * de rôle, paramètres avancés, avec aperçu de l'instruction système composée.
 */
export function PersonaEditor({ preset, onChange, onSave, onCancel }: PersonaEditorProps) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const adultConfirmed = useSettings((s) => s.adultConfirmed);
  const patchSettings = useSettings((s) => s.patch);
  const [tab, setTab] = useState<Tab>('identity');
  const { persona } = preset;

  const setPersona = (patch: Partial<Persona>) =>
    onChange({ ...preset, persona: { ...persona, ...patch } });
  const setTrait = (key: TraitKey, value: number) =>
    setPersona({ traits: { ...persona.traits, [key]: value } });
  const setRoleplay = (patch: Partial<Roleplay>) =>
    setPersona({ roleplay: { ...persona.roleplay, ...patch } });

  const toggleMature = async (on: boolean) => {
    if (on && !adultConfirmed) {
      const ok = await dialog.confirm({
        title: t('presets.matureConfirmTitle'),
        message: t('presets.matureConfirmBody'),
        confirmLabel: t('presets.matureConfirmYes'),
      });
      if (!ok) return;
      patchSettings({ adultConfirmed: true });
    }
    setPersona({ mature: on });
  };

  const preview = buildSystemPrompt(preset, resolveLanguage(language));
  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'identity', label: t('presets.tabIdentity') },
    { value: 'personality', label: t('presets.tabPersonality') },
    { value: 'roleplay', label: t('presets.tabRoleplay') },
    { value: 'advanced', label: t('presets.tabAdvanced') },
  ];

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (preset.name.trim()) onSave();
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <PresetAvatar preset={preset} className="size-9 text-sm" />
        <Input
          autoFocus
          value={preset.name}
          onChange={(e) => onChange({ ...preset, name: e.target.value })}
          placeholder={t('presets.namePlaceholder')}
          aria-label={t('presets.name')}
          className="h-9 max-w-xs"
        />
        <Segmented
          label={t('presets.mode')}
          value={persona.mode}
          onChange={(mode) => setPersona({ mode })}
          options={[
            { value: 'assistant', label: t('presets.modeAssistant') },
            { value: 'roleplay', label: t('presets.modeRoleplay') },
          ]}
        />
      </div>

      <Segmented
        label={t('presets.tabs')}
        value={tab}
        onChange={setTab}
        options={tabs}
        className="self-start"
      />

      {tab === 'identity' && (
        <div className="flex flex-col gap-4">
          <Field label={t('presets.instructions')} hint={t('presets.instructionsHint')}>
            <Textarea
              value={preset.systemPrompt ?? ''}
              onChange={(e) => onChange({ ...preset, systemPrompt: e.target.value || null })}
              placeholder={t('params.systemPromptPlaceholder')}
              className="min-h-24 font-sans"
            />
          </Field>
          <Field label={t('presets.model')}>
            <div className="flex items-center gap-2">
              <ModelPicker
                value={preset.model ?? ''}
                onChange={(id) => onChange({ ...preset, model: id })}
              />
              {preset.model && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange({ ...preset, model: null })}
                >
                  {t('common.none')}
                </Button>
              )}
            </div>
          </Field>
          <div
            className={cn(
              'flex items-center justify-between gap-4 rounded-md border px-3 py-2 transition-colors',
              persona.mature && 'border-destructive/40 bg-destructive/5',
            )}
          >
            <div className="flex min-w-0 items-start gap-2">
              <ShieldAlert
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  persona.mature ? 'text-destructive' : 'text-muted-foreground',
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-medium">{t('presets.mature')}</p>
                <p className="text-xs text-muted-foreground">{t('presets.matureHint')}</p>
              </div>
            </div>
            <Switch
              checked={persona.mature}
              onCheckedChange={(v) => void toggleMature(v)}
              aria-label={t('presets.mature')}
              className={cn(persona.mature && 'bg-destructive')}
            />
          </div>
        </div>
      )}

      {tab === 'personality' && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">{t('presets.traitsHint')}</p>
          {TRAIT_KEYS.map((key) => (
            <TraitSlider
              key={key}
              traitKey={key}
              value={persona.traits[key]}
              onChange={(v) => setTrait(key, v)}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground"
            onClick={() => setPersona({ traits: defaultPersona().traits })}
          >
            <RotateCcw />
            {t('presets.resetTraits')}
          </Button>
        </div>
      )}

      {tab === 'roleplay' && (
        <div className="flex flex-col gap-4">
          {persona.mode !== 'roleplay' && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-chart-1/40 bg-chart-1/5 px-3 py-2 text-xs">
              <span className="inline-flex items-center gap-2">
                <Drama className="size-4 text-chart-1" aria-hidden="true" />
                {t('presets.roleplayOnly')}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPersona({ mode: 'roleplay' })}
              >
                {t('presets.switchToRoleplay')}
              </Button>
            </div>
          )}
          <Field label={t('presets.rpCharacter')}>
            <Textarea
              value={persona.roleplay.character}
              onChange={(e) => setRoleplay({ character: e.target.value })}
              placeholder={t('presets.rpCharacterPlaceholder')}
              className="min-h-24 font-sans"
            />
          </Field>
          <Field label={t('presets.rpScenario')}>
            <Textarea
              value={persona.roleplay.scenario}
              onChange={(e) => setRoleplay({ scenario: e.target.value })}
              placeholder={t('presets.rpScenarioPlaceholder')}
              className="min-h-20 font-sans"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label={t('presets.rpUserName')}>
              <Input
                value={persona.roleplay.userName}
                onChange={(e) => setRoleplay({ userName: e.target.value })}
                placeholder={t('presets.rpUserNamePlaceholder')}
                className="h-8"
              />
            </Field>
            <Field label={t('presets.rpUserPersona')}>
              <Input
                value={persona.roleplay.userPersona}
                onChange={(e) => setRoleplay({ userPersona: e.target.value })}
                placeholder={t('presets.rpUserPersonaPlaceholder')}
                className="h-8"
              />
            </Field>
          </div>
          <Field label={t('presets.rpGreeting')} hint={t('presets.rpGreetingHint')}>
            <Textarea
              value={persona.roleplay.greeting}
              onChange={(e) => setRoleplay({ greeting: e.target.value })}
              placeholder={t('presets.rpGreetingPlaceholder')}
              className="min-h-20 font-sans"
            />
          </Field>
          <div className="flex flex-wrap gap-6">
            <Field label={t('presets.rpPov')}>
              <Segmented
                label={t('presets.rpPov')}
                value={persona.roleplay.pov}
                onChange={(pov) => setRoleplay({ pov })}
                options={[
                  { value: 'first', label: t('presets.rpPovFirst') },
                  { value: 'third', label: t('presets.rpPovThird') },
                ]}
              />
            </Field>
            <Field label={t('presets.rpFormat')}>
              <Segmented
                label={t('presets.rpFormat')}
                value={persona.roleplay.format}
                onChange={(format) => setRoleplay({ format })}
                options={[
                  { value: 'novel', label: t('presets.rpFormatNovel') },
                  { value: 'chat', label: t('presets.rpFormatChat') },
                ]}
              />
            </Field>
          </div>
        </div>
      )}

      {tab === 'advanced' && (
        <div className="flex flex-col gap-4">
          <Field
            label={t('params.temperature')}
            value={
              preset.temperature === null
                ? t('params.maxTokensAuto')
                : preset.temperature.toFixed(2)
            }
          >
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={preset.temperature ?? 0.7}
              onValueChange={(v) => onChange({ ...preset, temperature: v })}
            />
          </Field>
          <div className="flex items-center justify-between gap-4">
            <p>{t('params.reasoning')}</p>
            <Switch
              checked={preset.reasoning ?? true}
              onCheckedChange={(v) => onChange({ ...preset, reasoning: v })}
              aria-label={t('params.reasoning')}
            />
          </div>
        </div>
      )}

      <details className="group rounded-md border bg-muted/30 text-xs">
        <summary className="cursor-pointer select-none px-3 py-2 text-muted-foreground hover:text-foreground">
          {t('presets.preview')}
        </summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t px-3 py-2 font-sans leading-relaxed">
          {preview ?? t('presets.previewEmpty')}
        </pre>
      </details>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!preset.name.trim()}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

/** Curseur 0–100 avec les deux pôles nommés et le palier courant en clair. */
function TraitSlider({
  traitKey,
  value,
  onChange,
}: {
  traitKey: TraitKey;
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  const low = t(`presets.traits.${traitKey}.low`);
  const high = t(`presets.traits.${traitKey}.high`);
  const level = traitLevel(value);
  const levelLabel =
    level === 0
      ? t('presets.levelNeutral')
      : t(Math.abs(level) === 2 ? 'presets.levelVery' : 'presets.levelRather', {
          label: level < 0 ? low : high,
        });
  // Teinte : neutre en gris, puis de plus en plus saturé vers chaque pôle.
  const tone = level === 0 ? 'text-muted-foreground' : level < 0 ? 'text-info' : 'text-chart-1';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium">{t(`presets.traits.${traitKey}.label`)}</span>
        <span className={cn('font-medium transition-colors', tone)}>{levelLabel}</span>
      </div>
      <Slider
        min={0}
        max={100}
        step={5}
        value={value}
        onValueChange={onChange}
        aria-label={t(`presets.traits.${traitKey}.label`)}
        aria-valuetext={levelLabel}
        list={`trait-${traitKey}-ticks`}
      />
      <datalist id={`trait-${traitKey}-ticks`}>
        <option value={NEUTRAL} />
      </datalist>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span className="capitalize">{low}</span>
        <span className="capitalize">{high}</span>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  children,
}: {
  label: string;
  hint?: string;
  value?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3 text-xs">
        <span>{label}</span>
        {value && <span className="font-mono text-muted-foreground">{value}</span>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
