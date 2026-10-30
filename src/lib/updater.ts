/**
 * Mise à jour automatique via tauri-plugin-updater, avec dialogues intégrés à l'app.
 *
 * Nécessite dans `tauri.conf.json` une `pubkey` valide et des `endpoints`
 * (voir README, section « Mises à jour automatiques »).
 */
import { info, error as logError } from '@tauri-apps/plugin-log';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import i18n from '@/i18n';
import { dialog } from '@/stores/dialog';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installed'
  | 'error';

export interface CheckOptions {
  /** Sans dialogue quand il n'y a rien à faire (vérification au démarrage). */
  silent?: boolean;
  onStatus?: (status: UpdateStatus, detail?: string) => void;
}

export async function checkForUpdates({ silent = false, onStatus }: CheckOptions = {}) {
  const report = onStatus ?? (() => {});
  const t = i18n.t;
  report('checking');

  try {
    const update = await check();

    if (!update) {
      report('up-to-date');
      if (!silent) {
        await dialog.alert({
          title: t('updates.dialog.title'),
          message: t('updates.dialog.upToDate'),
        });
      }
      return;
    }

    info(`Mise à jour disponible : ${update.version}`);
    report('available', update.version);

    const accepted = await dialog.confirm({
      title: t('updates.dialog.titleAvailable'),
      message:
        `${t('updates.dialog.available', { version: update.version })}\n\n${update.body ?? ''}`.trim(),
      confirmLabel: t('updates.dialog.install'),
      cancelLabel: t('updates.dialog.later'),
    });
    if (!accepted) {
      report('idle');
      return;
    }

    let total = 0;
    let downloaded = 0;
    report('downloading', '0');

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? 0;
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          if (total > 0) report('downloading', String(Math.round((downloaded / total) * 100)));
          break;
        case 'Finished':
          report('installed');
          break;
      }
    });

    await relaunch();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    logError(`Updater : ${text}`);
    report('error', text);
    if (!silent) {
      await dialog.alert({
        title: t('updates.dialog.title'),
        message: `${t('updates.dialog.failed')}\n\n${text}`,
      });
    }
  }
}
