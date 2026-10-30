import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// Langue déterministe pour les tests (le système jsdom est en `en-US` par défaut).
Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });

// jsdom n'implémente pas matchMedia (utilisé par le hook de thème).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// jsdom n'implémente pas ResizeObserver (utilisé par le composer).
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverMock });

// Initialise i18n après le mock de navigator.language.
await import('@/i18n');

// Les tests rendent l'app sans assistant de premier lancement.
const { useSettings } = await import('@/stores/settings');
useSettings.setState({ onboarded: true });
