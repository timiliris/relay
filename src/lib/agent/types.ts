/** Types partagés du mode agent (outils exécutés dans un dossier de travail). */
import type { ToolCall } from '@/lib/openrouter';

export type { ToolCall };

export type ToolName =
  | 'list_files'
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'search_files'
  | 'run_command';

export const TOOL_NAMES: readonly ToolName[] = [
  'list_files',
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
  'run_command',
];

export const isToolName = (name: string): name is ToolName =>
  (TOOL_NAMES as readonly string[]).includes(name);

export type ToolStatus = 'pending' | 'running' | 'done' | 'denied' | 'error' | 'cancelled';

/** `read` : n'altère rien ; `write` : modifie des fichiers ou exécute une commande non listée. */
export type ToolRisk = 'read' | 'write';

/** Métadonnées d'un appel d'outil, stockées en JSON sur le message `tool` (colonne `tool_meta`). */
export interface ToolMeta {
  args: Record<string, unknown>;
  status: ToolStatus;
  risk: ToolRisk;
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
  truncated?: boolean;
  /** Diff unifié d'une écriture ou d'une édition. */
  diff?: string;
  error?: string;
}

export type ApprovalPolicy = 'ask' | 'autoRead' | 'autoAll';
export type Decision = 'allow' | 'allowAlways' | 'deny';
