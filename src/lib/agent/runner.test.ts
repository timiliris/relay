import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgent } from '@/stores/agent';
import { useChat } from '@/stores/chat';
import { useProcesses } from '@/stores/processes';
import { useSettings } from '@/stores/settings';
import type { Conversation, Message } from '../db';
import type { CommandOutput } from './commands';
import { runAgentTurn } from './runner';

const { added, updated, commands } = vi.hoisted(() => ({
  added: [] as Array<Record<string, unknown>>,
  updated: [] as Array<[string, Record<string, unknown>]>,
  commands: {
    registerWorkspace: vi.fn(async (path: string) => ({ root: path, name: 'relay', git: true })),
    readFile: vi.fn(async () => ({ content: 'fn main() {}\n', totalLines: 1, truncated: false })),
    runCommand: vi.fn(
      async (): Promise<CommandOutput> => ({
        exitCode: 0,
        stdout: 'ok\n',
        stderr: '',
        durationMs: 42,
        timedOut: false,
        truncated: false,
        pid: 4242,
        startedAt: 1_000,
        background: false,
        running: false,
      }),
    ),
    listProcesses: vi.fn(async () => []),
    stopProcess: vi.fn(async () => ({
      id: 'bg1',
      pid: 777,
      command: 'python -m http.server 8123',
      cwd: 'C:\\work\\relay',
      startedAt: 1_000,
      endedAt: 2_000,
      status: 'killed',
      exitCode: null,
      background: true,
      timedOut: false,
    })),
    readProcessOutput: vi.fn(async () => ({
      info: {
        id: 'bg1',
        pid: 777,
        command: 'python -m http.server 8123',
        cwd: 'C:\\work\\relay',
        startedAt: 1_000,
        endedAt: null,
        status: 'running',
        exitCode: null,
        background: true,
        timedOut: false,
      },
      stdout: '',
      stderr: 'l1\nl2\nl3\n',
      truncated: false,
    })),
    applyChange: vi.fn(async () => ({
      diff: '--- a\n+++ b\n@@\n-x\n+y',
      exists: true,
      created: false,
    })),
    listFiles: vi.fn(),
    search: vi.fn(),
    previewChange: vi.fn(async () => ({
      diff: '--- a\n+++ b\n@@\n-x\n+y',
      exists: true,
      created: false,
    })),
    cancelTool: vi.fn(),
  },
}));

vi.mock('./commands', () => ({
  agentCommands: commands,
  COMMAND_OUTPUT_EVENT: 'agent://command-output',
  PROCESS_EXIT_EVENT: 'agent://process-exit',
}));

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>();
  let seq = 0;
  return {
    ...actual,
    messages: {
      ...actual.messages,
      async add(input: Record<string, unknown>) {
        added.push(input);
        return { id: `t${++seq}`, active: true, pinned: false, createdAt: '', ...input };
      },
      async update(id: string, patch: Record<string, unknown>) {
        updated.push([id, patch]);
      },
    },
  };
});

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));

const conversation: Conversation = {
  id: 'c1',
  title: 'Agent',
  model: 'openai/gpt-4.1',
  systemPrompt: null,
  pinned: false,
  archived: false,
  folderId: null,
  presetId: null,
  temperature: null,
  topP: null,
  maxTokens: null,
  reasoning: null,
  webSearch: false,
  summary: null,
  summaryUntilId: null,
  workspace: 'C:\\work\\relay',
  agent: true,
  createdAt: '',
  updatedAt: '',
};

const assistant: Message = {
  id: 'a1',
  conversationId: 'c1',
  parentId: null,
  active: true,
  role: 'assistant',
  content: '',
  reasoning: null,
  attachments: [],
  model: 'openai/gpt-4.1',
  promptTokens: null,
  completionTokens: null,
  cost: null,
  finishReason: 'tool_calls',
  durationMs: null,
  pinned: false,
  createdAt: '',
};

describe('runAgentTurn', () => {
  beforeEach(() => {
    added.length = 0;
    updated.length = 0;
    vi.clearAllMocks();
    useSettings.getState().patch({ agentApproval: 'autoRead' });
    useAgent.setState({
      pending: [],
      allowed: {},
      steps: {},
      aborted: false,
      workspaces: {},
      running: null,
    });
    useChat.setState({ conversationId: 'c1', all: [assistant], messages: [assistant] });
    useProcesses.setState({ items: {} });
    useAgent.getState().startTurn('c1');
  });

  it('exécute une lecture sans question puis relance le modèle sous le message tool', async () => {
    const continueWith = vi.fn(async () => {});
    await runAgentTurn(
      conversation,
      assistant,
      [{ id: 'call_1', name: 'read_file', arguments: '{"path":"src/main.rs"}' }],
      continueWith,
    );
    expect(commands.registerWorkspace).toHaveBeenCalledWith('C:\\work\\relay');
    expect(commands.readFile).toHaveBeenCalledWith('C:\\work\\relay', 'src/main.rs', 1, 400);
    expect(added[0]).toMatchObject({ role: 'tool', parentId: 'a1', toolCallId: 'call_1' });
    const [, patch] = updated.at(-1) ?? [];
    expect(String(patch?.content)).toContain('    1| fn main() {}');
    expect(patch?.toolMeta).toMatchObject({ status: 'done', risk: 'read' });
    expect(continueWith).toHaveBeenCalledWith('t1');
    expect(useChat.getState().messages.at(-1)?.role).toBe('tool');
  });

  it('attend l’autorisation pour une commande, puis l’exécute quand elle est accordée', async () => {
    const continueWith = vi.fn(async () => {});
    const turn = runAgentTurn(
      conversation,
      assistant,
      [{ id: 'call_2', name: 'run_command', arguments: '{"command":"pnpm test"}' }],
      continueWith,
    );
    // Laisse la boucle créer le message tool et enregistrer l'attente.
    await vi.waitFor(() => expect(useAgent.getState().pending).toHaveLength(1));
    expect(commands.runCommand).not.toHaveBeenCalled();
    const pendingId = useAgent.getState().pending[0]?.toolMessageId ?? '';
    useAgent.getState().decide(pendingId, 'allowAlways');
    await turn;
    expect(commands.runCommand).toHaveBeenCalledWith(
      pendingId,
      'C:\\work\\relay',
      'pnpm test',
      120,
      false,
    );
    expect(useAgent.getState().allowed.c1).toEqual(['cmd:pnpm']);
    const [, patch] = updated.at(-1) ?? [];
    expect(String(patch?.content)).toContain('exit code: 0');
    expect(patch?.toolMeta).toMatchObject({ status: 'done', exitCode: 0, pid: 4242 });
    expect(continueWith).toHaveBeenCalledTimes(1);
    // Le volet Processus a suivi la commande de bout en bout.
    expect(useProcesses.getState().items[pendingId]).toMatchObject({
      conversationId: 'c1',
      command: 'pnpm test',
      status: 'done',
      exitCode: 0,
      pid: 4242,
      output: 'ok\n',
    });
  });

  it('lance un arrière-plan qui reste en cours, puis l’arrête sur demande du modèle', async () => {
    useSettings.getState().patch({ agentApproval: 'autoAll' });
    commands.runCommand.mockResolvedValueOnce({
      exitCode: null,
      stdout: 'Serving HTTP on :: port 8123\n',
      stderr: '',
      durationMs: 3_005,
      timedOut: false,
      truncated: false,
      pid: 777,
      startedAt: 1_000,
      background: true,
      running: true,
    });
    const continueWith = vi.fn(async () => {});
    await runAgentTurn(
      conversation,
      assistant,
      [
        {
          id: 'call_bg',
          name: 'run_command',
          arguments: '{"command":"python -m http.server 8123","background":true}',
        },
      ],
      continueWith,
    );
    const [toolId, patch] = updated.at(-1) ?? ['', {}];
    expect(commands.runCommand).toHaveBeenCalledWith(
      toolId,
      'C:\\work\\relay',
      'python -m http.server 8123',
      120,
      true,
    );
    expect(String(patch?.content)).toContain(
      `Started in background: process id ${toolId}, pid 777`,
    );
    expect(String(patch?.content)).toContain('port 8123');
    expect(patch?.toolMeta).toMatchObject({ status: 'done', pid: 777, background: true });
    expect(useProcesses.getState().items[toolId]).toMatchObject({ status: 'running', pid: 777 });

    // Lecture puis arrêt par le modèle.
    updated.length = 0;
    await runAgentTurn(
      conversation,
      assistant,
      [
        { id: 'call_r', name: 'read_process_output', arguments: '{"id":"bg1","lines":2}' },
        { id: 'call_s', name: 'stop_process', arguments: '{"id":"bg1"}' },
      ],
      continueWith,
    );
    expect(String(updated[0]?.[1].content)).toBe('status: running, pid 777\nstderr:\nl2\nl3');
    expect(commands.stopProcess).toHaveBeenCalledWith('bg1');
    expect(String(updated[1]?.[1].content)).toContain('(pid 777) killed');
    expect(updated.map(([, p]) => (p.toolMeta as { risk: string }).risk)).toEqual([
      'read',
      'write',
    ]);
  });

  it('marque « annulé » une commande tuée au premier plan', async () => {
    useSettings.getState().patch({ agentApproval: 'autoAll' });
    commands.runCommand.mockResolvedValueOnce({
      exitCode: null,
      stdout: 'partiel\n',
      stderr: '',
      durationMs: 1_200,
      timedOut: false,
      truncated: false,
      pid: 1,
      startedAt: 1_000,
      background: false,
      running: false,
    });
    await runAgentTurn(
      conversation,
      assistant,
      [{ id: 'call_k', name: 'run_command', arguments: '{"command":"ping -n 5 127.0.0.1"}' }],
      vi.fn(async () => {}),
    );
    const [, patch] = updated.at(-1) ?? [];
    expect(String(patch?.content)).toContain('exit code: none (killed)');
    expect(patch?.toolMeta).toMatchObject({ status: 'cancelled', exitCode: null });
  });

  it('transmet un refus au modèle sans exécuter l’outil', async () => {
    const continueWith = vi.fn(async () => {});
    const turn = runAgentTurn(
      conversation,
      assistant,
      [{ id: 'call_3', name: 'edit_file', arguments: '{"path":"a","old":"x","new":"y"}' }],
      continueWith,
    );
    await vi.waitFor(() => expect(useAgent.getState().pending).toHaveLength(1));
    useAgent.getState().decide(useAgent.getState().pending[0]?.toolMessageId ?? '', 'deny');
    await turn;
    expect(commands.applyChange).not.toHaveBeenCalled();
    const [, patch] = updated.at(-1) ?? [];
    expect(patch?.toolMeta).toMatchObject({ status: 'denied' });
    expect(String(patch?.content)).not.toContain(':');
    expect(continueWith).toHaveBeenCalledTimes(1);
  });

  it('montre l’aperçu d’une écriture avant de demander l’autorisation', async () => {
    commands.previewChange.mockResolvedValueOnce({
      diff: '--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1 @@\n+hello',
      exists: false,
      created: true,
    });
    const continueWith = vi.fn(async () => {});
    const turn = runAgentTurn(
      conversation,
      assistant,
      [{ id: 'call_8', name: 'write_file', arguments: '{"path":"notes.md","content":"hello"}' }],
      continueWith,
    );
    await vi.waitFor(() => expect(useAgent.getState().pending).toHaveLength(1));
    // L'aperçu précède la décision et n'écrit rien.
    expect(commands.previewChange).toHaveBeenCalledWith('C:\\work\\relay', 'notes.md', {
      kind: 'write',
      content: 'hello',
    });
    expect(commands.applyChange).not.toHaveBeenCalled();
    const pendingId = useAgent.getState().pending[0]?.toolMessageId ?? '';
    const shown = useChat.getState().messages.find((m) => m.id === pendingId);
    expect(shown?.toolMeta).toMatchObject({ status: 'pending', created: true });
    expect(shown?.toolMeta?.diff).toContain('+hello');
    expect(updated.at(-1)?.[1].toolMeta).toMatchObject({ status: 'pending', created: true });
    expect(useAgent.getState().running).toMatchObject({
      conversationId: 'c1',
      step: 1,
      total: 25,
      phase: 'pending',
      toolMessageId: pendingId,
      toolName: 'write_file',
    });

    useAgent.getState().decide(pendingId, 'allow');
    await turn;
    expect(commands.applyChange).toHaveBeenCalledTimes(1);
    const [, patch] = updated.at(-1) ?? [];
    expect(patch?.toolMeta).toMatchObject({ status: 'done', created: false });
    expect(patch?.toolMeta).toHaveProperty('diff');
    expect(continueWith).toHaveBeenCalledTimes(1);
    expect(useAgent.getState().running).toBeNull();
  });

  it('renvoie une erreur d’aperçu au modèle sans demander l’autorisation', async () => {
    commands.previewChange.mockRejectedValueOnce(new Error('`old` not found in a'));
    const continueWith = vi.fn(async () => {});
    await runAgentTurn(
      conversation,
      assistant,
      [{ id: 'call_9', name: 'edit_file', arguments: '{"path":"a","old":"zzz","new":"y"}' }],
      continueWith,
    );
    expect(useAgent.getState().pending).toHaveLength(0);
    expect(commands.applyChange).not.toHaveBeenCalled();
    const [, patch] = updated.at(-1) ?? [];
    expect(String(patch?.content)).toContain('Error: `old` not found in a');
    expect(patch?.toolMeta).toMatchObject({ status: 'error', error: '`old` not found in a' });
    expect(continueWith).toHaveBeenCalledTimes(1);
  });

  it('n’appelle pas l’aperçu quand la politique autorise sans question', async () => {
    useSettings.getState().patch({ agentApproval: 'autoAll' });
    const continueWith = vi.fn(async () => {});
    await runAgentTurn(
      conversation,
      assistant,
      [{ id: 'call_10', name: 'edit_file', arguments: '{"path":"a","old":"x","new":"y"}' }],
      continueWith,
    );
    expect(commands.previewChange).not.toHaveBeenCalled();
    expect(commands.applyChange).toHaveBeenCalledTimes(1);
  });

  it('transmet le motif du refus au modèle', async () => {
    const continueWith = vi.fn(async () => {});
    const turn = runAgentTurn(
      conversation,
      assistant,
      [{ id: 'call_11', name: 'run_command', arguments: '{"command":"rm -rf dist"}' }],
      continueWith,
    );
    await vi.waitFor(() => expect(useAgent.getState().pending).toHaveLength(1));
    const pendingId = useAgent.getState().pending[0]?.toolMessageId ?? '';
    expect(added[0]?.toolMeta).toMatchObject({ cwd: 'C:\\work\\relay' });
    useAgent.getState().decide(pendingId, 'deny', '  use pnpm clean instead  ');
    await turn;
    expect(commands.runCommand).not.toHaveBeenCalled();
    const [, patch] = updated.at(-1) ?? [];
    expect(patch?.toolMeta).toMatchObject({ status: 'denied' });
    expect(String(patch?.content)).toMatch(/: use pnpm clean instead$/);
    expect(continueWith).toHaveBeenCalledTimes(1);
  });

  it('suit la progression de la boucle pendant que le modèle reprend la main', async () => {
    let resolveModel: () => void = () => {};
    const continueWith = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveModel = resolve;
        }),
    );
    const turn = runAgentTurn(
      conversation,
      assistant,
      [{ id: 'call_12', name: 'read_file', arguments: '{"path":"b"}' }],
      continueWith,
    );
    await vi.waitFor(() => expect(continueWith).toHaveBeenCalledTimes(1));
    expect(useAgent.getState().running).toMatchObject({ step: 2, phase: 'thinking' });
    expect(useAgent.getState().running?.toolMessageId).toBeUndefined();
    resolveModel();
    await turn;
    expect(useAgent.getState().running).toBeNull();
  });

  it('s’arrête sans relancer le modèle quand l’utilisateur interrompt', async () => {
    const continueWith = vi.fn(async () => {});
    const turn = runAgentTurn(
      conversation,
      assistant,
      [
        { id: 'call_4', name: 'run_command', arguments: '{"command":"pnpm build"}' },
        { id: 'call_5', name: 'read_file', arguments: '{"path":"b"}' },
      ],
      continueWith,
    );
    await vi.waitFor(() => expect(useAgent.getState().pending).toHaveLength(1));
    useAgent.getState().abort();
    await turn;
    expect(commands.runCommand).not.toHaveBeenCalled();
    expect(commands.readFile).not.toHaveBeenCalled();
    expect(updated.map(([, p]) => (p.toolMeta as { status: string }).status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(continueWith).not.toHaveBeenCalled();
  });

  it('signale un outil inconnu et convertit une erreur Rust en résultat « error »', async () => {
    commands.readFile.mockRejectedValueOnce(new Error('binary'));
    const continueWith = vi.fn(async () => {});
    await runAgentTurn(
      conversation,
      assistant,
      [
        { id: 'call_6', name: 'teleport', arguments: '{}' },
        { id: 'call_7', name: 'read_file', arguments: '{"path":"img.png"}' },
      ],
      continueWith,
    );
    const statuses = updated.map(([, p]) => (p.toolMeta as { status: string }).status);
    expect(statuses).toEqual(['error', 'error']);
    expect(String(updated[0]?.[1].content)).toContain('unknown tool');
    expect(String(updated[1]?.[1].content)).toContain('binary');
    expect(continueWith).toHaveBeenCalledTimes(1);
  });
});
