import { CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { ToolInfo } from '@/lib/agent/commands';
import { playwrightReady } from '@/lib/agent/environment';
import { openExternal } from '@/lib/open-external';
import { isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useEnvironment } from '@/stores/environment';
import { usePlaywrightInstall } from '@/stores/playwright-install';
import { useSettings } from '@/stores/settings';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { PlaywrightInstallDialog } from './playwright-install-dialog';
import { Group, Row } from './primitives';

const PYTHON_URL = 'https://www.python.org/downloads/';
const NODE_URL = 'https://nodejs.org/';

/** Outils détectés sur le poste, bouton Actualiser, installation de Playwright en un clic. */
export function EnvironmentGroup() {
  const { t } = useTranslation();
  const settings = useSettings();
  const { environment, loading, error, ensure } = useEnvironment();
  const install = usePlaywrightInstall();
  const inApp = isTauri();

  useEffect(() => {
    if (inApp) void ensure(null);
  }, [inApp, ensure]);

  const hasTool = (name: string) =>
    environment?.tools.some((tool) => tool.name === name && tool.path);
  const canInstall = hasTool('python') || (hasTool('node') && hasTool('npm'));
  const ready = playwrightReady(environment);

  return (
    <Group title={t('settings.developer.environment')}>
      <Row
        label={t('settings.developer.environmentSetting')}
        hint={t('settings.developer.environmentSettingHint')}
      >
        <Switch
          checked={settings.agentEnvironment}
          onCheckedChange={(v) => settings.patch({ agentEnvironment: v })}
          aria-label={t('settings.developer.environmentSetting')}
        />
      </Row>

      {!inApp ? (
        <p className="text-xs text-muted-foreground">{t('common.onlyInApp')}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {environment
                ? `${environment.os} · ${environment.shell}`
                : loading
                  ? t('settings.developer.detecting')
                  : (error ?? '')}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void ensure(null, true)}
            >
              <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
              {t('settings.developer.refresh')}
            </Button>
          </div>

          {environment && (
            <ul
              aria-label={t('settings.developer.environment')}
              className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs sm:grid-cols-3"
            >
              {environment.tools.map((tool) => (
                <ToolItem key={tool.name} tool={tool} />
              ))}
            </ul>
          )}

          {environment && (
            <div className="flex flex-col gap-2 rounded-md border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm">
                  {t('settings.developer.playwright')}
                  {ready && <CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />}
                </p>
                <p className="text-muted-foreground">{playwrightStatus(environment.playwright)}</p>
                {!canInstall && (
                  <p className="mt-1 text-muted-foreground">
                    {t('settings.developer.playwrightNoRuntime')}{' '}
                    <ExternalLinkButton href={PYTHON_URL}>python.org</ExternalLinkButton>
                    {' · '}
                    <ExternalLinkButton href={NODE_URL}>nodejs.org</ExternalLinkButton>
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant={ready ? 'outline' : 'default'}
                disabled={!canInstall || install.status === 'running'}
                onClick={() => install.start()}
                className="shrink-0"
              >
                <Download aria-hidden="true" />
                {ready
                  ? t('settings.developer.reinstallPlaywright')
                  : t('settings.developer.installPlaywright')}
              </Button>
            </div>
          )}
          {environment && canInstall && (
            <p className="text-xs text-muted-foreground">
              {t('settings.developer.installPlaywrightHint', {
                tool: hasTool('python') ? 'pip' : 'npm',
              })}
            </p>
          )}
        </>
      )}

      {install.status !== 'idle' && <PlaywrightInstallDialog />}
    </Group>
  );
}

function ToolItem({ tool }: { tool: ToolInfo }) {
  const { t } = useTranslation();
  const present = tool.path !== null;
  return (
    <li className="flex justify-between gap-2" title={tool.path ?? undefined}>
      <span className={cn('font-mono', !present && 'text-muted-foreground')}>{tool.name}</span>
      <span
        className={cn(
          'truncate font-mono',
          present ? 'text-foreground' : 'text-muted-foreground italic',
        )}
      >
        {tool.version ??
          (present ? t('settings.developer.unknownVersion') : t('settings.developer.missingTool'))}
      </span>
    </li>
  );
}

/** Passe par l'instance i18n : un `t` typé passé en paramètre fait exploser l'instanciation de tsc. */
function playwrightStatus(pw: {
  python: boolean;
  node: boolean;
  browsers: string[];
  version: string | null;
}): string {
  if (!pw.python && !pw.node) return i18n.t('settings.developer.playwrightMissing');
  const via = [pw.python && 'Python', pw.node && 'Node'].filter(Boolean).join(' + ');
  const version = pw.version ?? '';
  return pw.browsers.length
    ? i18n.t('settings.developer.playwrightReady', {
        version,
        via,
        browsers: pw.browsers.join(', '),
      })
    : i18n.t('settings.developer.playwrightNoBrowser', { version, via });
}

function ExternalLinkButton({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      className="underline underline-offset-2 hover:text-foreground"
      onClick={() => openExternal(href)}
    >
      {children}
    </button>
  );
}
