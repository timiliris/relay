import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { ChatPage } from '@/pages/chat';

/**
 * Routage « code-based » (TanStack Router) : explicite et sans génération de fichiers.
 * `/` ouvre une nouvelle conversation, `/chat/:id` une conversation existante.
 * Les écrans secondaires sont chargés à la demande pour accélérer le démarrage.
 */
const ComparePage = lazy(() => import('@/pages/compare').then((m) => ({ default: m.ComparePage })));
const UsagePage = lazy(() => import('@/pages/usage').then((m) => ({ default: m.UsagePage })));
const SettingsPage = lazy(() =>
  import('@/pages/settings').then((m) => ({ default: m.SettingsPage })),
);
const OnboardingPage = lazy(() =>
  import('@/pages/onboarding').then((m) => ({ default: m.OnboardingPage })),
);

function PageFallback() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-8" aria-busy="true">
      <div className="skeleton h-6 w-40" />
      <div className="skeleton h-28" />
      <div className="skeleton h-28" />
    </div>
  );
}

const withSuspense = (Component: React.LazyExoticComponent<() => React.JSX.Element>) =>
  function LazyRoute() {
    return (
      <Suspense fallback={<PageFallback />}>
        <Component />
      </Suspense>
    );
  };

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

const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compare',
  component: withSuspense(ComparePage),
});
const usageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/usage',
  component: withSuspense(UsagePage),
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: withSuspense(SettingsPage),
});
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/welcome',
  component: withSuspense(OnboardingPage),
});

const routeTree = rootRoute.addChildren([
  newChatRoute,
  chatRoute,
  compareRoute,
  usageRoute,
  settingsRoute,
  welcomeRoute,
]);

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
