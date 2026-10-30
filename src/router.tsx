import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { ChatPage } from '@/pages/chat';
import { SettingsPage } from '@/pages/settings';

/**
 * Routage « code-based » (TanStack Router) : explicite et sans génération de fichiers.
 * `/` ouvre une nouvelle conversation, `/chat/:id` une conversation existante.
 */
const rootRoute = createRootRoute({ component: AppShell });

const newChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <ChatPage conversationId={null} />,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat/$conversationId',
  component: function ChatRoute() {
    const { conversationId } = chatRoute.useParams();
    return <ChatPage key={conversationId} conversationId={conversationId} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([newChatRoute, chatRoute, settingsRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    ...(history ? { history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
