import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessInfo } from '@/lib/agent/commands';
import type { Message } from '@/lib/db';
import { useAgent } from '@/stores/agent';
import { useProcesses } from '@/stores/processes';
import { ToolCallCard } from './tool-call-card';

const { commands } = vi.hoisted(() => ({
  commands: { stopProcess: vi.fn() },
}));

vi.mock('@/lib/agent/commands', () => ({
  agentCommands: commands,
  COMMAND_OUTPUT_EVENT: 'agent://command-output',
  PROCESS_EXIT_EVENT: 'agent://process-exit',
}));

const message = (patch: Partial<Message> = {}): Message => ({
  id: 't1',
  conversationId: 'c1',
  parentId: 'a1',
  active: true,
  role: 'tool',
  content: '',
  reasoning: null,
  attachments: [],
  model: null,
  promptTokens: null,
  completionTokens: null,
  cost: null,
  finishReason: null,
  durationMs: null,
  pinned: false,
  createdAt: '',
  toolCallId: 'call_1',
  toolName: 'run_command',
  toolMeta: {
    args: { command: 'ping -n 5 127.0.0.1' },
    status: 'running',
    risk: 'write',
    cwd: 'C:\\work',
  },
  ...patch,
});

describe('ToolCallCard : commande en cours', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgent.setState({ pending: [], running: null });
    useProcesses.setState({ open: false, items: {} });
    useProcesses.getState().track({
      id: 't1',
      conversationId: 'c1',
      command: 'ping -n 5 127.0.0.1',
      cwd: 'C:\\work',
      background: false,
    });
  });

  it('montre la sortie en direct au fil des fragments', () => {
    render(<ToolCallCard message={message()} />);
    expect(screen.getByText('Sortie en direct')).toBeInTheDocument();
    expect(screen.getByText("(aucune sortie pour l'instant)")).toBeInTheDocument();

    act(() => {
      useProcesses.getState().append('t1', 'Réponse de 127.0.0.1 : octets=32\n');
      useProcesses.getState().append('t1', 'Réponse de 127.0.0.1 : octets=32 (2)\n');
    });
    const pre = screen.getByText(/octets=32 \(2\)/);
    expect(pre.textContent).toContain('Réponse de 127.0.0.1 : octets=32\n');
  });

  it('arrête la commande depuis la carte', async () => {
    const stopped: ProcessInfo = {
      id: 't1',
      pid: 1234,
      command: 'ping -n 5 127.0.0.1',
      cwd: 'C:\\work',
      startedAt: 1,
      endedAt: 2,
      status: 'killed',
      exitCode: null,
      background: false,
      timedOut: false,
    };
    commands.stopProcess.mockResolvedValueOnce(stopped);
    render(<ToolCallCard message={message()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter' }));
    await waitFor(() => expect(commands.stopProcess).toHaveBeenCalledWith('t1'));
    await waitFor(() =>
      expect(useProcesses.getState().items.t1).toMatchObject({ status: 'killed', pid: 1234 }),
    );
  });

  it('signale un arrière-plan terminé avec son PID et un accès au volet', () => {
    render(
      <ToolCallCard
        message={message({
          content: 'Started in background: process id t1, pid 777.',
          toolMeta: {
            args: { command: 'python -m http.server 8123', background: true },
            status: 'done',
            risk: 'write',
            pid: 777,
            background: true,
            durationMs: 3_010,
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/arrière-plan · PID 777/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voir dans Processus' }));
    expect(useProcesses.getState().open).toBe(true);
  });
});
