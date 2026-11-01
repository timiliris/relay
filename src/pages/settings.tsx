import { Link } from '@tanstack/react-router';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { platform } from '@tauri-apps/plugin-os';
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Download,
  FileDown,
  FileUp,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
  Wifi,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '@/components/language-toggle';
import { ModelPicker } from '@/components/model-picker';
import { PersonaEditor } from '@/components/persona-editor';
import { PresetAvatar, PresetBadges } from '@/components/preset-avatar';
import { SnippetSettings } from '@/components/snippet-settings';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useWindowTitle } from '@/hooks/use-window-title';
import { resolveLanguage } from '@/i18n';
import {
  CardError,
  cardFromPreset,
  parseCharacterCard,
  presetFromCard,
  serializeCard,
} from '@/lib/character-card';
import { exportAll, newId, type Preset } from '@/lib/db';
import { formatCost } from '@/lib/format';
import { importConversations, parseImport } from '@/lib/import';
import { openExternal } from '@/lib/open-external';
import { type Credits, openrouter, type ProviderSort } from '@/lib/openrouter';
import { defaultPersona } from '@/lib/persona';
import { errorMessage, isTauri } from '@/lib/tauri';
import { checkForUpdates, type UpdateStatus } from '@/lib/updater';
import { cn } from '@/lib/utils';
import { useApiKey } from '@/stores/api-key';
import { useConversations } from '@/stores/conversations';
import { dialog } from '@/stores/dialog';
import { usePersonaMemory } from '@/stores/persona-memory';
import { type Accent, defaultGeneration, useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';

/** Doit rester identique à `SHORTCUT` dans src-tauri/src/shortcut.rs. */
const isMac = isTauri() && platform() === 'macos';
const SHORTCUT = isMac ? '⌘ ⇧ Espace' : 'Ctrl+Shift+Espace';
const MOD = isMac ? '⌘' : 'Ctrl';
const ACCENTS: Accent[] = ['neutral', 'violet', 'blue', 'green', 'amber', 'rose'];

export function SettingsPage() {
  const { t } = useTranslation();
  useWindowTitle(t('settings.title'));
  const inTauri = isTauri();
  const settings = useSettings();
  const { hint, save: saveKey, clear: clearKey } = useApiKey();
  const conversations = useConversations();
  const [keyInput, setKeyInput] = useState('');
  const [keyMessage, setKeyMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [testing, setTesting] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateDetail, setUpdateDetail] = useState('');
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null);
  const memoryCounts = usePersonaMemory((s) => s.counts);
  const loadMemoryCounts = usePersonaMemory((s) => s.loadCounts);

  useEffect(() => {
    void loadMemoryCounts();
  }, [loadMemoryCounts]);

  useEffect(() => {
    if (inTauri) isEnabled().then(setAutostart).catch(console.error);
  }, [inTauri]);

  const confirm = (message: string) =>
    dialog.confirm({
      title: t('common.delete'),
      message,
      confirmLabel: t('common.delete'),
      destructive: true,
    });

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
      toast.error(errorMessage(err));
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
      toast.success(t('settings.exportedAll'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onImport = async () => {
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) return;
      const parsed = parseImport(JSON.parse(await readTextFile(path)) as unknown);
      const result = await importConversations(parsed, settings.defaultModel);
      await conversations.load();
      toast.success(t('settings.imported', result));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message === 'unrecognized'
          ? t('settings.importFailed')
          : errorMessage(err),
      );
    }
  };

  const onDeleteAll = async () => {
    if (!(await confirm(t('settings.deleteAllConfirm')))) return;
    for (const c of conversations.items) await conversations.remove(c.id);
    toast.success(t('settings.deletedAll'));
  };

  const savePreset = async (preset: Preset) => {
    await conversations.savePreset(preset);
    setEditingPreset(null);
    toast.success(t('presets.saved'));
  };

  const addAdultPresets = async () => {
    if (!settings.adultConfirmed) {
      const ok = await dialog.confirm({
        title: t('presets.matureConfirmTitle'),
        message: t('presets.matureConfirmBody'),
        confirmLabel: t('presets.matureConfirmYes'),
      });
      if (!ok) return;
      settings.patch({ adultConfirmed: true });
    }
    const count = await conversations.addAdultPresets();
    toast.success(t('presets.adultAdded', { count }));
  };

  const importCard = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: t('presets.cardFilter'), extensions: ['json', 'png'] }],
      });
      if (typeof path !== 'string') return;
      const bytes = await readFile(path);
      const input = path.toLowerCase().endsWith('.png') ? bytes : new TextDecoder().decode(bytes);
      const card = parseCharacterCard(input);
      setEditingPreset(presetFromCard(card, blankPreset(), resolveLanguage(settings.language)));
      toast.info(t('presets.imported', { name: card.data.name }));
    } catch (err) {
      toast.error(
        err instanceof CardError
          ? t(`presets.cardErrors.${err.code}`)
          : t('presets.importError', { detail: errorMessage(err) }),
      );
    }
  };

  const exportCard = async (preset: Preset) => {
    try {
      const slug =
        preset.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, '-') || 'persona';
      const path = await save({
        defaultPath: `${slug}.card.json`,
        filters: [{ name: t('presets.cardFilter'), extensions: ['json'] }],
      });
      if (!path) return;
      await writeTextFile(path, serializeCard(cardFromPreset(preset)));
      toast.success(t('presets.exported'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const removePreset = async (preset: Preset) => {
    if (!(await confirm(t('presets.deleteConfirm', { name: preset.name })))) return;
    await conversations.removePreset(preset.id);
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

        {/* Clé API */}
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

        {/* Valeurs par défaut */}
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
            <div>
              <Button variant="ghost" size="sm" onClick={() => settings.patch(defaultGeneration)}>
                {t('params.reset')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Personas */}
        <Card id="presets">
          <CardHeader>
            <CardTitle>{t('presets.title')}</CardTitle>
            <CardDescription>{t('presets.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {conversations.presets.length === 0 && !editingPreset && (
              <p className="text-muted-foreground">{t('presets.none')}</p>
            )}
            <ul className="flex flex-col divide-y">
              {conversations.presets.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <PresetAvatar preset={p} className="size-8 text-xs" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{p.name}</p>
                      <PresetBadges preset={p} />
                      {(memoryCounts[p.id] ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md border border-chart-1/40 bg-chart-1/10 px-1.5 py-0.5 font-mono text-xs text-chart-1"
                          title={t('presets.memory.title')}
                        >
                          <Brain className="size-3" aria-hidden="true" />
                          {t('presets.memory.count', { count: memoryCounts[p.id] ?? 0 })}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[p.model, p.systemPrompt, p.persona.roleplay.character]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setEditingPreset(p)}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('presets.exportCard')}
                    title={t('presets.exportCard')}
                    disabled={!inTauri}
                    onClick={() => void exportCard(p)}
                  >
                    <FileDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    aria-label={t('presets.delete')}
                    onClick={() => void removePreset(p)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
            {editingPreset ? (
              <PersonaEditor
                preset={editingPreset}
                onChange={setEditingPreset}
                onSave={() => void savePreset(editingPreset)}
                onCancel={() => setEditingPreset(null)}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditingPreset(blankPreset())}>
                  <Plus />
                  {t('presets.new')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!inTauri}
                  title={inTauri ? undefined : t('common.onlyInApp')}
                  onClick={() => void importCard()}
                >
                  <FileUp />
                  {t('presets.importCard')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void conversations
                      .restoreDefaultPresets()
                      .then((count) => toast.success(t('presets.restored', { count })))
                  }
                >
                  {t('presets.restoreDefaults')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  title={t('presets.addAdultHint')}
                  onClick={() => void addAdultPresets()}
                >
                  <ShieldAlert />
                  {t('presets.addAdult')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setEditingPreset({
                      ...blankPreset(),
                      model: settings.defaultModel,
                      systemPrompt: settings.systemPrompt || null,
                      temperature: settings.temperature,
                      topP: settings.topP,
                      maxTokens: settings.maxTokens,
                      reasoning: settings.reasoning,
                    })
                  }
                >
                  {t('presets.saveFromCurrent')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Raccourcis de prompt */}
        <SnippetSettings />

        {/* Routage OpenRouter */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.routing')}</CardTitle>
            <CardDescription>{t('settings.routingHelp')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Row label={t('settings.providerSort')}>
              <Select
                value={settings.providerSort ?? ''}
                onChange={(e) =>
                  settings.patch({ providerSort: (e.target.value || null) as ProviderSort | null })
                }
                aria-label={t('settings.providerSort')}
              >
                <option value="">{t('settings.sortNone')}</option>
                <option value="price">{t('settings.sortPrice')}</option>
                <option value="throughput">{t('settings.sortThroughput')}</option>
                <option value="latency">{t('settings.sortLatency')}</option>
              </Select>
            </Row>
            <Field label={t('settings.ignoreProviders')}>
              <Input
                value={settings.ignoreProviders.join(', ')}
                onChange={(e) =>
                  settings.patch({
                    ignoreProviders: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder={t('settings.ignoreProvidersPlaceholder')}
                className="h-8"
              />
            </Field>
            <Row
              label={t('settings.dataCollectionDeny')}
              hint={t('settings.dataCollectionDenyHint')}
            >
              <Switch
                checked={settings.dataCollectionDeny}
                onCheckedChange={(v) => settings.patch({ dataCollectionDeny: v })}
                aria-label={t('settings.dataCollectionDeny')}
              />
            </Row>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Apparence */}
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
              <Row label={t('settings.fontSize')}>
                <Segmented
                  label={t('settings.fontSize')}
                  value={settings.fontSize}
                  onChange={(v) => settings.patch({ fontSize: v })}
                  options={[
                    { value: 'sm', label: t('settings.fontSm') },
                    { value: 'md', label: t('settings.fontMd') },
                    { value: 'lg', label: t('settings.fontLg') },
                  ]}
                />
              </Row>
              <Row label={t('settings.density')}>
                <Segmented
                  label={t('settings.density')}
                  value={settings.density}
                  onChange={(v) => settings.patch({ density: v })}
                  options={[
                    { value: 'comfortable', label: t('settings.densityComfortable') },
                    { value: 'compact', label: t('settings.densityCompact') },
                  ]}
                />
              </Row>
              <Row label={t('settings.accent')}>
                <div role="radiogroup" aria-label={t('settings.accent')} className="flex gap-1.5">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent}
                      type="button"
                      role="radio"
                      aria-checked={settings.accent === accent}
                      aria-label={t(
                        `settings.accent${accent.charAt(0).toUpperCase()}${accent.slice(1)}` as 'settings.accentNeutral',
                      )}
                      title={t(
                        `settings.accent${accent.charAt(0).toUpperCase()}${accent.slice(1)}` as 'settings.accentNeutral',
                      )}
                      onClick={() => settings.patch({ accent })}
                      data-accent={accent}
                      className={cn(
                        'size-6 rounded-full border-2 transition-transform',
                        settings.accent === accent
                          ? 'scale-110 border-foreground'
                          : 'border-transparent',
                      )}
                      style={{ background: accentSwatch(accent) }}
                    />
                  ))}
                </div>
              </Row>
            </CardContent>
          </Card>

          {/* Notifications et raccourcis */}
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.shortcuts')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Shortcut keys={`${MOD}+N`} label={t('settings.shortcutNewChat')} />
              <Shortcut keys={`${MOD}+K`} label={t('settings.shortcutSearch')} />
              <Shortcut keys={`${MOD}+,`} label={t('settings.shortcutSettings')} />
              <Shortcut keys={`${MOD}+B`} label={t('settings.shortcutSidebar')} />
              <Shortcut keys="Échap" label={t('settings.shortcutStop')} />
              <Shortcut keys="↑" label={t('settings.shortcutLastMessage')} />
              <Shortcut
                keys={SHORTCUT}
                label={t('settings.shortcutHint', { shortcut: '' }).trim()}
              />
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
              <Row label={t('settings.notifyOnComplete')}>
                <Switch
                  checked={settings.notifyOnComplete}
                  onCheckedChange={(v) => settings.patch({ notifyOnComplete: v })}
                  aria-label={t('settings.notifyOnComplete')}
                />
              </Row>
            </CardContent>
          </Card>

          {/* Données */}
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.data')}</CardTitle>
              <CardDescription>{t('settings.importHelp')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onExportAll()}
                disabled={!inTauri}
              >
                <Download />
                {t('settings.exportAll')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onImport()}
                disabled={!inTauri}
              >
                <Upload />
                {t('settings.import')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => settings.patch({ onboarded: false })}
              >
                {t('settings.restartOnboarding')}
              </Button>
              <p className="mt-2 text-xs font-medium uppercase tracking-wide text-destructive">
                {t('settings.dangerZone')}
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void onDeleteAll()}
                disabled={!inTauri || conversations.items.length === 0}
              >
                <Trash2 />
                {t('settings.deleteAll')}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* À propos */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.about')}</CardTitle>
            <CardDescription>
              {t('settings.version', { version: __APP_VERSION__ })} · {t('app.tagline')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-sm">
            <Row label={t('settings.autoUpdate')} hint={t('settings.autoUpdateHint')}>
              <Switch
                checked={settings.autoUpdate}
                onCheckedChange={(v) => settings.patch({ autoUpdate: v })}
                aria-label={t('settings.autoUpdate')}
              />
            </Row>
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

function blankPreset(): Preset {
  return {
    id: newId(),
    name: '',
    systemPrompt: null,
    model: null,
    temperature: null,
    topP: null,
    maxTokens: null,
    reasoning: null,
    persona: defaultPersona(),
    position: Date.now(),
    createdAt: new Date().toISOString(),
  };
}

function accentSwatch(accent: Accent): string {
  switch (accent) {
    case 'violet':
      return 'oklch(0.6 0.2 295)';
    case 'blue':
      return 'oklch(0.6 0.18 255)';
    case 'green':
      return 'oklch(0.6 0.15 150)';
    case 'amber':
      return 'oklch(0.75 0.16 70)';
    case 'rose':
      return 'oklch(0.65 0.19 10)';
    default:
      return 'oklch(0.5 0 0)';
  }
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <kbd className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs">{keys}</kbd>
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
