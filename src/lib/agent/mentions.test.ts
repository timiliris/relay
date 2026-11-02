import { describe, expect, it } from 'vitest';
import {
  activeMention,
  applyMention,
  attachmentFromFileContent,
  filterPaths,
  MAX_MENTION_RESULTS,
} from './mentions';

describe('activeMention', () => {
  it('reconnaît un @ en début de texte', () => {
    expect(activeMention('@', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(activeMention('@src/a', 6)).toEqual({ start: 0, end: 6, query: 'src/a' });
  });

  it('reconnaît un @ précédé d’un blanc, jusqu’au curseur seulement', () => {
    expect(activeMention('regarde @comp', 13)).toEqual({ start: 8, end: 13, query: 'comp' });
    expect(activeMention('regarde @comp et dis', 13)).toEqual({ start: 8, end: 13, query: 'comp' });
    expect(activeMention('ligne\n@x', 8)).toEqual({ start: 6, end: 8, query: 'x' });
  });

  it('ignore les adresses et les mentions terminées', () => {
    expect(activeMention('tim@example.com', 15)).toBeNull();
    expect(activeMention('@src/a.ts ', 10)).toBeNull();
    expect(activeMention('@src/a.ts et', 12)).toBeNull();
    expect(activeMention('sans arobase', 12)).toBeNull();
  });

  it('borne le curseur au texte', () => {
    expect(activeMention('@ab', 99)).toEqual({ start: 0, end: 3, query: 'ab' });
    expect(activeMention('@ab', -1)).toBeNull();
  });
});

describe('filterPaths', () => {
  const paths = [
    'README.md',
    'docs/readme-fr.md',
    'src/components/composer.tsx',
    'src/components/composer.test.tsx',
    'src/lib/compose-url.ts',
    'src/stores/explorer.ts',
  ];

  it('renvoie tout, borné, sans requête', () => {
    expect(filterPaths(paths, '')).toEqual(paths);
    expect(filterPaths(paths, '', 2)).toEqual(['README.md', 'docs/readme-fr.md']);
    expect(MAX_MENTION_RESULTS).toBe(200);
  });

  it('classe préfixe du nom, puis nom, puis chemin, insensible à la casse', () => {
    expect(filterPaths(paths, 'comp')).toEqual([
      'src/lib/compose-url.ts',
      'src/components/composer.tsx',
      'src/components/composer.test.tsx',
    ]);
    expect(filterPaths(paths, 'poser.t')).toEqual([
      'src/components/composer.tsx',
      'src/components/composer.test.tsx',
    ]);
    expect(filterPaths(paths, 'ReadMe')).toEqual(['README.md', 'docs/readme-fr.md']);
    expect(filterPaths(paths, 'stores/')).toEqual(['src/stores/explorer.ts']);
  });

  it('ne renvoie rien sans correspondance', () => {
    expect(filterPaths(paths, 'zzz')).toEqual([]);
  });
});

describe('applyMention', () => {
  it('remplace la mention par le chemin et un espace, curseur après', () => {
    const mention = { start: 8, end: 13, query: 'comp' };
    expect(applyMention('regarde @comp', mention, 'src/composer.tsx')).toEqual({
      text: 'regarde @src/composer.tsx ',
      cursor: 26,
    });
  });

  it('n’ajoute pas d’espace si le texte continue par un blanc', () => {
    const mention = { start: 0, end: 2, query: 'c' };
    expect(applyMention('@c puis', mention, 'a.ts')).toEqual({ text: '@a.ts puis', cursor: 5 });
  });
});

describe('attachmentFromFileContent', () => {
  it('construit une pièce jointe texte nommée par le chemin', () => {
    const a = attachmentFromFileContent('src/a.ts', {
      content: 'const é = 1;',
      totalLines: 1,
      truncated: false,
    });
    expect(a).toMatchObject({
      kind: 'text',
      name: 'src/a.ts',
      mime: 'text/plain',
      text: 'const é = 1;',
      size: 13,
    });
    expect(a.id).toBeTruthy();
  });

  it('signale la troncature dans le contenu', () => {
    const a = attachmentFromFileContent('big.log', {
      content: 'l1\nl2',
      totalLines: 900,
      truncated: true,
    });
    expect(a.text).toBe('l1\nl2\n\n[Tronqué : 2 lignes affichées sur 900]');
    expect(a.size).toBe(new TextEncoder().encode(a.text ?? '').byteLength);
  });
});
