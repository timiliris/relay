/** Types partagés du mode agent (outils exécutés dans un dossier de travail). */
import type { ToolCall } from '@/lib/openrouter';

export type { ToolCall };

export type ToolName =
  | 'list_files'
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'search_files'
  | 'run_command'
  | 'fetch_url';

export const TOOL_NAMES: readonly ToolName[] = [
  'list_files',
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
  'run_command',
  'fetch_url',
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
  /** Diff unifié d'une écriture ou d'une édition (aperçu en attente, puis résultat). */
  diff?: string;
  /** Écriture ou édition : `true` si le fichier n'existait pas encore. */
  created?: boolean;
  /** Commande : dossier d'exécution (racine du dossier de travail). */
  cwd?: string;
  error?: string;
}

export type ApprovalPolicy = 'ask' | 'autoRead' | 'autoAll';
export type Decision = 'allow' | 'allowAlways' | 'deny';

/** Réponse à une demande d'approbation ; `reason` accompagne éventuellement un refus. */
export interface DecisionResult {
  decision: Decision;
  reason?: string;
}

/** Phase de la boucle d'agent pour l'étape en cours. */
export type AgentPhase = 'pending' | 'running' | 'thinking';

/** Progression de la boucle d'agent (exposée par `useAgent.running`). */
export interface AgentProgress {
  conversationId: string;
  /** Étape (relance du modèle) en cours, à partir de 1. */
  step: number;
  total?: number;
  phase: AgentPhase;
  /** Message `tool` concerné quand un outil attend ou s'exécute. */
  toolMessageId?: string;
  toolName?: ToolName;
}
