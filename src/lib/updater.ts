/**
 * Mise à jour automatique via tauri-plugin-updater.
 *
 * Nécessite dans `tauri.conf.json` une `pubkey` valide et des `endpoints`
 * (voir README, section « Mises à jour automatiques »).
 */
import { ask, message } from '@tauri-apps/plugin-dialog';
import { info, error as logError } from '@tauri-apps/plugin-log';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import i18n from '@/i18n';

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
        await message(t('updates.dialog.upToDate'), {
          title: t('updates.dialog.title'),
          kind: 'info',
        });
      }
      return;
    }

    info(`Mise à jour disponible : ${update.version}`);
    report('available', update.version);

    const accepted = await ask(
      `${t('updates.dialog.available', { version: update.version })}\n\n${update.body ?? ''}`.trim(),
      {
        title: t('updates.dialog.titleAvailable'),
        kind: 'info',
        okLabel: t('updates.dialog.install'),
        cancelLabel: t('updates.dialog.later'),
      },
    );
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
      await message(`${t('updates.dialog.failed')}\n\n${text}`, {
        title: t('updates.dialog.title'),
        kind: 'error',
      });
    }
  }
}
