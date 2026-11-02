/**
 * Boucle d'agent : exécute les appels d'outils demandés par le modèle (un message `tool` par
 * appel, approbation éventuelle, commande Rust), puis rend la main à `continueWith` pour que le
 * modèle poursuive avec les résultats.
 */
import { info } from '@tauri-apps/plugin-log';
import { platform } from '@tauri-apps/plugin-os';
import i18n from '@/i18n';
import { useAgent } from '@/stores/agent';
import { useChat } from '@/stores/chat';
import { useExplorer } from '@/stores/explorer';
import { useProcesses } from '@/stores/processes';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { type Conversation, type Message, messages as msgRepo, newId } from '../db';
import { errorMessage, isTauri } from '../tauri';
import { executeBrowserTool } from './browser-tools';
import { agentCommands, type Change, type CommandOutput } from './commands';
import { approvalKey, missingArgs, parseToolArgs, toolRisk } from './tools';
import {
  type AgentProgress,
  isBrowserTool,
  isToolName,
  type ToolCall,
  type ToolMeta,
  type ToolName,
} from './types';
import { executeWebTool } from './web-tools';

/** Appels d'outils par tour utilisateur avant arrêt de sécurité. */
export const MAX_AGENT_STEPS = 25;
/** Taille maximale du résultat renvoyé au modèle (le détail complet reste dans `toolMeta`). */
const MAX_RESULT_CHARS = 30_000;

export const osName = (): string => (isTauri() ? platform() : 'web');

/** Une ligne par appel d'outil dans le journal de l'app, pour pouvoir analyser un tour après coup. */
function logTool(name: string, meta: ToolMeta, resultChars: number): void {
  if (!isTauri() || meta.status === 'pending' || meta.status === 'running') return;
  const parts = [`[agent] ${name} ${meta.status}`];
  if (meta.durationMs !== undefined) parts.push(`${meta.durationMs} ms`);
  if (meta.exitCode !== undefined && meta.exitCode !== null) parts.push(`exit ${meta.exitCode}`);
  if (meta.timedOut) parts.push('timed out');
  if (meta.error) parts.push(`error: ${meta.error}`);
  parts.push(`result ${resultChars} chars`);
  void info(parts.join(' · ')).catch(() => {});
}

export const agentEnabled = (conversation: Conversation): boolean =>
  Boolean(conversation.agent && conversation.workspace);

interface ToolOutcome {
  content: string;
  meta: Partial<ToolMeta>;
}

/**
 * Exécute un outil dans le dossier de travail ; les erreurs Rust deviennent un résultat `error`.
 * `conversationId` rattache une commande au volet Processus.
 */
export async function executeTool(
  workspace: string,
  name: ToolName,
  args: Record<string, unknown>,
  toolId: string,
  conversationId = '',
): Promise<ToolOutcome> {
  const s = useSettings.getState();
  const startedAt = Date.now();
  try {
    switch (name) {
      case 'fetch_url':
        return await executeWebTool(name, args);
      case 'browser_navigate':
      case 'browser_read':
      case 'browser_click':
      case 'browser_type':
      case 'browser_eval':
        return await executeBrowserTool(name, args, workspace);
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
        const result = await agentCommands.applyChange(
          workspace,
          String(args.path ?? ''),
          changeOf(name, args),
        );
        // Un fichier créé : le modèle vient d'en dicter le contenu, le diff complet ne sert
        // qu'à l'interface (il resterait sinon deux fois dans le contexte de chaque tour).
        const content = result.created
          ? `Created ${String(args.path)} (${String(args.content ?? '').split('\n').length} lines).`
          : `Updated ${String(args.path)}.\n${result.diff}`;
        return { content, meta: { diff: result.diff, created: result.created } };
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
        const command = String(args.command ?? '');
        const background = Boolean(args.background);
        const processes = useProcesses.getState();
        useAgent.getState().setRunning(toolId);
        processes.track({ id: toolId, conversationId, command, cwd: workspace, background });
        try {
          await processes.ensureListening();
          const out = await agentCommands.runCommand(
            toolId,
            workspace,
            command,
            timeout,
            background,
          );
          processes.settle(toolId, out);
          return { content: commandResult(toolId, out), meta: commandMeta(out) };
        } catch (err) {
          processes.fail(toolId, errorMessage(err));
          throw err;
        } finally {
          useAgent.getState().setRunning(null);
        }
      }
      case 'list_processes': {
        const list = await agentCommands.listProcesses();
        for (const info of list) useProcesses.getState().sync(info);
        const lines = list.map(
          (p) =>
            `${p.id}  pid=${p.pid ?? '-'}  ${p.status}${p.exitCode !== null ? ` (exit ${p.exitCode})` : ''}${p.background ? '  background' : ''}  ${p.command}`,
        );
        return { content: lines.length ? lines.join('\n') : '(no process)', meta: {} };
      }
      case 'read_process_output': {
        const out = await agentCommands.readProcessOutput(String(args.id ?? ''));
        useProcesses.getState().sync(out.info);
        const lines = clamp(Number(args.lines ?? 100), 1, 2000);
        const parts = [
          `status: ${out.info.status}${out.info.exitCode !== null ? ` (exit ${out.info.exitCode})` : ''}, pid ${out.info.pid ?? '-'}`,
        ];
        if (out.stdout.trim()) parts.push(`stdout:\n${lastLines(out.stdout, lines)}`);
        if (out.stderr.trim()) parts.push(`stderr:\n${lastLines(out.stderr, lines)}`);
        if (out.truncated) parts.push('(older output dropped)');
        return { content: parts.join('\n'), meta: { exitCode: out.info.exitCode } };
      }
      case 'stop_process': {
        const info = await agentCommands.stopProcess(String(args.id ?? ''));
        useProcesses.getState().sync(info);
        return {
          content: `Process ${info.id} (pid ${info.pid ?? '-'}) ${info.status}${info.exitCode !== null ? `, exit code ${info.exitCode}` : ''}.`,
          meta: { exitCode: info.exitCode },
        };
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

/** Modification demandée par `write_file` (contenu complet) ou `edit_file` (remplacement exact). */
export const changeOf = (
  name: 'write_file' | 'edit_file',
  args: Record<string, unknown>,
): Change =>
  name === 'write_file'
    ? { kind: 'write', content: String(args.content ?? '') }
    : {
        kind: 'edit',
        old: String(args.old ?? ''),
        new: String(args.new ?? ''),
        replaceAll: Boolean(args.replace_all),
      };

/** Texte renvoyé au modèle pour une commande (ou les premières lignes d'un arrière-plan). */
function commandResult(id: string, out: CommandOutput): string {
  const parts = out.running
    ? [
        `Started in background: process id ${id}, pid ${out.pid ?? 'unknown'}. Use read_process_output("${id}") to read its output and stop_process("${id}") to stop it.`,
      ]
    : [
        `exit code: ${out.exitCode ?? 'none'}${out.timedOut ? ' (timed out)' : killed(out) ? ' (killed)' : ''}`,
      ];
  if (out.stdout.trim()) parts.push(`stdout:\n${out.stdout.trimEnd()}`);
  if (out.stderr.trim()) parts.push(`stderr:\n${out.stderr.trimEnd()}`);
  if (out.truncated) parts.push('(output truncated)');
  return parts.join('\n');
}

/** Commande au premier plan tuée (bouton Arrêter, arrêt de l'agent) : ni code ni délai dépassé. */
const killed = (out: CommandOutput): boolean =>
  !out.running && out.exitCode === null && !out.timedOut;

const commandMeta = (out: CommandOutput): Partial<ToolMeta> => ({
  exitCode: out.exitCode,
  timedOut: out.timedOut,
  truncated: out.truncated,
  durationMs: out.durationMs,
  pid: out.pid,
  background: out.background,
  ...(killed(out) ? { status: 'cancelled' as const } : {}),
});

const lastLines = (text: string, count: number): string =>
  text.trimEnd().split('\n').slice(-count).join('\n');

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
  const step = (agent.steps[conversation.id] ?? 0) + 1;
  const progress = (patch: Partial<AgentProgress>) =>
    agent.setProgress({
      conversationId: conversation.id,
      step,
      total: MAX_AGENT_STEPS,
      phase: 'thinking',
      ...patch,
    });
  /** Efface la progression si elle concerne encore cette conversation. */
  const clearProgress = () => {
    if (useAgent.getState().running?.conversationId === conversation.id) agent.setProgress(null);
  };

  for (const call of calls) {
    const name = call.name;
    const args = parseToolArgs(call);
    const tool: ToolName | null = isToolName(name) ? name : null;
    const risk = tool ? toolRisk(tool, args, allowlist) : 'write';
    let meta: ToolMeta = { args, status: 'pending', risk };
    if (tool === 'run_command') meta.cwd = workspace;

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

    progress({
      phase: 'pending',
      toolMessageId: toolMessage.id,
      ...(tool ? { toolName: tool } : {}),
    });

    /** Persiste contenu et métadonnées du message `tool` (aperçu, puis résultat). */
    const finish = async (content: string, patch: Partial<ToolMeta>) => {
      meta = { ...meta, ...patch };
      logTool(name, meta, content.length);
      const next: Message = { ...toolMessage, content: truncateForModel(content), toolMeta: meta };
      await msgRepo.update(toolMessage.id, { content: next.content, toolMeta: meta });
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

    const key = approvalKey(tool, args);
    // Écriture soumise à approbation : la carte montre d'abord ce qui va changer. Un aperçu
    // impossible (ancre absente ou ambiguë, chemin refusé) revient au modèle sans question.
    if (
      (tool === 'write_file' || tool === 'edit_file') &&
      agent.willAsk({ conversationId: conversation.id, risk, key })
    ) {
      try {
        const preview = await agentCommands.previewChange(
          workspace,
          String(args.path ?? ''),
          changeOf(tool, args),
        );
        await finish('', { diff: preview.diff, created: preview.created });
      } catch (err) {
        const message = errorMessage(err);
        await finish(`Error: ${message}`, { status: 'error', error: message });
        continue;
      }
    }

    const { decision, reason } = await agent.requestDecision({
      conversationId: conversation.id,
      toolMessageId: toolMessage.id,
      risk,
      key,
    });
    if (decision === 'deny') {
      const aborted = useAgent.getState().aborted;
      await finish(
        aborted
          ? i18n.t('chat.tools.cancelledByUser')
          : reason
            ? i18n.t('chat.toolsPreview.deniedWithReason', { reason })
            : i18n.t('chat.tools.deniedByUser'),
        { status: aborted ? 'cancelled' : 'denied' },
      );
      continue;
    }

    progress({ phase: 'running', toolMessageId: toolMessage.id, toolName: tool });
    useChat.getState().upsert({ ...toolMessage, toolMeta: { ...meta, status: 'running' } });
    const startedAt = Date.now();
    const outcome = await executeTool(workspace, tool, args, toolMessage.id, conversation.id);
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
      tool !== 'search_files' &&
      tool !== 'list_processes' &&
      tool !== 'read_process_output' &&
      !isBrowserTool(tool)
    ) {
      useExplorer.getState().refresh();
    }
  }

  if (useAgent.getState().aborted) {
    clearProgress();
    toast.info(i18n.t('chat.agent.stopped'));
    return;
  }
  if (agent.bumpSteps(conversation.id) >= MAX_AGENT_STEPS) {
    clearProgress();
    toast.info(i18n.t('chat.agent.stepLimit', { count: MAX_AGENT_STEPS }));
    return;
  }
  // Le modèle reprend la main ; `continueWith` ne rend la main qu'une fois toute la suite terminée.
  progress({ phase: 'thinking', step: step + 1 });
  try {
    await continueWith(parentId);
  } finally {
    clearProgress();
  }
}

export const newToolId = (): string => newId();
