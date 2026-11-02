import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '@/router';
import { useSettings } from '@/stores/settings';

// Simule le premier rendu dans Tauri : réglages pas encore relus depuis le disque.
vi.mock('@/stores/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/settings')>();
  return { ...actual, useSettingsHydrated: () => false };
});

describe('AppShell avant hydratation des réglages', () => {
  afterEach(() => useSettings.setState({ onboarded: true }));

  it("ne renvoie pas vers l'assistant tant que `onboarded` n'est pas relu", async () => {
    // Valeur par défaut avant hydratation : `false`, alors que le disque dit `true`.
    useSettings.setState({ onboarded: false });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/'] }));
    render(<RouterProvider router={router} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Que voulez-vous explorer ?' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Bienvenue dans Relay' })).toBeNull();
  });
});
