import { listen } from '@tauri-apps/api/event';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ExternalLink,
  Globe,
  History,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BROWSER_NAVIGATED_EVENT,
  type BrowserBounds,
  type BrowserNavigated,
  browserCommands,
} from '@/lib/agent/commands';
import { openExternal } from '@/lib/open-external';
import { errorMessage, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { normalizeAddress, selectVisited, useBrowser, type VisitedPage } from '@/stores/browser';
import { toast } from '@/stores/toast';
import { Input } from './ui/input';
import { IconButton } from './ui/tooltip-button';

/** Rectangle CSS de la zone de contenu, arrondi au pixel pour ne pas renvoyer du bruit. */
function measure(el: HTMLElement): BrowserBounds {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

const sameBounds = (a: BrowserBounds | null, b: BrowserBounds): boolean =>
  a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Volet latéral « Navigateur » : barre d'adresse, navigation, pages visitées, lecture pour
 * l'agent. La page elle-même est un webview enfant natif que Rust place dans la zone de contenu
 * mesurée ici (`browser_set_bounds`), suivie à chaque changement de disposition.
 */
export function BrowserPanel({
  conversationId,
  onClose,
}: {
  conversationId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inTauri = isTauri();
  const url = useBrowser((s) => s.url);
  const title = useBrowser((s) => s.title);
  const navigated = useBrowser((s) => s.navigated);
  const visited = useBrowser(selectVisited(conversationId));
  const [address, setAddress] = useState(url ?? '');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const lastBounds = useRef<BrowserBounds | null>(null);
  /** `true` une fois le webview créé par `browser_open` (il faut alors suivre sa zone). */
  const [webviewOpen, setWebviewOpen] = useState(false);
  /** Même information, à jour de façon synchrone : évite un second `browser_open` avant le rendu. */
  const created = useRef(false);

  const run = (action: () => Promise<void>) =>
    action().catch((err) => {
      setError(errorMessage(err));
    });

  const openWebview = (target: string) => {
    if (!inTauri) return;
    setError(null);
    const bounds = areaRef.current ? measure(areaRef.current) : undefined;
    if (created.current) {
      run(() => browserCommands.navigate(target));
      return;
    }
    created.current = true;
    lastBounds.current = bounds ?? null;
    run(async () => {
      try {
        await browserCommands.open(target, bounds);
        setWebviewOpen(true);
      } catch (err) {
        created.current = false;
        throw err;
      }
    });
  };

  // Ouverture du volet avec une URL déjà connue (réouverture, lien d'une carte) : on l'affiche.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `url` déclenche l'affichage initial, pas chaque navigation
  useEffect(() => {
    if (url && !created.current) openWebview(url);
  }, [url]);

  // L'adresse suit la page courante tant que l'utilisateur ne saisit pas.
  useEffect(() => {
    if (url !== null) setAddress(url);
  }, [url]);

  // Événements de navigation émis par Rust : URL puis titre.
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<BrowserNavigated>(BROWSER_NAVIGATED_EVENT, (event) => {
      navigated(conversationId, event.payload.url, event.payload.title);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(console.error);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [inTauri, conversationId, navigated]);

  // Position et taille du webview : mesurées à chaque image tant que le volet est ouvert
  // (un `ResizeObserver` seul ignore les déplacements sans changement de taille, par exemple
  // l'ouverture d'un autre volet). Rust n'est appelé que quand le rectangle change.
  useEffect(() => {
    if (!inTauri || !webviewOpen) return;
    let frame = 0;
    const tick = () => {
      const el = areaRef.current;
      if (el) {
        const bounds = measure(el);
        if (!sameBounds(lastBounds.current, bounds)) {
          lastBounds.current = bounds;
          browserCommands.setBounds(bounds).catch(console.error);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inTauri, webviewOpen]);

  // Fermeture du volet (ou démontage) : le webview natif disparaît avec lui.
  useEffect(() => {
    if (!inTauri) return;
    return () => {
      browserCommands.close().catch(console.error);
    };
  }, [inTauri]);

  const submit = () => {
    const target = normalizeAddress(address);
    if (!target) return;
    useBrowser.setState({ url: target, title: null });
    openWebview(target);
  };

  const onAddressKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setAddress(url ?? '');
    }
  };

  const readPage = () => {
    if (!url || reading) return;
    setReading(true);
    setError(null);
    run(async () => {
      const page = await browserCommands.fetchUrl(url);
      useBrowser.getState().setLastReadPage(page);
      await navigator.clipboard.writeText(page.text);
      toast.success(
        t(page.truncated ? 'chat.browser.readTruncated' : 'chat.browser.readCopied', {
          count: page.text.length,
        }),
      );
    }).finally(() => setReading(false));
  };

  const goTo = (page: VisitedPage) => {
    setHistoryOpen(false);
    useBrowser.setState({ url: page.url, title: page.title });
    openWebview(page.url);
  };

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l bg-card/40 sm:w-96 lg:w-[32rem]"
      aria-label={t('chat.browser.title')}
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <Globe className="mx-1 size-4 shrink-0 text-chart-2" aria-hidden="true" />
        <IconButton
          label={t('chat.browser.back')}
          className="size-7"
          disabled={!webviewOpen}
          onClick={() => run(browserCommands.back)}
        >
          <ArrowLeft className="size-4" />
        </IconButton>
        <IconButton
          label={t('chat.browser.forward')}
          className="size-7"
          disabled={!webviewOpen}
          onClick={() => run(browserCommands.forward)}
        >
          <ArrowRight className="size-4" />
        </IconButton>
        <IconButton
          label={t('chat.browser.reload')}
          className="size-7"
          disabled={!webviewOpen}
          onClick={() => run(browserCommands.reload)}
        >
          <RotateCw className="size-4" />
        </IconButton>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={onAddressKey}
          onFocus={(e) => e.currentTarget.select()}
          placeholder={t('chat.browser.address')}
          aria-label={t('chat.browser.addressLabel')}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="h-8 min-w-0 flex-1 font-mono text-xs"
          disabled={!inTauri}
        />
        <IconButton
          label={t('chat.browser.history')}
          className="size-7"
          aria-pressed={historyOpen}
          onClick={() => setHistoryOpen((o) => !o)}
        >
          <History className={cn('size-4', historyOpen && 'text-chart-2')} />
        </IconButton>
        <IconButton label={t('common.close')} className="size-7" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5 text-xs">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={title ?? undefined}>
            {url ? (title ?? t('chat.browser.untitled')) : t('chat.browser.title')}
          </p>
          {url && (
            <p className="truncate font-mono text-muted-foreground" title={url}>
              {url}
            </p>
          )}
        </div>
        <IconButton
          label={t('chat.browser.openExternal')}
          className="size-7"
          disabled={!url}
          onClick={() => url && openExternal(url)}
        >
          <ExternalLink className="size-4" />
        </IconButton>
        <IconButton
          label={reading ? t('chat.browser.reading') : t('chat.browser.readPage')}
          className={cn('size-7', reading && 'animate-pulse')}
          disabled={!url || !inTauri || reading}
          onClick={readPage}
        >
          <BookOpenText className="size-4 text-chart-2" />
        </IconButton>
      </div>

      {error && <p className="border-b px-3 py-1.5 text-xs text-destructive">{error}</p>}

      {historyOpen && (
        <section
          aria-label={t('chat.browser.history')}
          className="max-h-[40%] shrink-0 overflow-y-auto border-b"
        >
          <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs text-muted-foreground">
            <span className="flex-1">{t('chat.browser.history')}</span>
            {visited.length > 0 && (
              <IconButton
                label={t('chat.browser.clearHistory')}
                className="size-6"
                onClick={() => useBrowser.getState().clearVisited(conversationId)}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            )}
          </div>
          {visited.length === 0 ? (
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              {t('chat.browser.historyEmpty')}
            </p>
          ) : (
            <ul className="pb-1">
              {visited.map((page) => (
                <li key={page.url}>
                  <button
                    type="button"
                    onClick={() => goTo(page)}
                    className={cn(
                      'flex w-full flex-col items-start px-3 py-1.5 text-left text-xs hover:bg-accent',
                      page.url === url && 'bg-accent/60',
                    )}
                  >
                    <span className="w-full truncate">
                      {page.title ?? t('chat.browser.untitled')}
                    </span>
                    <span className="w-full truncate font-mono text-muted-foreground">
                      {page.url}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Zone occupée par le webview natif ; le contenu HTML ci-dessous n'est visible qu'avant. */}
      <div ref={areaRef} className="relative min-h-0 flex-1 bg-background">
        {!inTauri ? (
          <div className="absolute inset-3 flex items-center justify-center rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {t('chat.browser.onlyInApp')}
          </div>
        ) : (
          !url && (
            <div className="absolute inset-3 flex items-center justify-center rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              {t('chat.browser.empty')}
            </div>
          )
        )}
      </div>
    </aside>
  );
}
