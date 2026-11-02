import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageText } from './commands';
import { DEFAULT_FETCH_CHARS, executeWebTool, formatPage, MAX_FETCH_CHARS } from './web-tools';

const { fetchUrl } = vi.hoisted(() => ({ fetchUrl: vi.fn() }));

vi.mock('./commands', () => ({ browserCommands: { fetchUrl } }));

const page: PageText = {
  url: 'https://example.com/',
  title: 'Example Domain',
  text: 'This domain is for use in illustrative examples.',
  truncated: false,
};

describe('fetch_url', () => {
  beforeEach(() => {
    fetchUrl.mockReset();
    fetchUrl.mockResolvedValue(page);
  });

  it('appelle Rust avec l’URL et la limite par défaut, puis met en forme le résultat', async () => {
    const outcome = await executeWebTool('fetch_url', { url: ' https://example.com/ ' });
    expect(fetchUrl).toHaveBeenCalledWith('https://example.com/', DEFAULT_FETCH_CHARS);
    expect(outcome.content).toBe(
      '# Example Domain\nURL: https://example.com/\n\nThis domain is for use in illustrative examples.',
    );
    expect(outcome.meta).toEqual({ truncated: false });
  });

  it('borne max_chars et signale la troncature', async () => {
    fetchUrl.mockResolvedValue({ ...page, title: null, truncated: true });
    const outcome = await executeWebTool('fetch_url', {
      url: 'https://example.com/',
      max_chars: 10_000_000,
    });
    expect(fetchUrl).toHaveBeenCalledWith('https://example.com/', MAX_FETCH_CHARS);
    expect(outcome.content).toContain('(content truncated');
    expect(outcome.content).not.toContain('#');
    expect(outcome.meta.truncated).toBe(true);

    await executeWebTool('fetch_url', { url: 'https://example.com/', max_chars: 'abc' });
    expect(fetchUrl).toHaveBeenLastCalledWith('https://example.com/', DEFAULT_FETCH_CHARS);
  });

  it('laisse remonter les refus de Rust (adresse privée, schéma interdit…)', async () => {
    fetchUrl.mockRejectedValue({
      kind: 'tool',
      code: null,
      message: 'Local addresses are not allowed (`localhost`).',
    });
    await expect(executeWebTool('fetch_url', { url: 'http://localhost/' })).rejects.toMatchObject({
      kind: 'tool',
    });
  });

  it('indique une page sans texte lisible', () => {
    expect(formatPage({ ...page, text: '  \n' })).toContain('(no readable text)');
  });

  it('rejette un outil inconnu', async () => {
    await expect(executeWebTool('list_files', {})).rejects.toThrow('Unknown web tool');
  });
});
