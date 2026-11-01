import { describe, expect, it } from 'vitest';
import { adultPresetId, adultPresets } from './adult-presets';
import { defaultPresets } from './default-presets';
import { buildSystemPrompt } from './persona';

describe('adultPresets', () => {
  it('fournit six personas 18+ en jeu de rôle, identiques dans les deux langues', () => {
    const fr = adultPresets('fr');
    const en = adultPresets('en');
    expect(fr).toHaveLength(6);
    expect(fr.map((p) => p.key)).toEqual(en.map((p) => p.key));
    for (const p of [...fr, ...en]) {
      expect(p.persona?.mode).toBe('roleplay');
      expect(p.persona?.mature).toBe(true);
      expect(p.reasoning).toBe(false);
      expect(p.persona?.roleplay.greeting.length).toBeGreaterThan(80);
      expect(p.persona?.roleplay.character.length).toBeGreaterThan(80);
      // Chaque fiche rappelle le cadre : adultes consentants, limites du joueur.
      expect(p.systemPrompt).toMatch(/consentants|consenting/);
    }
  });

  it('reste séparé des personas par défaut et produit une instruction avec le bloc 18+', () => {
    const defaults = new Set(defaultPresets('fr').map((p) => p.key));
    for (const p of adultPresets('fr')) {
      expect(adultPresetId(p.key).startsWith('adult-')).toBe(true);
      expect(defaults.has(p.key)).toBe(false);
      const prompt = buildSystemPrompt(
        { name: p.name, systemPrompt: p.systemPrompt, persona: p.persona ?? defaultPresetsFail() },
        'fr',
      );
      expect(prompt).toContain('Jeu de rôle : tu incarnes');
      expect(prompt).toContain('Contenu mature (18+)');
    }
  });
});

function defaultPresetsFail(): never {
  throw new Error('persona manquant');
}
