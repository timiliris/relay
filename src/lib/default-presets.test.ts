import { describe, expect, it } from 'vitest';
import { defaultPresetId, defaultPresets } from './default-presets';

describe('defaultPresets', () => {
  it('fournit les mêmes personas dans les deux langues, avec des identifiants stables', () => {
    const fr = defaultPresets('fr');
    const en = defaultPresets('en');
    expect(fr.map((p) => p.key)).toEqual(en.map((p) => p.key));
    expect(new Set(fr.map((p) => p.key)).size).toBe(fr.length);
    expect(defaultPresetId('developer')).toBe('default-developer');
    for (const p of [...fr, ...en]) {
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.systemPrompt?.length ?? 0).toBeGreaterThan(40);
      expect(p.temperature).toBeGreaterThanOrEqual(0);
      expect(p.temperature).toBeLessThanOrEqual(1);
    }
  });
});
