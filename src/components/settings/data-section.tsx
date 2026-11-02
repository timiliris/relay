import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { Database, Download, Sparkles, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { exportAll } from '@/lib/db';
import { importConversations, parseImport } from '@/lib/import';
import { errorMessage, isTauri } from '@/lib/tauri';
import { useConversations } from '@/stores/conversations';
import { dialog } from '@/stores/dialog';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { Button } from '../ui/button';
import { Row, SettingsSection } from './primitives';

/** Export, import, assistant de démarrage et zone sensible. */
export function DataSection() {
  const { t } = useTranslation();
  const inTauri = isTauri();
  const settings = useSettings();
  const conversations = useConversations();

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
    const ok = await dialog.confirm({
      title: t('common.delete'),
      message: t('settings.deleteAllConfirm'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    for (const c of conversations.items) await conversations.remove(c.id);
    toast.success(t('settings.deletedAll'));
  };

  return (
    <SettingsSection
      id="data"
      icon={Database}
      title={t('settings.data')}
      description={t('settings.dataHelp')}
    >
      <Row label={t('settings.exportAll')} hint={t('settings.exportAllHint')}>
        <Button variant="outline" size="sm" onClick={() => void onExportAll()} disabled={!inTauri}>
          <Download />
          {t('settings.export')}
        </Button>
      </Row>
      <Row label={t('settings.import')} hint={t('settings.importHelp')}>
        <Button variant="outline" size="sm" onClick={() => void onImport()} disabled={!inTauri}>
          <Upload />
          {t('settings.importAction')}
        </Button>
      </Row>
      <Row label={t('settings.restartOnboarding')} hint={t('settings.restartOnboardingHint')}>
        <Button variant="outline" size="sm" onClick={() => settings.patch({ onboarded: false })}>
          <Sparkles />
          {t('settings.restart')}
        </Button>
      </Row>

      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-destructive">{t('settings.dangerZone')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.dangerZoneHint')}</p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0"
            onClick={() => void onDeleteAll()}
            disabled={!inTauri || conversations.items.length === 0}
          >
            <Trash2 />
            {t('settings.deleteAll')}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
