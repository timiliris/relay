import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  actionScript,
  DEFAULT_READ_CHARS,
  describeFailure,
  EXCERPT_CHARS,
  executeBrowserTool,
  formatSnapshot,
  LOAD_TIMEOUT_MS,
  MAX_ELEMENTS,
  MAX_READ_CHARS,
  type PageSnapshot,
  prettyJson,
  readScript,
  resolveUrl,
  SETTLE_MS,
} from './browser-tools';

const { commands, store } = vi.hoisted(() => ({
  commands: {
    validateUrl: vi.fn(),
    waitLoad: vi.fn(),
    eval: vi.fn(),
    reload: vi.fn(),
  },
  store: {
    state: {
      open: false,
      url: null as string | null,
      title: null as string | null,
      openUrl: vi.fn(),
    },
  },
}));

vi.mock('./commands', () => ({ browserCommands: commands }));
vi.mock('@/stores/browser', () => ({
  useBrowser: {
    getState: () => store.state,
    setState: (patch: Partial<typeof store.state>) => Object.assign(store.state, patch),
  },
}));

const WORKSPACE = 'C:\\Users\\me\\site';

const page: PageSnapshot = {
  url: 'file:///C:/Users/me/site/index.html',
  title: 'Ma boutique',
  text: 'Bienvenue\n\nAjoutez des articles au panier.',
  truncated: false,
  elements: [
    { n: 1, kind: 'link', text: 'Accueil', href: 'file:///C:/Users/me/site/index.html' },
    { n: 2, kind: 'button', text: 'Ajouter au panier' },
    { n: 3, kind: 'text', name: 'q', placeholder: 'Rechercher', value: '' },
    { n: 4, kind: 'checkbox', text: 'Se souvenir de moi', checked: true },
    { n: 5, kind: 'select', text: 'Taille', value: 'm', options: ['S', 'M', 'L'] },
  ],
  errors: [],
};

/** Réponse de `browser_eval` pour une valeur JSON. */
const ok = (value: unknown, truncated = false) => ({
  ok: true,
  json: JSON.stringify(value),
  truncated,
});

beforeEach(() => {
  for (const fn of Object.values(commands)) fn.mockReset();
  store.state.open = false;
  store.state.url = null;
  store.state.title = null;
  store.state.openUrl.mockReset();
  commands.validateUrl.mockImplementation(async (url: string) => url);
  commands.waitLoad.mockResolvedValue({ loaded: true, url: page.url });
  commands.reload.mockResolvedValue(undefined);
});

describe('resolveUrl', () => {
  it('garde une URL absolue, complète un hôte local ou un domaine', () => {
    expect(resolveUrl('https://example.com/a', WORKSPACE)).toBe('https://example.com/a');
    expect(resolveUrl('localhost:5173', WORKSPACE)).toBe('http://localhost:5173');
    expect(resolveUrl('127.0.0.1:8080/app', WORKSPACE)).toBe('http://127.0.0.1:8080/app');
    expect(resolveUrl('docs.rs/tauri', WORKSPACE)).toBe('https://docs.rs/tauri');
  });

  it('convertit un chemin relatif au dossier de travail en file://', () => {
    expect(resolveUrl('index.html', WORKSPACE)).toBe('file:///C:/Users/me/site/index.html');
    expect(resolveUrl('./dist/index.html', WORKSPACE)).toBe(
      'file:///C:/Users/me/site/dist/index.html',
    );
    expect(resolveUrl('mon dossier/page.html', '/home/me/site/')).toBe(
      'file:///home/me/site/mon%20dossier/page.html',
    );
  });
});

describe('browser_navigate', () => {
  it('ouvre le volet sur l’URL validée, attend la page et la décrit avec ses éléments numérotés', async () => {
    commands.eval.mockResolvedValue(ok(page));
    const outcome = await executeBrowserTool('browser_navigate', { url: 'index.html' }, WORKSPACE);

    expect(commands.validateUrl).toHaveBeenCalledWith('file:///C:/Users/me/site/index.html');
    expect(store.state.openUrl).toHaveBeenCalledWith('file:///C:/Users/me/site/index.html');
    expect(commands.reload).not.toHaveBeenCalled();
    expect(commands.waitLoad).toHaveBeenCalledWith(LOAD_TIMEOUT_MS, 0);
    const script = commands.eval.mock.calls[0]?.[0] as string;
    expect(script).toContain(`"maxChars":${DEFAULT_READ_CHARS}`);
    expect(script).toContain(`"maxElements":${MAX_ELEMENTS}`);
    expect(script).toContain('data-relay-ref');

    expect(outcome.content).toBe(
      [
        '# Ma boutique',
        'URL: file:///C:/Users/me/site/index.html',
        '',
        'Bienvenue',
        '',
        'Ajoutez des articles au panier.',
        '',
        'Interactive elements (use the number as target):',
        '[1] link "Accueil" → file:///C:/Users/me/site/index.html',
        '[2] button "Ajouter au panier"',
        '[3] text name=q placeholder="Rechercher"',
        '[4] checkbox "Se souvenir de moi" checked',
        '[5] select "Taille" value="m" options: S | M | L',
      ].join('\n'),
    );
    expect(outcome.meta).toEqual({ truncated: false });
  });

  it('recharge la page quand le volet affiche déjà cette URL', async () => {
    store.state.open = true;
    store.state.url = page.url;
    commands.eval.mockResolvedValue(ok(page));
    await executeBrowserTool('browser_navigate', { url: page.url }, WORKSPACE);
    expect(commands.reload).toHaveBeenCalled();
    expect(store.state.openUrl).not.toHaveBeenCalled();
  });

  it('signale une page encore en chargement et les erreurs de console', async () => {
    commands.waitLoad.mockResolvedValue({ loaded: false, url: page.url });
    commands.eval.mockResolvedValue(
      ok({
        ...page,
        truncated: true,
        errors: [{ level: 'error', message: 'Uncaught TypeError: x is not a function (app.js:3)' }],
      }),
    );
    const outcome = await executeBrowserTool('browser_navigate', { url: page.url }, WORKSPACE);
    expect(outcome.content).toContain('(the page was still loading when read)');
    expect(outcome.content).toContain('(text truncated');
    expect(outcome.content).toContain(
      'Console since page load:\n- error: Uncaught TypeError: x is not a function (app.js:3)',
    );
    expect(outcome.meta.truncated).toBe(true);
  });

  it('laisse remonter le refus de Rust (fichier hors dossier)', async () => {
    commands.validateUrl.mockRejectedValue({
      kind: 'tool',
      code: null,
      message: '`C:\\secret.html` is outside the workspace: only workspace files can be opened.',
    });
    await expect(
      executeBrowserTool('browser_navigate', { url: 'file:///C:/secret.html' }, WORKSPACE),
    ).rejects.toMatchObject({ kind: 'tool' });
    expect(store.state.openUrl).not.toHaveBeenCalled();
  });
});

describe('browser_read', () => {
  it('lit un élément par sélecteur avec la limite demandée', async () => {
    commands.eval.mockResolvedValue(ok({ ...page, elements: [] }));
    const outcome = await executeBrowserTool(
      'browser_read',
      { selector: '#cart', max_chars: 10_000_000 },
      WORKSPACE,
    );
    const script = commands.eval.mock.calls[0]?.[0] as string;
    expect(script).toContain(`"selector":"#cart"`);
    expect(script).toContain(`"maxChars":${MAX_READ_CHARS}`);
    expect(outcome.content).not.toContain('Interactive elements');
    expect(commands.waitLoad).not.toHaveBeenCalled();
  });

  it('échoue clairement quand le sélecteur ne correspond à rien', async () => {
    commands.eval.mockResolvedValue(ok({ ...page, missing: true }));
    await expect(
      executeBrowserTool('browser_read', { selector: '#nope' }, WORKSPACE),
    ).rejects.toThrow('No element matches the selector "#nope".');
  });

  it('transforme une exception du script en erreur lisible', async () => {
    commands.eval.mockResolvedValue({
      ok: false,
      json: JSON.stringify({ name: 'SyntaxError', message: 'bad selector' }),
      truncated: false,
    });
    await expect(executeBrowserTool('browser_read', {}, WORKSPACE)).rejects.toThrow(
      'SyntaxError: bad selector',
    );
  });
});

describe('browser_click', () => {
  it('clique la cible, attend une éventuelle navigation et décrit ce qui a changé', async () => {
    store.state.url = page.url;
    store.state.title = page.title;
    commands.eval
      .mockResolvedValueOnce(ok({ element: { kind: 'link', text: 'Panier' } }))
      .mockResolvedValueOnce(
        ok({
          ...page,
          url: 'file:///C:/Users/me/site/cart.html',
          title: 'Panier',
          text: 'Votre panier est vide.',
          elements: [{ n: 1, kind: 'link', text: 'Accueil' }],
        }),
      );
    const outcome = await executeBrowserTool('browser_click', { target: '2' }, WORKSPACE);

    const action = commands.eval.mock.calls[0]?.[0] as string;
    expect(action).toContain('"action":"click"');
    expect(action).toContain('"target":"2"');
    expect(commands.waitLoad).toHaveBeenCalledWith(LOAD_TIMEOUT_MS, SETTLE_MS);
    const excerpt = commands.eval.mock.calls[1]?.[0] as string;
    expect(excerpt).toContain(`"maxChars":${EXCERPT_CHARS}`);
    expect(outcome.content).toBe(
      [
        'Clicked link "Panier".',
        'Navigated to file:///C:/Users/me/site/cart.html.',
        '',
        'Page now:',
        '# Panier',
        'URL: file:///C:/Users/me/site/cart.html',
        '',
        'Votre panier est vide.',
        '',
        'Interactive elements (use the number as target):',
        '[1] link "Accueil"',
      ].join('\n'),
    );
  });

  it('indique une page inchangée et remonte l’absence de cible', async () => {
    store.state.url = page.url;
    store.state.title = page.title;
    commands.eval
      .mockResolvedValueOnce(ok({ element: { kind: 'button', text: 'Ajouter au panier' } }))
      .mockResolvedValueOnce(ok(page));
    const outcome = await executeBrowserTool(
      'browser_click',
      { target: 'Ajouter au panier' },
      WORKSPACE,
    );
    expect(outcome.content).toContain(
      'Clicked button "Ajouter au panier".\nURL and title unchanged.',
    );

    commands.eval.mockResolvedValueOnce(ok({ error: 'No element numbered 9: call browser_read' }));
    await expect(executeBrowserTool('browser_click', { target: '9' }, WORKSPACE)).rejects.toThrow(
      'No element numbered 9',
    );
  });
});

describe('browser_type', () => {
  it('saisit le texte, soumet et le dit', async () => {
    store.state.url = page.url;
    store.state.title = page.title;
    commands.eval
      .mockResolvedValueOnce(
        ok({ element: { kind: 'text', text: '', name: 'q' }, submitted: true }),
      )
      .mockResolvedValueOnce(ok({ ...page, title: 'Résultats' }));
    const outcome = await executeBrowserTool(
      'browser_type',
      { target: 'Rechercher', text: 'chaussures', submit: true },
      WORKSPACE,
    );
    const action = commands.eval.mock.calls[0]?.[0] as string;
    expect(action).toContain('"action":"type"');
    expect(action).toContain('"text":"chaussures"');
    expect(action).toContain('"submit":true');
    expect(outcome.content).toContain(
      'Typed "chaussures" into text and submitted the form.\nSame URL, title changed to "Résultats".',
    );
  });
});

describe('browser_eval', () => {
  it('renvoie la valeur en JSON indenté, avec le délai borné', async () => {
    commands.eval.mockResolvedValue(ok({ count: 3, items: ['a', 'b'] }));
    const outcome = await executeBrowserTool(
      'browser_eval',
      { script: 'state()', timeout_secs: 999 },
      WORKSPACE,
    );
    expect(commands.eval).toHaveBeenCalledWith('state()', 120_000);
    expect(outcome.content).toBe('{\n  "count": 3,\n  "items": [\n    "a",\n    "b"\n  ]\n}');
    expect(outcome.meta).toEqual({ truncated: false });
  });

  it('rend une exception comme résultat en erreur et signale la troncature', async () => {
    commands.eval.mockResolvedValueOnce({
      ok: false,
      json: JSON.stringify({ name: 'TypeError', message: 'x is undefined' }),
      truncated: false,
    });
    const failed = await executeBrowserTool('browser_eval', { script: 'x.y' }, WORKSPACE);
    expect(commands.eval).toHaveBeenLastCalledWith('x.y', 15_000);
    expect(failed.content).toBe('Error: TypeError: x is undefined');
    expect(failed.meta).toEqual({ status: 'error', error: 'TypeError: x is undefined' });

    commands.eval.mockResolvedValueOnce({ ok: true, json: '"abc', truncated: true });
    const cut = await executeBrowserTool('browser_eval', { script: 'big' }, WORKSPACE);
    expect(cut.content).toBe('"abc\n… (result truncated)');
    expect(cut.meta.truncated).toBe(true);
  });
});

describe('scripts et mise en forme', () => {
  it('construit des scripts auto-suffisants avec les options en JSON', () => {
    const read = readScript({ selector: 'main', maxChars: 500, maxElements: 10 });
    expect(read.startsWith('(() => {')).toBe(true);
    expect(read).toContain('"selector":"main"');
    expect(read).toContain('__relayLog');
    const act = actionScript({ action: 'type', target: '#q', text: 'a"b', submit: false });
    expect(act).toContain('"text":"a\\"b"');
    expect(act).toContain('requestSubmit');
    expect(act).toContain('outline');
  });

  it('formate une page sans texte ni élément', () => {
    expect(formatSnapshot({ ...page, title: '', text: ' ', elements: [] })).toBe(
      'URL: file:///C:/Users/me/site/index.html\n\n(no visible text)',
    );
  });

  it('borne la liste des éléments d’un extrait', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, kind: 'button', text: `b${i}` }));
    const text = formatSnapshot({ ...page, elements: many }, { maxElements: 2 });
    expect(text).toContain('[2] button "b1"\n… 3 more (call browser_read)');
    expect(text).not.toContain('[3]');
  });

  it('décrit une erreur sérialisée et garde le JSON long tel quel', () => {
    expect(describeFailure('{"name":"Error","message":"boom"}')).toBe('boom');
    expect(describeFailure('"plain"')).toBe('plain');
    expect(describeFailure('{not json')).toBe('{not json');
    const long = `[${'1,'.repeat(3_000)}1]`;
    expect(prettyJson(long)).toBe(long);
    expect(prettyJson('[1]')).toBe('[\n  1\n]');
  });

  it('rejette un outil inconnu', async () => {
    await expect(executeBrowserTool('list_files', {}, WORKSPACE)).rejects.toThrow(
      'Unknown browser tool',
    );
  });
});
