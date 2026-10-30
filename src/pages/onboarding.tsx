import { useNavigate } from '@tanstack/react-router';
import { Check, KeyRound, Sparkles, Wifi } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModelPicker } from '@/components/model-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCost } from '@/lib/format';
import { openExternal } from '@/lib/open-external';
import { openrouter } from '@/lib/openrouter';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useApiKey } from '@/stores/api-key';
import { useSettings } from '@/stores/settings';

type Step = 0 | 1 | 2;

/** Assistant de premier lancement : clé API, modèle par défaut, c'est parti. */
export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettings();
  const { hint, save } = useApiKey();
  const [step, setStep] = useState<Step>(0);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const inTauri = isTauri();

  const finish = () => {
    settings.patch({ onboarded: true });
    void navigate({ to: '/' });
  };

  const saveAndTest = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setTesting(true);
    try {
      await save(trimmed);
      const credits = await openrouter.fetchCredits();
      setStatus({
        ok: true,
        text: t('onboarding.keyOk', {
          amount: formatCost(credits.totalCredits - credits.totalUsage),
        }),
      });
      setKey('');
    } catch (err) {
      setStatus({ ok: false, text: t('onboarding.keyFail', { error: errorMessage(err) }) });
    } finally {
      setTesting(false);
    }
  };

  const steps = [t('onboarding.stepKey'), t('onboarding.stepModel'), t('onboarding.stepDone')];

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t('onboarding.welcome')}</h1>
            <p className="text-sm text-muted-foreground">{t('onboarding.intro')}</p>
          </div>
        </div>

        <ol className="mb-6 flex gap-2" aria-label={t('onboarding.welcome')}>
          {steps.map((label, i) => (
            <li key={label} className="flex flex-1 flex-col gap-1.5">
              <span className={cn('h-1 rounded-full', i <= step ? 'bg-primary' : 'bg-muted')} />
              <span
                className={cn(
                  'text-[11px]',
                  i === step ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <form onSubmit={(e) => void saveAndTest(e)} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t('onboarding.stepKeyHelp')}</p>
            {hint && (
              <p className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-primary" />
                {t('settings.apiKeyConfigured', { hint })}
              </p>
            )}
            <div className="flex gap-2">
              <Input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t('settings.apiKeyPlaceholder')}
                aria-label={t('settings.apiKey')}
                disabled={!inTauri}
                autoFocus
              />
              <Button type="submit" disabled={!inTauri || !key.trim() || testing}>
                <Wifi className={testing ? 'animate-pulse' : undefined} />
                {t('settings.testConnection')}
              </Button>
            </div>
            {status && (
              <p
                className={cn('text-sm', status.ok ? 'text-muted-foreground' : 'text-destructive')}
              >
                {status.text}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => openExternal('https://openrouter.ai/settings/keys')}
            >
              <KeyRound />
              {t('settings.getKey')}
            </Button>
          </form>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t('onboarding.stepModelHelp')}</p>
            <ModelPicker
              value={settings.defaultModel}
              onChange={(id) => settings.patch({ defaultModel: id })}
              className="max-w-none"
            />
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t('onboarding.stepDoneHelp')}</p>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={finish}>
            {t('onboarding.skip')}
          </Button>
          {step < 2 ? (
            <Button onClick={() => setStep((s) => (s + 1) as Step)}>{t('onboarding.next')}</Button>
          ) : (
            <Button onClick={finish}>{t('onboarding.finish')}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
