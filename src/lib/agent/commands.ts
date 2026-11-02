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
