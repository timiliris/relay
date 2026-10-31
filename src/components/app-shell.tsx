import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useTheme } from '@/hooks/use-theme';
import { useApiKey } from '@/stores/api-key';
import { useConversations } from '@/stores/conversations';
import { useModels } from '@/stores/models';
import { useSettings } from '@/stores/settings';
import { ConversationSidebar } from './conversation-sidebar';
import { DialogHost } from './dialog-host';
import { ErrorBoundary } from './error-boundary';
import { SearchPalette } from './search-palette';
import { TitleBar } from './title-bar';
import { Toaster } from './toaster';

/** Coquille de l'application : barre de titre, historique à gauche, contenu routé. */
export function AppShell() {
  // Appliqués une seule fois ici : thème et langue suivent les préférences.
  useTheme();
  useLanguage();
  const refreshKey = useApiKey((s) => s.refresh);
  const loadModels = useModels((s) => s.load);
  const { fontSize, accent, density, onboarded, lastConversationId } = useSettings();
  const { items, loaded } = useConversations();
  const restored = useRef(false);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useShortcuts({ openSearch });

  useEffect(() => {
    void refreshKey();
    void loadModels();
  }, [refreshKey, loadModels]);

  // Reprise de la conversation ouverte lors de la dernière session (une seule fois, au lancement).
  useEffect(() => {
    if (restored.current || !loaded || !onboarded || pathname !== '/') return;
    restored.current = true;
    if (lastConversationId && items.some((c) => c.id === lastConversationId)) {
      void navigate({
        to: '/chat/$conversationId',
        params: { conversationId: lastConversationId },
      });
    }
  }, [loaded, onboarded, pathname, lastConversationId, items, navigate]);

  // Premier lancement : assistant de bienvenue.
  useEffect(() => {
    if (!onboarded && pathname !== '/welcome') void navigate({ to: '/welcome' });
  }, [onboarded, pathname, navigate]);

  // Préférences d'apparence appliquées sur <html> (voir globals.css).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.fontSize = fontSize;
    root.dataset.accent = accent;
    root.dataset.density = density;
  }, [fontSize, accent, density]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {pathname !== '/welcome' && <ConversationSidebar onOpenSearch={openSearch} />}
        <main className="flex min-w-0 flex-1 flex-col">
          <ErrorBoundary>
            <div key={pathname} className="flex min-h-0 flex-1 animate-fade-in flex-col">
              <Outlet />
            </div>
          </ErrorBoundary>
        </main>
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <DialogHost />
      <Toaster />
    </div>
  );
}
