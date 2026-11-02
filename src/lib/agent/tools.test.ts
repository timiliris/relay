import { describe, expect, it } from 'vitest';
import {
  approvalKey,
  DEFAULT_AUTO_COMMANDS,
  isReadOnlyCommand,
  missingArgs,
  parseToolArgs,
  toolDefinitions,
  toolRisk,
} from './tools';
import { TOOL_NAMES } from './types';

describe('agent tools', () => {
  it('définit un outil par nom connu, avec un schéma objet et des champs requis existants', () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.function.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const d of defs) {
      expect(d.type).toBe('function');
      expect(d.function.description.length).toBeGreaterThan(40);
      const params = d.function.parameters as {
        type: string;
        properties: Record<string, unknown>;
        required: string[];
      };
      expect(params.type).toBe('object');
      for (const r of params.required) expect(params.properties).toHaveProperty(r);
    }
  });

  it('reconnaît les commandes de lecture par préfixe et refuse tout enchaînement', () => {
    expect(isReadOnlyCommand('git status', DEFAULT_AUTO_COMMANDS)).toBe(true);
    expect(isReadOnlyCommand('  Git   Status --short ', DEFAULT_AUTO_COMMANDS)).toBe(true);
    expect(isReadOnlyCommand('gh pr list --state open', DEFAULT_AUTO_COMMANDS)).toBe(true);
    expect(isReadOnlyCommand('git statusx', DEFAULT_AUTO_COMMANDS)).toBe(false);
    expect(isReadOnlyCommand('git push', DEFAULT_AUTO_COMMANDS)).toBe(false);
    expect(isReadOnlyCommand('git status && rm -rf .', DEFAULT_AUTO_COMMANDS)).toBe(false);
    expect(isReadOnlyCommand('cat a | sh', DEFAULT_AUTO_COMMANDS)).toBe(false);
    expect(isReadOnlyCommand('ls > out.txt', DEFAULT_AUTO_COMMANDS)).toBe(false);
    expect(isReadOnlyCommand('echo $(whoami)', ['echo'])).toBe(false);
    expect(isReadOnlyCommand('', DEFAULT_AUTO_COMMANDS)).toBe(false);
  });

  it('classe le risque : lectures de fichiers, écritures, commandes selon la liste', () => {
    expect(toolRisk('list_files', {}, DEFAULT_AUTO_COMMANDS)).toBe('read');
    expect(toolRisk('read_file', { path: 'a' }, DEFAULT_AUTO_COMMANDS)).toBe('read');
    expect(toolRisk('search_files', { pattern: 'x' }, DEFAULT_AUTO_COMMANDS)).toBe('read');
    expect(toolRisk('write_file', { path: 'a' }, DEFAULT_AUTO_COMMANDS)).toBe('write');
    expect(toolRisk('edit_file', { path: 'a' }, DEFAULT_AUTO_COMMANDS)).toBe('write');
    expect(toolRisk('run_command', { command: 'git diff' }, DEFAULT_AUTO_COMMANDS)).toBe('read');
    expect(toolRisk('run_command', { command: 'pnpm test' }, DEFAULT_AUTO_COMMANDS)).toBe('write');
    expect(toolRisk('run_command', { command: 'pnpm test' }, ['pnpm test'])).toBe('read');
  });

  it('dérive la clé « toujours autoriser » du programme pour les commandes', () => {
    expect(approvalKey('read_file', { path: 'a' })).toBe('read_file');
    expect(approvalKey('run_command', { command: 'Pnpm  test --run' })).toBe('cmd:pnpm');
    expect(approvalKey('run_command', {})).toBe('cmd:');
  });

  it('liste les arguments requis absents ou vides', () => {
    expect(missingArgs('write_file', {})).toEqual(['path', 'content']);
    expect(missingArgs('write_file', { path: 'a.md', content: '' })).toEqual(['content']);
    expect(missingArgs('edit_file', { path: 'a', old: 'x', new: 'y' })).toEqual([]);
    expect(missingArgs('list_files', {})).toEqual([]);
    expect(missingArgs('run_command', { command: 'ls' })).toEqual([]);
  });

  it('tolère des arguments JSON invalides ou non-objets', () => {
    expect(parseToolArgs({ id: '1', name: 'read_file', arguments: '{"path":"a"}' })).toEqual({
      path: 'a',
    });
    expect(parseToolArgs({ id: '1', name: 'read_file', arguments: '{bad' })).toEqual({});
    expect(parseToolArgs({ id: '1', name: 'read_file', arguments: '[1]' })).toEqual({});
    expect(parseToolArgs({ id: '1', name: 'read_file', arguments: '' })).toEqual({});
  });
});
