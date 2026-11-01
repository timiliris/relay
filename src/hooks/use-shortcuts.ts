import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { stopStreaming } from '@/lib/chat-service';
import { useChat } from '@/stores/chat';
import { useSettings } from '@/stores/settings';

interface ShortcutHandlers {
  openSearch: () => void;
}

/**
 * Raccourcis globaux de l'application :
 * Ctrl/⌘+N nouvelle conversation, Ctrl/⌘+K recherche, Ctrl/⌘+B historique, Ctrl/⌘+, paramètres,
 * Échap arrêt du flux.
 */
export function useShortcuts({ openSearch }: ShortcutHandlers) {
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void navigate({ to: '/' });
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        const { sidebarCollapsed, patch } = useSettings.getState();
        patch({ sidebarCollapsed: !sidebarCollapsed });
      } else if (mod && e.key === ',') {
        e.preventDefault();
        void navigate({ to: '/settings' });
      } else if (e.key === 'Escape' && useChat.getState().stream) {
        stopStreaming();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, openSearch]);
}
