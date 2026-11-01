import type { CSSProperties } from 'react';

/**
 * Teinte OKLCH stable (0–359) dérivée d'une chaîne : un même modèle, persona ou dossier
 * garde toujours la même couleur. (FNV-1a 32 bits.)
 */
export function hueOf(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

/** Style inline exposant `--hue` aux utilitaires `.hue-text`, `.hue-soft`, `.hue-solid` (globals.css). */
export function hueStyle(seed: string): CSSProperties {
  return { '--hue': hueOf(seed) } as CSSProperties;
}

/** Palette catégorielle (barres, séries) : classes Tailwind complètes pour que le JIT les conserve. */
export const CHART_BG = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
  'bg-chart-6',
] as const;

export function chartBg(index: number): string {
  return CHART_BG[index % CHART_BG.length] ?? CHART_BG[0];
}
