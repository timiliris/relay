/**
 * Wrappers typés des commandes Rust du mode agent (`src-tauri/src/commands/agent.rs`).
 * Tout chemin est relatif au dossier de travail enregistré ; Rust refuse ce qui en sort.
 */
import { invoke } from '@tauri-apps/api/core';

export interface WorkspaceInfo {
  root: string;
  name: string;
  git: boolean;
}

export interface FileEntry {
  path: string;
  kind: 'file' | 'dir';
  size: number | null;
}

export interface ListResult {
  entries: FileEntry[];
  truncated: boolean;
}

export interface FileContent {
  content: string;
  totalLines: number;
  truncated: boolean;
}

export type Change =
  | { kind: 'write'; content: string }
  | { kind: 'edit'; old: string; new: string; replaceAll: boolean };

export interface ChangePreview {
  diff: string;
  exists: boolean;
  created: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
}

export interface CommandOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export const agentCommands = {
  registerWorkspace: (path: string) => invoke<WorkspaceInfo>('register_workspace', { path }),
  listFiles: (workspace: string, path: string, depth: number) =>
    invoke<ListResult>('tool_list_files', { workspace, path, depth }),
  readFile: (workspace: string, path: string, offset?: number, limit?: number) =>
    invoke<FileContent>('tool_read_file', { workspace, path, offset, limit }),
  previewChange: (workspace: string, path: string, change: Change) =>
    invoke<ChangePreview>('tool_preview_change', { workspace, path, change }),
  applyChange: (workspace: string, path: string, change: Change) =>
    invoke<ChangePreview>('tool_apply_change', { workspace, path, change }),
  search: (workspace: string, pattern: string, glob: string | undefined, maxResults: number) =>
    invoke<SearchResult>('tool_search', { workspace, pattern, glob, maxResults }),
  runCommand: (id: string, workspace: string, command: string, timeoutSecs: number) =>
    invoke<CommandOutput>('tool_run_command', { id, workspace, command, timeoutSecs }),
  cancelTool: (id: string) => invoke<void>('cancel_tool', { id }),
} as const;

// ---- Panneau Git du dossier de travail (`git.rs`) ----

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

export interface GitFile {
  /** Chemin relatif au dossier de travail, séparateurs `/`. */
  path: string;
  status: GitFileStatus;
  /** `true` : entrée de l'index ; `false` : modification de l'arbre de travail. */
  staged: boolean;
  origPath: string | null;
}

export interface GitStatus {
  /** Nom de la branche, ou hash court en tête détachée. */
  branch: string;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
}

export interface GitDiff {
  diff: string;
  truncated: boolean;
}

export interface GitCommit {
  hash: string;
  summary: string;
}

export interface GitLogEntry {
  hash: string;
  short: string;
  subject: string;
  author: string;
  /** ISO 8601. */
  date: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export const gitCommands = {
  status: (workspace: string) => invoke<GitStatus>('git_status', { workspace }),
  diff: (workspace: string, path: string | undefined, staged: boolean) =>
    invoke<GitDiff>('git_diff', { workspace, path, staged }),
  stage: (workspace: string, paths: string[], stage: boolean) =>
    invoke<void>('git_stage', { workspace, paths, stage }),
  commit: (workspace: string, message: string) =>
    invoke<GitCommit>('git_commit', { workspace, message }),
  log: (workspace: string, limit: number) => invoke<GitLogEntry[]>('git_log', { workspace, limit }),
  branches: (workspace: string) => invoke<GitBranch[]>('git_branches', { workspace }),
  checkout: (workspace: string, branch: string) =>
    invoke<void>('git_checkout', { workspace, branch }),
  init: (workspace: string) => invoke<void>('git_init', { workspace }),
} as const;

/** Rectangle en pixels CSS (logiques), relatif à la zone cliente de la fenêtre principale. */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Charge utile de l'événement `browser://navigated` ; `title` arrive dans un second événement. */
export interface BrowserNavigated {
  url: string;
  title: string | null;
}

/** Résultat de `fetch_url` : page publique convertie en texte pour le modèle. */
export interface PageText {
  /** URL finale, après redirections. */
  url: string;
  title: string | null;
  text: string;
  truncated: boolean;
}

export const BROWSER_NAVIGATED_EVENT = 'browser://navigated';

/** Navigateur intégré (`src-tauri/src/commands/browser.rs`) : webview enfant de la fenêtre principale. */
export const browserCommands = {
  open: (url: string, bounds?: BrowserBounds) => invoke<void>('browser_open', { url, bounds }),
  navigate: (url: string) => invoke<void>('browser_navigate', { url }),
  back: () => invoke<void>('browser_back'),
  forward: () => invoke<void>('browser_forward'),
  reload: () => invoke<void>('browser_reload'),
  setBounds: (bounds: BrowserBounds) => invoke<void>('browser_set_bounds', { ...bounds }),
  close: () => invoke<void>('browser_close'),
  fetchUrl: (url: string, maxChars?: number) => invoke<PageText>('fetch_url', { url, maxChars }),
} as const;
