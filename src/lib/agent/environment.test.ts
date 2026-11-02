import { describe, expect, it } from 'vitest';
import type { Environment } from './commands';
import { formatEnvironmentBlock, playwrightReady } from './environment';

const env: Environment = {
  os: 'Windows 11',
  shell: 'PowerShell',
  tools: [
    { name: 'git', version: '2.47.1', path: 'C:\\Git\\git.exe' },
    { name: 'node', version: '22.11.0', path: 'C:\\nodejs\\node.exe' },
    { name: 'pnpm', version: null, path: null },
    { name: 'python', version: '3.14.0', path: 'C:\\Python314\\python.exe' },
    { name: 'docker', version: null, path: 'C:\\Docker\\docker.exe' },
  ],
  playwright: { python: true, node: false, browsers: ['chromium'], version: '1.64.1' },
};

describe('formatEnvironmentBlock', () => {
  it('liste OS, shell, outils présents avec version, absents, et Playwright', () => {
    expect(formatEnvironmentBlock(env).split('\n')).toEqual([
      'Environment: Windows 11, PowerShell shell.',
      'Available: git 2.47.1, node 22.11.0, python 3.14.0, docker, playwright 1.64.1 (python; browsers: chromium).',
      'Missing: pnpm.',
      'Trust this list: do not re-check these tools or reinstall them.',
    ]);
  });

  it('range Playwright dans les absents sans paquet, et signale l’absence de navigateur', () => {
    const none = formatEnvironmentBlock({
      ...env,
      tools: [],
      playwright: { python: false, node: false, browsers: [], version: null },
    });
    expect(none).toContain('Available: no known tool detected.');
    expect(none).toContain('Missing: playwright.');

    const noBrowser = formatEnvironmentBlock({
      ...env,
      playwright: { python: false, node: true, browsers: [], version: null },
    });
    expect(noBrowser).toContain('playwright (node; no browsers downloaded)');
    expect(noBrowser).toContain('Missing: pnpm.');
  });

  it('n’a pas de ligne « Missing » quand tout est là', () => {
    const full = formatEnvironmentBlock({ ...env, tools: env.tools.filter((t) => t.path) });
    expect(full).not.toContain('Missing:');
  });
});

describe('playwrightReady', () => {
  it('exige un paquet et au moins un navigateur', () => {
    expect(playwrightReady(env)).toBe(true);
    expect(playwrightReady(null)).toBe(false);
    expect(playwrightReady({ ...env, playwright: { ...env.playwright, browsers: [] } })).toBe(
      false,
    );
    expect(playwrightReady({ ...env, playwright: { ...env.playwright, python: false } })).toBe(
      false,
    );
  });
});
