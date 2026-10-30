import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createAppRouter } from './router';
import { useSettings } from './stores/settings';

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  return render(<RouterProvider router={router} />);
}

describe('Relay', () => {
  it("affiche l'écran d'accueil et l'historique", async () => {
    renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Que voulez-vous explorer ?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouvelle conversation' })).toBeInTheDocument();
    expect(screen.getByText(/Aucune conversation/)).toBeInTheDocument();
  });

  it('affiche la page des paramètres avec la version', async () => {
    renderAt('/settings');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Paramètres' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Version \d+\.\d+\.\d+/)).toBeInTheDocument();
  });

  it('affiche les pages Comparer et Usage', async () => {
    renderAt('/compare');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Comparer des modèles' }),
    ).toBeInTheDocument();
    renderAt('/usage');
    expect(await screen.findByRole('heading', { level: 1, name: 'Usage' })).toBeInTheDocument();
  });

  it("redirige vers l'assistant au premier lancement", async () => {
    useSettings.setState({ onboarded: false });
    renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bienvenue dans Relay' }),
    ).toBeInTheDocument();
    useSettings.setState({ onboarded: true });
  });
});
