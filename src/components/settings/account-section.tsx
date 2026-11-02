import { ExternalLink, KeyRound, Trash2, Wifi } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCost } from '@/lib/format';
import { openExternal } from '@/lib/open-external';
import { type Credits, openrouter } from '@/lib/openrouter';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useApiKey } from '@/stores/api-key';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { SettingsSection } from './primitives';

/** Clé API OpenRouter : état, enregistrement dans le trousseau, test et crédits. */
export function AccountSection() {
  const { t } = useTranslation();
  const inTauri = isTauri();
  const { hint, save: saveKey, clear: clearKey } = useApiKey();
  const [keyInput, setKeyInput] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [testing, setTesting] = useState(false);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) {
      setMessage({ ok: false, text: t('errors.api_key_empty') });
      return;
    }
    try {
      await saveKey(key);
      setKeyInput('');
      setMessage({ ok: true, text: t('settings.apiKeySaved') });
      setCredits(null);
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  };

  const onClear = async () => {
    try {
      await clearKey();
      setCredits(null);
      setMessage({ ok: true, text: t('settings.apiKeyCleared') });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      setCredits(await openrouter.fetchCredits());
      setMessage(null);
    } catch (err) {
      setCredits(null);
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsSection
      id="account"
      icon={KeyRound}
      title={t('settings.apiKey')}
      description={t('settings.apiKeyHelp')}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn('size-2 rounded-full', hint ? 'bg-success' : 'bg-warning')}
          aria-hidden="true"
        />
        <span className={hint ? undefined : 'text-muted-foreground'}>
          {hint ? t('settings.apiKeyConfigured', { hint }) : t('settings.apiKeyMissing')}
        </span>
      </div>

      <form onSubmit={(e) => void onSave(e)} className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={t('settings.apiKeyPlaceholder')}
          aria-label={t('settings.apiKey')}
          disabled={!inTauri}
        />
        <Button type="submit" disabled={!inTauri || !keyInput.trim()}>
          {t('common.save')}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void test()}
          disabled={!inTauri || !hint || testing}
        >
          <Wifi className={testing ? 'animate-pulse' : undefined} />
          {t('settings.testConnection')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openExternal('https://openrouter.ai/settings/keys')}
        >
          <ExternalLink />
          {t('settings.getKey')}
        </Button>
        {hint && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onClear()}
            className="ml-auto text-destructive hover:text-destructive"
          >
            <Trash2 />
            {t('common.delete')}
          </Button>
        )}
      </div>

      {credits && (
        <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 sm:grid-cols-3">
          <Stat
            label={t('settings.creditsRemainingLabel')}
            value={formatCost(credits.totalCredits - credits.totalUsage)}
            tone="text-success"
          />
          <Stat label={t('settings.creditsUsedLabel')} value={formatCost(credits.totalUsage)} />
          <Stat label={t('settings.creditsTotalLabel')} value={formatCost(credits.totalCredits)} />
        </dl>
      )}
      {message && (
        <p role="status" className={message.ok ? 'text-muted-foreground' : 'text-destructive'}>
          {message.text}
        </p>
      )}
    </SettingsSection>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('font-mono text-sm font-semibold tabular-nums', tone)}>{value}</dd>
    </div>
  );
}
