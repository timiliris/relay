import { Link, useRouterState } from '@tanstack/react-router';
import {
  AppWindow,
  ArrowLeft,
  Database,
  Info,
  KeyRound,
  MessagesSquare,
  Palette,
  Route,
  Slash,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AboutSection } from '@/components/settings/about-section';
import { AccountSection } from '@/components/settings/account-section';
import { AppSection } from '@/components/settings/app-section';
import { AppearanceSection } from '@/components/settings/appearance-section';
import { DataSection } from '@/components/settings/data-section';
import { DefaultsSection } from '@/components/settings/defaults-section';
import { PersonasSection } from '@/components/settings/personas-section';
import { RoutingSection } from '@/components/settings/routing-section';
import { SettingsNav, type SettingsNavItem } from '@/components/settings/settings-nav';
import { SnippetSettings } from '@/components/snippet-settings';
import { buttonVariants } from '@/components/ui/button';
import { useWindowTitle } from '@/hooks/use-window-title';

/**
 * Page des paramètres : sommaire (colonne fixe ou rangée défilante) et sections ancrées.
 * Chaque section vit dans `src/components/settings/`.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  useWindowTitle(t('settings.title'));
  const hash = useRouterState({ select: (s) => s.location.hash });
  const scrollRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  /** Section choisie au clic : reste active jusqu'à la fin du défilement animé. */
  const pinned = useRef<string | null>(null);
  const settle = useRef(0);

  const items = useMemo<SettingsNavItem[]>(
    () => [
      { id: 'account', label: t('settings.sections.account'), icon: KeyRound },
      { id: 'conversations', label: t('settings.sections.conversations'), icon: MessagesSquare },
      { id: 'presets', label: t('settings.sections.personas'), icon: UserRound },
      { id: 'snippets', label: t('settings.sections.snippets'), icon: Slash },
      { id: 'routing', label: t('settings.sections.routing'), icon: Route },
      { id: 'appearance', label: t('settings.sections.appearance'), icon: Palette },
      { id: 'app', label: t('settings.sections.app'), icon: AppWindow },
      { id: 'data', label: t('settings.sections.data'), icon: Database },
      { id: 'about', label: t('settings.sections.about'), icon: Info },
    ],
    [t],
  );
  const [active, setActive] = useState(items[0]?.id ?? 'account');
  const activeRef = useRef(active);
  activeRef.current = active;

  // Lien profond (`/settings#presets`) : la section demandée est amenée en haut.
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
    setActive(id);
  }, [hash]);

  // Sommaire synchronisé avec le défilement : section active = la dernière dont le haut est passé.
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      if (pinned.current) {
        // Le défilement animé est en cours : on attend qu'il se calme avant de reprendre le suivi.
        clearTimeout(settle.current);
        settle.current = window.setTimeout(() => {
          pinned.current = null;
        }, 160);
        return;
      }
      const bounds = container.getBoundingClientRect();
      // En bas de page, les dernières sections ne peuvent plus monter en haut : la section
      // active reste celle choisie si elle est visible, sinon la dernière.
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
        const visible = items.filter(({ id }) => {
          const r = document.getElementById(id)?.getBoundingClientRect();
          return r && r.top < bounds.bottom && r.bottom > bounds.top;
        });
        if (!visible.some((i) => i.id === activeRef.current)) {
          setActive(visible[visible.length - 1]?.id ?? items[items.length - 1]?.id ?? 'about');
        }
        return;
      }
      const top = bounds.top + 24;
      let current = items[0]?.id ?? 'account';
      for (const { id } of items) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= top) current = id;
      }
      setActive(current);
    });
  };

  const select = (id: string) => {
    pinned.current = id;
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Si aucun défilement n'a lieu (section déjà visible), le suivi reprend tout de suite.
    clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      pinned.current = null;
    }, 160);
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <header className="flex items-center gap-2">
          <Link
            to="/"
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            aria-label={t('common.back')}
          >
            <ArrowLeft />
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">{t('settings.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('settings.subtitle')}</p>
          </div>
        </header>

        <div className="mt-5 md:grid md:grid-cols-[190px_minmax(0,1fr)] md:gap-8">
          <aside className="sticky top-0 z-10 -mx-6 mb-4 bg-background/95 px-6 py-2 backdrop-blur md:static md:mx-0 md:mb-0 md:bg-transparent md:px-0 md:py-0">
            <div className="md:sticky md:top-2">
              <SettingsNav
                items={items}
                activeId={active}
                onSelect={select}
                label={t('settings.sectionsLabel')}
              />
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-5">
            <AccountSection />
            <DefaultsSection />
            <PersonasSection />
            <SnippetSettings />
            <RoutingSection />
            <AppearanceSection />
            <AppSection />
            <DataSection />
            <AboutSection />
          </div>
        </div>
      </div>
    </div>
  );
}
