import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandOutput, ProcessInfo } from '@/lib/agent/commands';
import {
  appendBounded,
  MAX_OUTPUT_CHARS,
  selectProcesses,
  selectRunningCount,
  useProcesses,
} from './processes';

const { commands } = vi.hoisted(() => ({
  commands: {
    stopProcess: vi.fn(),
  },
}));

vi.mock('@/lib/agent/commands', () => ({
  agentCommands: commands,
  COMMAND_OUTPUT_EVENT: 'agent://command-output',
  PROCESS_EXIT_EVENT: 'agent://process-exit',
}));

const output = (patch: Partial<CommandOutput> = {}): CommandOutput => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  durationMs: 10,
  timedOut: false,
  truncated: false,
  pid: 4242,
  startedAt: 1_000,
  background: false,
  running: false,
  ...patch,
});

const info = (patch: Partial<ProcessInfo> = {}): ProcessInfo => ({
  id: 'p1',
  pid: 4242,
  command: 'ping 127.0.0.1',
  cwd: 'C:\\work',
  startedAt: 1_000,
  endedAt: 5_000,
  status: 'killed',
  exitCode: null,
  background: true,
  timedOut: false,
  ...patch,
});

describe('appendBounded', () => {
  it('ne garde que la fin du tampon au-delà de la limite', () => {
    expect(appendBounded('abc', 'def')).toEqual({ output: 'abcdef', cut: false });
    const long = 'x'.repeat(MAX_OUTPUT_CHARS);
    const next = appendBounded(long, 'END');
    expect(next.cut).toBe(true);
    expect(next.output).toHaveLength(MAX_OUTPUT_CHARS);
    expect(next.output.endsWith('END')).toBe(true);
  });
});

describe('store des processus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProcesses.setState({ open: false, items: {} });
  });

  const track = (id: string, conversationId = 'c1', background = false) =>
    useProcesses.getState().track({
      id,
      conversationId,
      command: `cmd ${id}`,
      cwd: 'C:\\work',
      background,
    });

  it('suit une commande : départ, sortie en direct, puis résultat', () => {
    track('p1');
    expect(useProcesses.getState().items.p1).toMatchObject({
      status: 'running',
      pid: null,
      output: '',
    });
    useProcesses.getState().append('p1', 'ligne 1\n');
    useProcesses.getState().append('p1', 'ligne 2\n');
    useProcesses.getState().append('absent', 'ignoré');
    expect(useProcesses.getState().items.p1?.output).toBe('ligne 1\nligne 2\n');

    useProcesses.getState().settle('p1', output({ exitCode: 3 }));
    expect(useProcesses.getState().items.p1).toMatchObject({
      status: 'done',
      exitCode: 3,
      pid: 4242,
      startedAt: 1_000,
      output: 'ligne 1\nligne 2\n',
    });
    expect(useProcesses.getState().items.p1?.endedAt).toEqual(expect.any(Number));
  });

  it('reprend la sortie du résultat quand aucun fragment n’est arrivé par événement', () => {
    track('p1');
    useProcesses.getState().settle('p1', output({ stdout: 'ok\n', stderr: 'warn\n' }));
    expect(useProcesses.getState().items.p1?.output).toBe('ok\nwarn\n');
  });

  it('garde un arrière-plan en cours après le retour de la commande, puis suit sa fin', () => {
    track('bg', 'c1', true);
    useProcesses
      .getState()
      .settle('bg', output({ exitCode: null, background: true, running: true }));
    expect(useProcesses.getState().items.bg).toMatchObject({ status: 'running', pid: 4242 });
    expect(selectRunningCount('c1')(useProcesses.getState())).toBe(1);

    useProcesses.getState().sync(info({ id: 'bg', status: 'done', exitCode: 0, endedAt: 9_000 }));
    expect(useProcesses.getState().items.bg).toMatchObject({
      status: 'done',
      exitCode: 0,
      endedAt: 9_000,
    });
    expect(selectRunningCount('c1')(useProcesses.getState())).toBe(0);
  });

  it('ne rétrograde pas un processus déjà terminé par l’événement de fin', () => {
    track('p1');
    useProcesses
      .getState()
      .sync(info({ id: 'p1', status: 'done', exitCode: 0, background: false }));
    useProcesses.getState().settle('p1', output({ exitCode: 0 }));
    expect(useProcesses.getState().items.p1).toMatchObject({ status: 'done', exitCode: 0 });
  });

  it('borne la sortie accumulée', () => {
    track('p1');
    useProcesses.getState().append('p1', 'a'.repeat(MAX_OUTPUT_CHARS));
    useProcesses.getState().append('p1', 'fin');
    const entry = useProcesses.getState().items.p1;
    expect(entry?.truncated).toBe(true);
    expect(entry?.output).toHaveLength(MAX_OUTPUT_CHARS);
    expect(entry?.output.endsWith('fin')).toBe(true);
  });

  it('arrête un processus côté Rust et met la fiche à jour', async () => {
    track('p1', 'c1', true);
    commands.stopProcess.mockResolvedValueOnce(info({ id: 'p1', status: 'killed' }));
    await useProcesses.getState().stop('p1');
    expect(commands.stopProcess).toHaveBeenCalledWith('p1');
    expect(useProcesses.getState().items.p1).toMatchObject({ status: 'killed', endedAt: 5_000 });
  });

  it('marque un échec de lancement comme arrêté avec le message', () => {
    track('p1');
    useProcesses.getState().fail('p1', 'workspace_denied');
    expect(useProcesses.getState().items.p1).toMatchObject({ status: 'killed' });
    expect(useProcesses.getState().items.p1?.output).toContain('workspace_denied');
  });

  it('liste les processus d’une conversation, les plus récents en premier, et efface les terminés', () => {
    track('old', 'c1');
    useProcesses.getState().settle('old', output({ startedAt: 1_000 }));
    track('new', 'c1', true);
    useProcesses.getState().settle('new', output({ startedAt: 2_000, running: true }));
    track('other', 'c2');

    const list = selectProcesses('c1')(useProcesses.getState());
    expect(list.map((p) => p.id)).toEqual(['new', 'old']);
    // Référence stable entre deux lectures du même état.
    expect(selectProcesses('c1')(useProcesses.getState())).toBe(list);
    expect(selectProcesses(null)(useProcesses.getState())).toEqual([]);

    useProcesses.getState().clearFinished('c1');
    expect(Object.keys(useProcesses.getState().items).sort()).toEqual(['new', 'other']);
  });

  it('ne s’abonne à rien hors Tauri', async () => {
    await expect(useProcesses.getState().ensureListening()).resolves.toBeUndefined();
  });
});
