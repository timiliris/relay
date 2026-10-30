import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform } from '@tauri-apps/plugin-os';
import { Copy, Menu, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { commands, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

const isMac = isTauri() && platform() === 'macos';

/**
 * Barre de titre personnalisée (fenêtre sans décorations sur Windows et Linux).
 * Sur macOS, les feux tricolores natifs restent affichés (`titleBarStyle: Overlay`,
 * voir tauri.macos.conf.json) : on réserve leur espace à gauche.
 */
export function TitleBar() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);
  const inTauri = isTauri();

  useEffect(() => {
    if (!inTauri) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .isMaximized()
      .then(setMaximized)
      .catch(() => {});
    win
      .onResized(() => {
        win
          .isMaximized()
          .then(setMaximized)
          .catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [inTauri]);

  const win = () => getCurrentWindow();

  return (
    <header
      data-tauri-drag-region
      className={cn(
        'flex h-10 shrink-0 select-none items-center justify-between border-b bg-card',
        isMac ? 'pl-20' : 'pl-2',
      )}
    >
      <div data-tauri-drag-region className="flex items-center gap-1">
        {!isMac && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('titlebar.menu')}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              commands.showAppMenu(rect.left, rect.bottom).catch(console.error);
            }}
          >
            <Menu />
          </Button>
        )}
        <span data-tauri-drag-region className="px-2 text-sm font-medium">
          {t('app.name')}
        </span>
      </div>

      {inTauri && !isMac && (
        <div className="flex h-full">
          <WindowButton label={t('titlebar.minimize')} onClick={() => void win().minimize()}>
            <Minus />
          </WindowButton>
          <WindowButton
            label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
            onClick={() => void win().toggleMaximize()}
          >
            {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
          </WindowButton>
          <WindowButton
            label={t('titlebar.close')}
            className="hover:bg-destructive hover:text-white"
            onClick={() => void win().close()}
          >
            <X />
          </WindowButton>
        </div>
      )}
    </header>
  );
}

function WindowButton({
  label,
  className,
  ...props
}: { label: string } & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-full w-12 items-center justify-center transition-colors hover:bg-accent [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}
