import { describe, expect, it } from 'vitest';
import {
  defaultSnippets,
  expandLeadingSnippet,
  expandSnippet,
  filterSnippets,
  normalizeTrigger,
  pendingTrigger,
  type Snippet,
} from './snippets';

const snippet = (trigger: string, body: string, position = 0): Snippet => ({
  id: trigger,
  trigger,
  title: trigger,
  body,
  position,
});

const list = [
  snippet('résume', 'Résume en cinq points :\n\n{{selection}}', 0),
  snippet('traduis', 'Traduis en anglais :\n\n{{selection}}', 1),
  snippet('colle', 'Analyse :\n\n{{clipboard}}', 2),
  snippet('bref', 'Réponds en une phrase.', 3),
];

describe('pendingTrigger', () => {
  it('détecte un déclencheur en cours de frappe', () => {
    expect(pendingTrigger('/')).toBe('');
    expect(pendingTrigger('/ré')).toBe('ré');
  });

  it('ne réagit plus après un espace ni sans slash initial', () => {
    expect(pendingTrigger('/résume ceci')).toBeNull();
    expect(pendingTrigger('bonjour /résume')).toBeNull();
    expect(pendingTrigger('')).toBeNull();
  });
});

describe('filterSnippets', () => {
  it('rend tout, trié par position, pour une saisie vide', () => {
    expect(filterSnippets([...list].reverse(), '').map((s) => s.trigger)).toEqual([
      'résume',
      'traduis',
      'colle',
      'bref',
    ]);
  });

  it('place les préfixes avant les autres correspondances, insensible à la casse', () => {
    const all = [...list, snippet('autre', '', 4), snippet('mésumé', '', 5)];
    all[4] = { ...(all[4] as Snippet), title: 'Résumé long' };
    expect(filterSnippets(all, 'RÉ').map((s) => s.trigger)).toEqual(['résume', 'autre']);
    expect(filterSnippets(list, 'zzz')).toEqual([]);
  });
});

describe('expandLeadingSnippet', () => {
  const clipboard = async () => 'contenu copié';

  it('remplace le déclencheur et insère la sélection', async () => {
    expect(await expandLeadingSnippet('/résume voici le texte', list, clipboard)).toBe(
      'Résume en cinq points :\n\nvoici le texte',
    );
  });

  it('laisse un déclencheur inconnu ou un texte ordinaire tels quels', async () => {
    expect(await expandLeadingSnippet('/inconnu texte', list, clipboard)).toBe('/inconnu texte');
    expect(await expandLeadingSnippet('bonjour', list, clipboard)).toBe('bonjour');
  });

  it('ajoute la sélection à la fin si le corps ne la mentionne pas', async () => {
    expect(await expandLeadingSnippet('/bref pourquoi le ciel est bleu ?', list, clipboard)).toBe(
      'Réponds en une phrase.\n\npourquoi le ciel est bleu ?',
    );
    expect(await expandLeadingSnippet('/bref', list, clipboard)).toBe('Réponds en une phrase.');
  });

  it('lit le presse-papiers seulement quand le gabarit le demande', async () => {
    let reads = 0;
    const counting = async () => {
      reads++;
      return 'presse-papiers';
    };
    expect(await expandLeadingSnippet('/colle', list, counting)).toBe(
      'Analyse :\n\npresse-papiers',
    );
    expect(reads).toBe(1);
    await expandLeadingSnippet('/résume x', list, counting);
    expect(reads).toBe(1);
  });

  it('tolère un presse-papiers inaccessible', async () => {
    const failing = async () => {
      throw new Error('denied');
    };
    const safe = () => failing().catch(() => '');
    expect(await expandSnippet(list[2] as Snippet, '', safe)).toBe('Analyse :');
  });
});

describe('defaultSnippets', () => {
  it('fournit des déclencheurs distincts dans chaque langue', () => {
    let n = 0;
    const id = () => `id${n++}`;
    const frs = defaultSnippets('fr', id);
    const ens = defaultSnippets('en', id);
    expect(frs.map((s) => s.trigger)).toContain('résume');
    expect(ens.map((s) => s.trigger)).toContain('summarize');
    expect(new Set(frs.map((s) => s.trigger)).size).toBe(frs.length);
    expect(new Set([...frs, ...ens].map((s) => s.id)).size).toBe(frs.length + ens.length);
  });
});

describe('normalizeTrigger', () => {
  it('retire le slash et les espaces', () => {
    expect(normalizeTrigger(' /Mon Raccourci ')).toBe('mon-raccourci');
  });
});
