/**
 * Boucle d'agent : exécute les appels d'outils demandés par le modèle (un message `tool` par
 * appel, approbation éventuelle, commande Rust), puis rend la main à `continueWith` pour que le
 * modèle poursuive avec les résultats.
 */
import { platform } from '@tauri-apps/plugin-os';
import i18n from '@/i18n';
import { useAgent } from '@/stores/agent';
import { useChat } from '@/stores/chat';
import { useExplorer } from '@/stores/explorer';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { type Conversation, type Message, messages as msgRepo, newId } from '../db';
import { errorMessage, isTauri } from '../tauri';
import { agentCommands, type Change } from './commands';
import { approvalKey, missingArgs, parseToolArgs, toolRisk } from './tools';
import { isToolName, type ToolCall, type ToolMeta, type ToolName } from './types';

/** Appels d'outils par tour utilisateur avant arrêt de sécurité. */
export const MAX_AGENT_STEPS = 25;
/** Taille maximale du résultat renvoyé au modèle (le détail complet reste dans `toolMeta`). */
const MAX_RESULT_CHARS = 30_000;

export const osName = (): string => (isTauri() ? platform() : 'web');

export const agentEnabled = (conversation: Conversation): boolean =>
  Boolean(conversation.agent && conversation.workspace);

interface ToolOutcome {
  content: string;
  meta: Partial<ToolMeta>;
}

/** Exécute un outil dans le dossier de travail ; les erreurs Rust deviennent un résultat `error`. */
export async function executeTool(
  workspace: string,
  name: ToolName,
  args: Record<string, unknown>,
  toolId: string,
): Promise<ToolOutcome> {
  const s = useSettings.getState();
  const startedAt = Date.now();
  try {
    switch (name) {
      case 'list_files': {
        const result = await agentCommands.listFiles(
          workspace,
          String(args.path ?? '.'),
          clamp(Number(args.depth ?? 1), 1, 3),
        );
        const lines = result.entries.map((e) =>
          e.kind === 'dir' ? `${e.path}/` : `${e.path} (${e.size ?? 0} B)`,
        );
        if (result.truncated) lines.push('… (truncated)');
        return {
          content: lines.length ? lines.join('\n') : '(empty folder)',
          meta: { truncated: result.truncated },
        };
      }
      case 'read_file': {
        const offset = clamp(Number(args.offset ?? 1), 1, Number.MAX_SAFE_INTEGER);
        const limit = clamp(Number(args.limit ?? 400), 1, 2000);
        const file = await agentCommands.readFile(
          workspace,
          String(args.path ?? ''),
          offset,
          limit,
        );
        const numbered = file.content
          .split('\n')
          .map((line, i) => `${String(offset + i).padStart(5)}| ${line}`)
          .join('\n');
        const header = `[${String(args.path)} — lines ${offset}-${offset + file.content.split('\n').length - 1} of ${file.totalLines}${file.truncated ? ', truncated' : ''}]`;
        return { content: `${header}\n${numbered}`, meta: { truncated: file.truncated } };
      }
      case 'write_file':
      case 'edit_file': {
        const change: Change =
          name === 'write_file'
            ? { kind: 'write', content: String(args.content ?? '') }
            : {
                kind: 'edit',
                old: String(args.old ?? ''),
                new: String(args.new ?? ''),
                replaceAll: Boolean(args.replace_all),
              };
        const result = await agentCommands.applyChange(workspace, String(args.path ?? ''), change);
        const verb = result.created ? 'Created' : 'Updated';
        return {
          content: `${verb} ${String(args.path)}.\n${result.diff}`,
          meta: { diff: result.diff },
        };
      }
      case 'search_files': {
        const result = await agentCommands.search(
          workspace,
          String(args.pattern ?? ''),
          args.glob ? String(args.glob) : undefined,
          clamp(Number(args.max_results ?? 100), 1, 500),
        );
        const lines = result.matches.map((m) => `${m.path}:${m.line}: ${m.text}`);
        if (result.truncated) lines.push('… (truncated)');
        return {
          content: lines.length ? lines.join('\n') : '(no match)',
          meta: { truncated: result.truncated },
        };
      }
      case 'run_command': {
        const timeout = clamp(Number(args.timeout_secs ?? s.agentCommandTimeout), 1, 600);
        useAgent.getState().setRunning(toolId);
        try {
          const out = await agentCommands.runCommand(
            toolId,
            workspace,
            String(args.command ?? ''),
            timeout,
          );
          const parts = [
            `exit code: ${out.exitCode ?? 'none'}${out.timedOut ? ' (timed out)' : ''}`,
          ];
          if (out.stdout.trim()) parts.push(`stdout:\n${out.stdout.trimEnd()}`);
          if (out.stderr.trim()) parts.push(`stderr:\n${out.stderr.trimEnd()}`);
          if (out.truncated) parts.push('(output truncated)');
          return {
            content: parts.join('\n'),
            meta: {
              exitCode: out.exitCode,
              timedOut: out.timedOut,
              truncated: out.truncated,
              durationMs: out.durationMs,
            },
          };
        } finally {
          useAgent.getState().setRunning(null);
        }
      }
    }
  } catch (err) {
    const message = errorMessage(err);
    return {
      content: `Error: ${message}`,
      meta: { status: 'error', error: message, durationMs: Date.now() - startedAt },
    };
  }
}

const clamp = (n: number, min: number, max: number): number =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min;

const truncateForModel = (text: string): string =>
  text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (truncated)` : text;

/**
 * Traite les appels d'un message assistant : crée un message `tool` par appel (enchaînés
 * parent → enfant), demande l'approbation si nécessaire, exécute, puis relance le modèle.
 */
export async function runAgentTurn(
  conversation: Conversation,
  assistant: Message,
  calls: ToolCall[],
  continueWith: (parentId: string) => Promise<void>,
): Promise<void> {
  const workspace = conversation.workspace;
  if (!workspace || calls.length === 0) return;
  const agent = useAgent.getState();
  // Les racines autorisées vivent en mémoire côté Rust : on (ré)enregistre le dossier à chaque tour.
  if (!agent.workspaces[conversation.id]) {
    try {
      agent.rememberWorkspace(conversation.id, await agentCommands.registerWorkspace(workspace));
    } catch (err) {
      toast.error(errorMessage(err));
      return;
    }
  }
  const allowlist = useSettings.getState().agentAutoCommands;
  let parentId = assistant.id;

  for (const call of calls) {
    const name = call.name;
    const args = parseToolArgs(call);
    const tool: ToolName | null = isToolName(name) ? name : null;
    const risk = tool ? toolRisk(tool, args, allowlist) : 'write';
    const meta: ToolMeta = { args, status: 'pending', risk };

    const toolMessage = await msgRepo.add({
      conversationId: conversation.id,
      parentId,
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
      toolCalls: null,
      toolCallId: call.id,
      toolName: name,
      toolMeta: meta,
    });
    useChat.getState().upsert(toolMessage);
    parentId = toolMessage.id;

    const finish = async (content: string, patch: Partial<ToolMeta>) => {
      const next: Message = {
        ...toolMessage,
        content: truncateForModel(content),
        toolMeta: { ...meta, ...patch },
      };
      await msgRepo.update(toolMessage.id, {
        content: next.content,
        toolMeta: next.toolMeta ?? null,
      });
      useChat.getState().upsert(next);
    };

    if (useAgent.getState().aborted) {
      await finish(i18n.t('chat.tools.cancelledByUser'), { status: 'cancelled' });
      continue;
    }
    if (!tool) {
      await finish(`Error: unknown tool "${name}".`, { status: 'error', error: 'unknown tool' });
      continue;
    }
    // Arguments incomplets (flux coupé, modèle hésitant) : le modèle est invité à rappeler l'outil.
    const missing = missingArgs(tool, args);
    if (missing.length) {
      await finish(
        `Error: missing required argument(s): ${missing.join(', ')}. Call ${tool} again with all required arguments as JSON.`,
        { status: 'error', error: `missing ${missing.join(', ')}` },
      );
      continue;
    }

    const decision = await agent.requestDecision({
      conversationId: conversation.id,
      toolMessageId: toolMessage.id,
      risk,
      key: approvalKey(tool, args),
    });
    if (decision === 'deny') {
      await finish(
        useAgent.getState().aborted
          ? i18n.t('chat.tools.cancelledByUser')
          : i18n.t('chat.tools.deniedByUser'),
        { status: useAgent.getState().aborted ? 'cancelled' : 'denied' },
      );
      continue;
    }

    useChat.getState().upsert({ ...toolMessage, toolMeta: { ...meta, status: 'running' } });
    const startedAt = Date.now();
    const outcome = await executeTool(workspace, tool, args, toolMessage.id);
    await finish(outcome.content, {
      status: outcome.meta.status ?? 'done',
      durationMs: outcome.meta.durationMs ?? Date.now() - startedAt,
      ...outcome.meta,
    });
    // Le volet Fichiers relit l'arborescence après toute écriture ou commande.
    if (
      outcome.meta.status !== 'error' &&
      tool !== 'read_file' &&
      tool !== 'list_files' &&
      tool !== 'search_files'
    ) {
      useExplorer.getState().refresh();
    }
  }

  if (useAgent.getState().aborted) {
    toast.info(i18n.t('chat.agent.stopped'));
    return;
  }
  if (agent.bumpSteps(conversation.id) >= MAX_AGENT_STEPS) {
    toast.info(i18n.t('chat.agent.stepLimit', { count: MAX_AGENT_STEPS }));
    return;
  }
  await continueWith(parentId);
}

export const newToolId = (): string => newId();
