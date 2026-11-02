import { beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateTokens } from '../context';
import type { FileEntry } from './commands';
import {
  buildProjectContext,
  capTokens,
  compactTree,
  MAX_CONTEXT_TOKENS,
  MAX_INSTRUCTIONS_CHARS,
  MAX_TREE_LINES,
  summarizeManifest,
} from './context';

/** Système de fichiers simulé : chemins relatifs (séparateur `/`) → contenu. */
const { fsMap, commands } = vi.hoisted(() => {
  const fsMap = new Map<string, string>();
  const entriesOf = (depth: number): FileEntry[] => {
    const seen = new Map<string, FileEntry>();
    for (const path of fsMap.keys()) {
      const parts = path.split('/');
      for (let i = 1; i <= Math.min(depth, parts.length); i++) {
        const sub = parts.slice(0, i).join('/');
        if (sub.startsWith('.git')) continue;
        const isDir = i < parts.length;
        seen.set(sub, {
          path: sub,
          kind: isDir ? 'dir' : 'file',
          size: isDir ? null : (fsMap.get(path)?.length ?? 0),
        });
      }
    }
    return [...seen.values()].sort(
      (a, b) => Number(a.kind !== 'dir') - Number(b.kind !== 'dir') || a.path.localeCompare(b.path),
    );
  };
  const commands = {
    listFiles: vi.fn(async (_ws: string, _path: string, depth: number) => ({
      entries: entriesOf(depth),
      truncated: false,
    })),
    readFile: vi.fn(async (_ws: string, path: string, offset = 1, limit?: number) => {
      const content = fsMap.get(path);
      if (content === undefined) throw new Error(`not a file: ${path}`);
      const lines = content.split('\n');
      const selected = lines.slice(offset - 1, limit ? offset - 1 + limit : undefined);
      return {
        content: selected.join('\n'),
        totalLines: lines.length,
        truncated: offset - 1 + selected.length < lines.length,
      };
    }),
  };
  return { fsMap, commands };
});

vi.mock('./commands', () => ({ agentCommands: commands }));

const WS = 'C:\\work\\relay';

beforeEach(() => {
  fsMap.clear();
  vi.clearAllMocks();
});

describe('buildProjectContext', () => {
  it('compacte l’arborescence sur deux niveaux et détecte Git et le gestionnaire de paquets', async () => {
    fsMap.set('.git/HEAD', 'ref: refs/heads/main');
    fsMap.set('pnpm-lock.yaml', '');
    fsMap.set('src/main.tsx', '');
    fsMap.set('src/lib/a.ts', '');
    fsMap.set('src/lib/b.ts', '');
    fsMap.set('src/stores/x.ts', '');
    fsMap.set('docs/guide.md', '');
    fsMap.set('index.html', '<html/>');

    const ctx = await buildProjectContext(WS);
    expect(ctx.git).toBe(true);
    expect(ctx.packageManager).toBe('pnpm');
    expect(
      ctx.text.startsWith(
        'Project context:\nWorkspace "relay" (Git repository, package manager: pnpm).',
      ),
    ).toBe(true);
    // `src/` compte ses entrées directes (main.tsx, lib/, stores/) et non les fichiers profonds.
    expect(ctx.text).toContain('src/ (3)');
    expect(ctx.text).toContain('docs/ (1)');
    expect(ctx.text).toContain('\nindex.html');
    expect(ctx.text).not.toContain('src/lib/a.ts');
    expect(commands.listFiles).toHaveBeenCalledWith(WS, '.', 2);
  });

  it('reprend le premier fichier d’instructions trouvé, tronqué à 6 000 caractères', async () => {
    const long = Array.from({ length: 400 }, (_, i) => `- rule ${i}: keep it short`).join('\n');
    fsMap.set('CLAUDE.md', long);
    fsMap.set('RELAY.md', 'ignored');

    const ctx = await buildProjectContext(WS);
    expect(ctx.instructionsFile).toBe('CLAUDE.md');
    expect(ctx.text).toContain('Project instructions (CLAUDE.md, follow them):');
    expect(ctx.text).toContain('- rule 0: keep it short');
    expect(ctx.text).not.toContain('ignored');
    const section = ctx.text.split('Project instructions (CLAUDE.md, follow them):\n')[1] ?? '';
    expect(section.length).toBeLessThanOrEqual(MAX_INSTRUCTIONS_CHARS);
    expect(section).toContain('… (truncated)');
    // Coupure propre : pas de ligne à moitié.
    expect(section).not.toMatch(/- rule \d+: ke\n/);
    expect(commands.readFile).not.toHaveBeenCalledWith(WS, 'RELAY.md');
  });

  it('préfère AGENTS.md à CLAUDE.md', async () => {
    fsMap.set('AGENTS.md', 'Agents rules');
    fsMap.set('CLAUDE.md', 'Claude rules');
    const ctx = await buildProjectContext(WS);
    expect(ctx.instructionsFile).toBe('AGENTS.md');
    expect(ctx.text).toContain('Agents rules');
    expect(ctx.text).not.toContain('Claude rules');
  });

  it('résume les manifestes (racine et un niveau en dessous) et le début du README', async () => {
    fsMap.set(
      'package.json',
      JSON.stringify({
        name: 'relay',
        scripts: { dev: 'vite', build: 'vite build', test: 'vitest' },
      }),
    );
    fsMap.set('src-tauri/Cargo.toml', '[package]\nname = "relay"\nversion = "0.9.0"\n');
    fsMap.set('api/go.mod', 'module github.com/acme/api\n\ngo 1.22\n');
    fsMap.set('README.md', Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'));

    const ctx = await buildProjectContext(WS);
    expect(ctx.text).toContain('- package.json: relay — scripts: dev, build, test');
    expect(ctx.text).toContain('- src-tauri/Cargo.toml: relay 0.9.0');
    expect(ctx.text).toContain('- api/go.mod: github.com/acme/api');
    expect(ctx.text).toContain('README (first 30 lines):\nline 1\n');
    expect(ctx.text).toContain('line 30\n… (truncated)');
    expect(ctx.text).not.toContain('line 31');
    expect(commands.readFile).toHaveBeenCalledWith(WS, 'README.md', 1, 30);
  });

  it('respecte le plafond de tokens en coupant la fin sur une ligne entière', async () => {
    fsMap.set(
      'AGENTS.md',
      Array.from({ length: 300 }, (_, i) => `rule ${i} ${'x'.repeat(40)}`).join('\n'),
    );
    fsMap.set(
      'README.md',
      Array.from({ length: 30 }, (_, i) => `readme ${i} ${'y'.repeat(120)}`).join('\n'),
    );
    for (let i = 0; i < 80; i++) fsMap.set(`dir${String(i).padStart(2, '0')}/f.ts`, '');

    const ctx = await buildProjectContext(WS);
    expect(ctx.tokens).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
    expect(estimateTokens(ctx.text)).toBe(ctx.tokens);
    expect(ctx.text.endsWith('… (truncated)')).toBe(true);
    // Le README, dernier bloc, est sacrifié en premier ; l'arborescence reste entière.
    expect(ctx.text).toContain(`… ${80 + 2 - (MAX_TREE_LINES - 1)} more entries`);
    expect(ctx.text.split('\n').filter((l) => l.startsWith('readme ')).length).toBeLessThan(30);
  });

  it('produit un bloc minimal pour un dossier vide', async () => {
    const ctx = await buildProjectContext(WS);
    expect(ctx.text).toBe(
      [
        'Project context:',
        'Workspace "relay" (not a Git repository).',
        '',
        'Files (2 levels, folders show their entry count):',
        '(empty folder)',
      ].join('\n'),
    );
    expect(ctx.instructionsFile).toBeNull();
    expect(ctx.packageManager).toBeNull();
    expect(ctx.tokens).toBeGreaterThan(0);
  });

  it('reconnaît un dossier de travail qui est un worktree Git (`.git` est un fichier)', async () => {
    fsMap.set('.git', 'gitdir: C:/work/relay/.git/worktrees/x');
    const ctx = await buildProjectContext(WS);
    expect(ctx.git).toBe(true);
  });

  it('ne lance pas d’erreur si la liste échoue', async () => {
    commands.listFiles.mockRejectedValueOnce(new Error('workspace_denied'));
    const ctx = await buildProjectContext(WS);
    expect(ctx.text).toContain('(empty folder)');
  });
});

describe('compactTree', () => {
  it('plafonne à 60 lignes avec un compteur du reste', () => {
    const entries: FileEntry[] = Array.from({ length: 100 }, (_, i) => ({
      path: `f${String(i).padStart(3, '0')}.txt`,
      kind: 'file',
      size: 1,
    }));
    const lines = compactTree(entries).split('\n');
    expect(lines).toHaveLength(MAX_TREE_LINES);
    expect(lines.at(-1)).toBe('… 41 more entries');
  });
});

describe('summarizeManifest', () => {
  it('résume package.json, Cargo.toml, pyproject.toml, go.mod et composer.json', () => {
    expect(summarizeManifest('package.json', '{"name":"a","scripts":{"dev":"x"}}')).toBe(
      'a — scripts: dev',
    );
    expect(summarizeManifest('package.json', '{"scripts":{}}')).toBe('(unnamed)');
    expect(summarizeManifest('package.json', 'not json')).toBe('(unnamed)');
    expect(summarizeManifest('Cargo.toml', '[package]\nname = "core"\nversion = "1.2.3"')).toBe(
      'core 1.2.3',
    );
    expect(summarizeManifest('pyproject.toml', '[project]\nname = "tool"\n')).toBe('tool');
    expect(summarizeManifest('go.mod', 'module example.com/m\n')).toBe('example.com/m');
    expect(summarizeManifest('composer.json', '{"name":"acme/app"}')).toBe('acme/app');
  });
});

describe('capTokens', () => {
  it('laisse passer un texte sous le plafond et coupe les autres proprement', () => {
    expect(capTokens('short', 10)).toBe('short');
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const capped = capTokens(text, 20);
    expect(estimateTokens(capped)).toBeLessThanOrEqual(20);
    expect(capped.endsWith('\n… (truncated)')).toBe(true);
    expect(
      capped
        .split('\n')
        .slice(0, -1)
        .every((l) => /^line \d+$/.test(l)),
    ).toBe(true);
  });
});
