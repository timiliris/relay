import { describe, expect, it } from 'vitest';
import { adultPresetId, adultPresets } from './adult-presets';
import { defaultPresets } from './default-presets';
import { buildSystemPrompt } from './persona';

describe('adultPresets', () => {
  it('fournit six jeux de rôle et une petite voix 18+, identiques dans les deux langues', () => {
    const fr = adultPresets('fr');
    const en = adultPresets('en');
    expect(fr).toHaveLength(7);
    expect(fr.map((p) => p.key)).toEqual(en.map((p) => p.key));
    for (const p of [...fr, ...en]) {
      expect(p.persona?.mature).toBe(true);
      expect(p.reasoning).toBe(false);
      const sheet = p.persona?.mode === 'innerVoice' ? p.persona.innerVoice : p.persona?.roleplay;
      expect(sheet?.greeting.length).toBeGreaterThan(80);
      expect(sheet?.character.length).toBeGreaterThan(80);
      // Chaque fiche rappelle le cadre : adultes consentants, limites du joueur.
      expect(p.systemPrompt).toMatch(/consentants|consenting/);
    }
    expect(fr.filter((p) => p.persona?.mode === 'innerVoice').map((p) => p.key)).toEqual([
      'roommate-voice',
    ]);
  });

  it('la petite voix de Léa fait d’elle le personnage principal et de Jules le second', () => {
    const lea = adultPresets('fr').find((p) => p.key === 'roommate-voice');
    expect(lea?.persona?.innerVoice.characterName).toBe('Léa');
    expect(lea?.persona?.innerVoice.otherName).toBe('Jules');
    expect(lea?.persona?.innerVoice.greeting).toContain('{{user}}');
    const prompt = buildSystemPrompt(
      {
        name: lea?.name ?? '',
        systemPrompt: lea?.systemPrompt ?? '',
        persona: lea?.persona ?? defaultPresetsFail(),
      },
      'fr',
    );
    expect(prompt).toContain('Petite voix : tu incarnes Léa');
    expect(prompt).toContain('Second personnage : Jules');
    expect(prompt).toContain('Contenu mature (18+)');
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
      expect(prompt).toMatch(/Jeu de rôle : tu incarnes|Petite voix : tu incarnes/);
      expect(prompt).toContain('Contenu mature (18+)');
    }
  });
});

function defaultPresetsFail(): never {
  throw new Error('persona manquant');
}
