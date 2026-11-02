/**
 * Volet « Git » du dossier de travail : ouverture et cache par conversation (status, journal,
 * branches), rechargé à la demande et à chaque écriture de l'agent (`useExplorer.version`).
 */
import { create } from 'zustand';
import {
  type GitBranch,
  type GitFile,
  type GitLogEntry,
  type GitStatus,
  gitCommands,
} from '@/lib/agent/commands';
import { errorMessage, isAppError, isTauri } from '@/lib/tauri';

/** Commits affichés dans l'historique. */
export const LOG_LIMIT = 20;

export interface GitSnapshot {
  /** `false` quand le dossier n'est pas un dépôt (proposer `git init`). */
  repo: boolean;
  status: GitStatus | null;
  log: GitLogEntry[];
  branches: GitBranch[];
  loading: boolean;
  error: string | null;
}

export interface GitGroups {
  staged: GitFile[];
  changes: GitFile[];
  untracked: GitFile[];
}

const EMPTY: GitSnapshot = {
  repo: true,
  status: null,
  log: [],
  branches: [],
  loading: false,
  error: null,
};

/** Regroupe les fichiers du status : indexés, modifications de l'arbre de travail, non suivis. */
export function groupFiles(files: GitFile[]): GitGroups {
  const byPath = (a: GitFile, b: GitFile) => a.path.localeCompare(b.path);
  return {
    staged: files.filter((f) => f.staged).sort(byPath),
    changes: files.filter((f) => !f.staged && f.status !== 'untracked').sort(byPath),
    untracked: files.filter((f) => !f.staged && f.status === 'untracked').sort(byPath),
  };
}

const isNotRepo = (err: unknown) => isAppError(err) && err.code === 'git_not_repo';

interface GitState {
  open: boolean;
  snapshots: Record<string, GitSnapshot>;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  /** Recharge status, journal et branches ; hors Tauri, ne fait rien. */
  refresh: (conversationId: string, workspace: string) => Promise<void>;
  stage: (
    conversationId: string,
    workspace: string,
    paths: string[],
    stage: boolean,
  ) => Promise<void>;
  commit: (conversationId: string, workspace: string, message: string) => Promise<string>;
  checkout: (conversationId: string, workspace: string, branch: string) => Promise<void>;
  init: (conversationId: string, workspace: string) => Promise<void>;
}

export const useGit = create<GitState>()((set, get) => {
  const patch = (conversationId: string, part: Partial<GitSnapshot>) =>
    set((s) => ({
      snapshots: {
        ...s.snapshots,
        [conversationId]: { ...(s.snapshots[conversationId] ?? EMPTY), ...part },
      },
    }));

  return {
    open: false,
    snapshots: {},
    toggle: () => set((s) => ({ open: !s.open })),
    setOpen: (open) => set({ open }),

    async refresh(conversationId, workspace) {
      if (!isTauri()) return;
      patch(conversationId, { loading: true });
      try {
        const [status, log, branches] = await Promise.all([
          gitCommands.status(workspace),
          gitCommands.log(workspace, LOG_LIMIT),
          gitCommands.branches(workspace),
        ]);
        patch(conversationId, { repo: true, status, log, branches, loading: false, error: null });
      } catch (err) {
        if (isNotRepo(err)) {
          patch(conversationId, {
            repo: false,
            status: null,
            log: [],
            branches: [],
            loading: false,
            error: null,
          });
        } else {
          patch(conversationId, { loading: false, error: errorMessage(err) });
        }
      }
    },

    async stage(conversationId, workspace, paths, stage) {
      await gitCommands.stage(workspace, paths, stage);
      await get().refresh(conversationId, workspace);
    },

    async commit(conversationId, workspace, message) {
      const result = await gitCommands.commit(workspace, message);
      await get().refresh(conversationId, workspace);
      return result.summary;
    },

    async checkout(conversationId, workspace, branch) {
      await gitCommands.checkout(workspace, branch);
      await get().refresh(conversationId, workspace);
    },

    async init(conversationId, workspace) {
      await gitCommands.init(workspace);
      await get().refresh(conversationId, workspace);
    },
  };
});

/** Instantané de démonstration (navigateur, `pnpm dev`) pour travailler l'interface sans Rust. */
export const demoSnapshot = (): GitSnapshot => ({
  repo: true,
  loading: false,
  error: null,
  status: {
    branch: 'feat/git-panel',
    detached: false,
    upstream: 'origin/feat/git-panel',
    ahead: 2,
    behind: 1,
    files: [
      { path: 'src/components/git-panel.tsx', status: 'added', staged: true, origPath: null },
      { path: 'src/stores/git.ts', status: 'added', staged: true, origPath: null },
      {
        path: 'src/lib/agent/commands.ts',
        status: 'modified',
        staged: true,
        origPath: null,
      },
      { path: 'src/pages/chat.tsx', status: 'modified', staged: false, origPath: null },
      { path: 'src/i18n/locales/fr.json', status: 'modified', staged: false, origPath: null },
      { path: 'docs/old-notes.md', status: 'deleted', staged: false, origPath: null },
      {
        path: 'src/lib/git-utils.ts',
        status: 'renamed',
        staged: true,
        origPath: 'src/lib/git.ts',
      },
      { path: 'notes.md', status: 'untracked', staged: false, origPath: null },
      { path: 'src/stores/git.test.ts', status: 'untracked', staged: false, origPath: null },
    ],
  },
  log: [
    {
      hash: 'e1f9f96a',
      short: 'e1f9f96',
      subject: 'docs: release 0.9.0',
      author: 'Timiliris',
      date: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      hash: 'f41c5c7b',
      short: 'f41c5c7',
      subject: 'chore(main): release 0.9.0 (#18)',
      author: 'github-actions',
      date: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    },
    {
      hash: '74130b8c',
      short: '74130b8',
      subject: "feat(agent): volet Fichiers du dossier de travail et appels d'outils incomplets",
      author: 'Timiliris',
      date: new Date(Date.now() - 86_400_000).toISOString(),
    },
    {
      hash: '0550e78d',
      short: '0550e78',
      subject: 'docs: release 0.8.0',
      author: 'Timiliris',
      date: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    },
  ],
  branches: [
    { name: 'main', current: false },
    { name: 'feat/git-panel', current: true },
    { name: 'fix/composer-focus', current: false },
  ],
});

/** Diff de démonstration pour le navigateur. */
export const demoDiff = (path: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -12,7 +12,9 @@ export function Panel() {',
    '  const { t } = useTranslation();',
    '-  const open = false;',
    '+  const open = useGit((s) => s.open);',
    '+  const toggle = useGit((s) => s.toggle);',
    '   return (',
    '     <aside className="flex w-80 shrink-0 flex-col border-l">',
    '-      <header>{t("chat.explorer.title")}</header>',
    '+      <header>{t("chat.git.title")}</header>',
    '     </aside>',
    '   );',
    ' }',
  ].join('\n');
