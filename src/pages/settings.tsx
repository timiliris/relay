import { Link } from '@tanstack/react-router';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { platform } from '@tauri-apps/plugin-os';
import { ArrowLeft, BookOpen, Download, KeyRound, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '@/components/language-toggle';
import { ModelPicker } from '@/components/model-picker';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { exportAll } from '@/lib/db';
import { formatCost } from '@/lib/format';
import { openExternal } from '@/lib/open-external';
import { type Credits, openrouter } from '@/lib/openrouter';
import { errorMessage, isTauri } from '@/lib/tauri';
import { checkForUpdates, type UpdateStatus } from '@/lib/updater';
import { useApiKey } from '@/stores/api-key';
import { defaultGeneration, useSettings } from '@/stores/settings';

/** Doit rester identique à `SHORTCUT` dans src-tauri/src/shortcut.rs. */
const SHORTCUT = isTauri() && platform() === 'macos' ? '⌘ ⇧ Espace' : 'Ctrl+Shift+Espace';

export function SettingsPage() {
  const { t } = useTranslation();
  const inTauri = isTauri();
  const settings = useSettings();
  const { hint, save: saveKey, clear: clearKey } = useApiKey();
  const [keyInput, setKeyInput] = useState('');
  const [keyMessage, setKeyMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [testing, setTesting] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateDetail, setUpdateDetail] = useState('');

  useEffect(() => {
    if (inTauri) isEnabled().then(setAutostart).catch(console.error);
  }, [inTauri]);

  const onSaveKey = async (e: FormEvent) => {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) {
      setKeyMessage({ ok: false, text: t('errors.api_key_empty') });
      return;
    }
    try {
      await saveKey(key);
      setKeyInput('');
      setKeyMessage({ ok: true, text: t('settings.apiKeySaved') });
      setCredits(null);
    } catch (err) {
      setKeyMessage({ ok: false, text: errorMessage(err) });
    }
  };

  const onClearKey = async () => {
    try {
      await clearKey();
      setCredits(null);
      setKeyMessage({ ok: true, text: t('settings.apiKeyCleared') });
    } catch (err) {
      setKeyMessage({ ok: false, text: errorMessage(err) });
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      setCredits(await openrouter.fetchCredits());
      setKeyMessage(null);
    } catch (err) {
      setCredits(null);
      setKeyMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const toggleAutostart = async (checked: boolean) => {
    try {
      await (checked ? enable() : disable());
      setAutostart(await isEnabled());
    } catch (err) {
      setExportMessage(errorMessage(err));
    }
  };

  const onExportAll = async () => {
    try {
      const path = await save({
        defaultPath: `relay-export-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) return;
      await writeTextFile(path, JSON.stringify(await exportAll(), null, 2));
      setExportMessage(t('settings.exportedAll'));
    } catch (err) {
      setExportMessage(errorMessage(err));
    }
  };

  const updateLabel = (): string => {
    switch (updateStatus) {
      case 'idle':
        return '';
      case 'checking':
        return t('updates.status.checking');
      case 'up-to-date':
        return t('updates.status.upToDate');
      case 'available':
        return t('updates.status.available', { version: updateDetail });
      case 'downloading':
        return t('updates.status.downloading', { percent: updateDetail });
      case 'installed':
        return t('updates.status.installed');
      case 'error':
        return t('updates.status.error', { detail: updateDetail });
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            aria-label={t('common.back')}
          >
            <ArrowLeft />
          </Link>
          <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" />
              {t('settings.apiKey')}
            </CardTitle>
            <CardDescription>{t('settings.apiKeyHelp')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              {hint ? t('settings.apiKeyConfigured', { hint }) : t('settings.apiKeyMissing')}
            </p>
            <form onSubmit={(e) => void onSaveKey(e)} className="flex gap-2">
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
                onClick={() => void testConnection()}
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
                {t('settings.getKey')}
              </Button>
              {hint && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onClearKey()}
                  className="text-destructive"
                >
                  <Trash2 />
                  {t('common.delete')}
                </Button>
              )}
            </div>
            {credits && (
              <p className="text-muted-foreground">
                {t('settings.credits')} :{' '}
                <strong className="text-foreground">
                  {t('settings.creditsRemaining', {
                    amount: formatCost(credits.totalCredits - credits.totalUsage),
                  })}
                </strong>{' '}
                (
                {t('settings.creditsUsed', {
                  amount: formatCost(credits.totalUsage),
                  total: formatCost(credits.totalCredits),
                })}
                )
              </p>
            )}
            {keyMessage && (
              <p className={keyMessage.ok ? 'text-muted-foreground' : 'text-destructive'}>
                {keyMessage.text}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.defaults')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <Row label={t('settings.defaultModel')}>
              <ModelPicker
                value={settings.defaultModel}
                onChange={(id) => settings.patch({ defaultModel: id })}
                align="end"
              />
            </Row>
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
            <Row label={t('params.maxTokens')}>
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
            <Field label={t('params.systemPrompt')}>
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
              />
            </Row>
            <div>
              <Button variant="ghost" size="sm" onClick={() => settings.patch(defaultGeneration)}>
                {t('params.reset')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.appearance')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <Row label={t('theme.label')}>
                <ThemeToggle />
              </Row>
              <Row label={t('language.label')}>
                <LanguageToggle />
              </Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.notifications')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <Row label={t('settings.notifyOnComplete')}>
                <Switch
                  checked={settings.notifyOnComplete}
                  onCheckedChange={(v) => settings.patch({ notifyOnComplete: v })}
                />
              </Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.startup')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <Row label={t('settings.autostart')} hint={t('settings.autostartHint')}>
                <Switch
                  checked={autostart}
                  onCheckedChange={(v) => void toggleAutostart(v)}
                  disabled={!inTauri}
                  aria-label={t('settings.autostart')}
                />
              </Row>
              <Row
                label={t('settings.shortcut')}
                hint={t('settings.shortcutHint', { shortcut: SHORTCUT })}
              >
                <kbd className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs">
                  {SHORTCUT}
                </kbd>
              </Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.data')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onExportAll()}
                disabled={!inTauri}
              >
                <Download />
                {t('settings.exportAll')}
              </Button>
              {exportMessage && <p className="text-muted-foreground">{exportMessage}</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.about')}</CardTitle>
            <CardDescription>
              {t('settings.version', { version: __APP_VERSION__ })} · {t('app.tagline')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-sm">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openExternal('https://openrouter.ai/docs')}
            >
              <BookOpen />
              {t('settings.docs')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!inTauri || updateStatus === 'checking' || updateStatus === 'downloading'}
              onClick={() =>
                void checkForUpdates({
                  onStatus: (status, detail) => {
                    setUpdateStatus(status);
                    setUpdateDetail(detail ?? '');
                  },
                })
              }
            >
              <RefreshCw className={updateStatus === 'checking' ? 'animate-spin' : undefined} />
              {t('settings.checkUpdates')}
            </Button>
            <span className="text-xs text-muted-foreground" role="status">
              {updateLabel()}
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p>{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
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
