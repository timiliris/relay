import { Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useApiKey } from '@/stores/api-key';
import { useModels } from '@/stores/models';
import { ConversationSidebar } from './conversation-sidebar';
import { ErrorBoundary } from './error-boundary';
import { TitleBar } from './title-bar';

/** Coquille de l'application : barre de titre, historique à gauche, contenu routé. */
export function AppShell() {
  // Appliqués une seule fois ici : thème et langue suivent les préférences.
  useTheme();
  useLanguage();
  const refreshKey = useApiKey((s) => s.refresh);
  const loadModels = useModels((s) => s.load);

  useEffect(() => {
    void refreshKey();
    void loadModels();
  }, [refreshKey, loadModels]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ConversationSidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
