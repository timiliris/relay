import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_VISITED,
  normalizeAddress,
  pushVisited,
  selectVisited,
  useBrowser,
  type VisitedPage,
} from './browser';

describe('normalizeAddress', () => {
  it('conserve une URL http(s) complète', () => {
    expect(normalizeAddress('https://example.com/docs?x=1#top')).toBe(
      'https://example.com/docs?x=1#top',
    );
    expect(normalizeAddress('  http://localhost:1420/  ')).toBe('http://localhost:1420/');
  });

  it('ajoute https:// devant un hôte, un port ou une adresse IP', () => {
    expect(normalizeAddress('example.com')).toBe('https://example.com');
    expect(normalizeAddress('docs.rs/tauri/latest')).toBe('https://docs.rs/tauri/latest');
    expect(normalizeAddress('localhost:1420')).toBe('https://localhost:1420');
    expect(normalizeAddress('192.168.0.1/admin')).toBe('https://192.168.0.1/admin');
    expect(normalizeAddress('münchen.de')).toBe('https://münchen.de');
  });

  it('transforme le reste en recherche DuckDuckGo', () => {
    expect(normalizeAddress('tauri child webview')).toBe(
      'https://duckduckgo.com/?q=tauri%20child%20webview',
    );
    expect(normalizeAddress('rust')).toBe('https://duckduckgo.com/?q=rust');
    expect(normalizeAddress('what is example.com')).toBe(
      'https://duckduckgo.com/?q=what%20is%20example.com',
    );
  });

  it('refuse les schémas non web en les traitant comme une recherche', () => {
    expect(normalizeAddress('file:///C:/secret.txt')).toBe(
      'https://duckduckgo.com/?q=file%3A%2F%2F%2FC%3A%2Fsecret.txt',
    );
    expect(normalizeAddress('javascript:alert(1)')).toBe(
      'https://duckduckgo.com/?q=javascript%3Aalert(1)',
    );
  });

  it('renvoie null pour une saisie vide', () => {
    expect(normalizeAddress('')).toBeNull();
    expect(normalizeAddress('   ')).toBeNull();
  });
});

describe('pushVisited', () => {
  const page = (n: number, title: string | null = null): VisitedPage => ({
    url: `https://e.com/${n}`,
    title,
    visitedAt: n,
  });

  it('place la page en tête, sans doublon, et garde le titre connu', () => {
    const list = pushVisited([page(1, 'Un'), page(2, 'Deux')], page(1));
    expect(list.map((p) => p.url)).toEqual(['https://e.com/1', 'https://e.com/2']);
    expect(list[0]?.title).toBe('Un');
  });

  it('ne dépasse jamais la limite', () => {
    let list: VisitedPage[] = [];
    for (let i = 0; i < MAX_VISITED + 5; i++) list = pushVisited(list, page(i));
    expect(list).toHaveLength(MAX_VISITED);
    expect(list[0]?.url).toBe(`https://e.com/${MAX_VISITED + 4}`);
  });
});

describe('store du navigateur', () => {
  beforeEach(() => {
    useBrowser.setState({ open: false, url: null, title: null, visited: {}, lastReadPage: null });
  });

  it("enregistre l'URL puis le titre d'une même page, par conversation", () => {
    const s = useBrowser.getState();
    s.navigated('c1', 'https://a.com/', null);
    s.navigated('c1', 'https://a.com/', 'A');
    s.navigated(null, 'https://b.com/', 'B');
    expect(useBrowser.getState().url).toBe('https://b.com/');
    expect(selectVisited('c1')(useBrowser.getState())).toEqual([
      { url: 'https://a.com/', title: 'A', visitedAt: expect.any(Number) },
    ]);
    expect(selectVisited(null)(useBrowser.getState())).toHaveLength(1);
    expect(selectVisited('c2')(useBrowser.getState())).toEqual([]);
  });

  it('oublie le titre quand une autre URL est chargée et vide la liste à la demande', () => {
    const s = useBrowser.getState();
    s.navigated('c1', 'https://a.com/', 'A');
    s.navigated('c1', 'https://a.com/next', null);
    expect(useBrowser.getState().title).toBeNull();
    useBrowser.getState().clearVisited('c1');
    expect(selectVisited('c1')(useBrowser.getState())).toEqual([]);
  });
});
