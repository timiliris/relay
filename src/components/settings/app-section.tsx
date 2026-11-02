import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { platform } from '@tauri-apps/plugin-os';
import { AppWindow, Keyboard, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, isTauri } from '@/lib/tauri';
import { checkForUpdates, type UpdateStatus } from '@/lib/updater';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Group, Row, SettingsSection, Shortcut } from './primitives';

/** Doit rester identique à `SHORTCUT` dans src-tauri/src/shortcut.rs. */
const isMac = isTauri() && platform() === 'macos';
const SHORTCUT = isMac ? '⌘ ⇧ Espace' : 'Ctrl+Shift+Espace';
const MOD = isMac ? '⌘' : 'Ctrl';

/** Démarrage, notifications, mises à jour et raccourcis clavier. */
export function AppSection() {
  const { t } = useTranslation();
  const inTauri = isTauri();
  const settings = useSettings();
  const [autostart, setAutostart] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateDetail, setUpdateDetail] = useState('');

  useEffect(() => {
    if (inTauri) isEnabled().then(setAutostart).catch(console.error);
  }, [inTauri]);

  const toggleAutostart = async (checked: boolean) => {
    try {
      await (checked ? enable() : disable());
      setAutostart(await isEnabled());
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const updateLabel = (): string => {
    switch (updateStatus) {
      case 'idle':
        return t('settings.version', { version: __APP_VERSION__ });
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
  const busy = updateStatus === 'checking' || updateStatus === 'downloading';

  return (
    <SettingsSection
      id="app"
      icon={AppWindow}
      title={t('settings.app')}
      description={t('settings.appHelp')}
    >
      <Group title={t('settings.startup')}>
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
      </Group>

      <Group title={t('settings.updates')}>
        <Row label={t('settings.autoUpdate')} hint={t('settings.autoUpdateHint')}>
          <Switch
            checked={settings.autoUpdate}
            onCheckedChange={(v) => settings.patch({ autoUpdate: v })}
            aria-label={t('settings.autoUpdate')}
          />
        </Row>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!inTauri || busy}
            onClick={() =>
              void checkForUpdates({
                onStatus: (status, detail) => {
                  setUpdateStatus(status);
                  setUpdateDetail(detail ?? '');
                },
              })
            }
          >
            <RefreshCw className={busy ? 'animate-spin' : undefined} />
            {t('settings.checkUpdates')}
          </Button>
          <span
            className={
              updateStatus === 'error'
                ? 'text-xs text-destructive'
                : 'text-xs text-muted-foreground'
            }
            role="status"
          >
            {updateLabel()}
          </span>
        </div>
      </Group>

      <Group title={t('settings.shortcuts')}>
        <details className="group rounded-lg border">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-muted-foreground select-none hover:text-foreground">
            <Keyboard className="size-4" aria-hidden="true" />
            {t('settings.shortcutsShow')}
          </summary>
          <div className="flex flex-col gap-2 border-t px-3 py-3">
            <Shortcut keys={`${MOD}+N`} label={t('settings.shortcutNewChat')} />
            <Shortcut keys={`${MOD}+K`} label={t('settings.shortcutSearch')} />
            <Shortcut keys={`${MOD}+,`} label={t('settings.shortcutSettings')} />
            <Shortcut keys={`${MOD}+B`} label={t('settings.shortcutSidebar')} />
            <Shortcut keys="Échap" label={t('settings.shortcutStop')} />
            <Shortcut keys="↑" label={t('settings.shortcutLastMessage')} />
            <Shortcut keys={SHORTCUT} label={t('settings.shortcutGlobal')} />
          </div>
        </details>
      </Group>
    </SettingsSection>
  );
}
