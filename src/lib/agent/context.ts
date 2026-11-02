/**
 * Contexte de projet injecté au début d'une conversation en mode agent : arborescence compacte,
 * instructions du projet (`AGENTS.md`…), manifestes, début du README et outillage détecté.
 * Tout passe par `agentCommands` (chemins confinés au dossier de travail) ; le bloc est en
 * anglais puisqu'il s'adresse au modèle, et plafonné à ~2 500 tokens.
 */
import { CHARS_PER_TOKEN, estimateTokens } from '../context';
import { agentCommands, type FileEntry } from './commands';

export interface ProjectContext {
  workspace: string;
  /** Bloc prêt à être ajouté à l'instruction système ; `""` si rien n'a pu être lu. */
  text: string;
  /** Nom du fichier d'instructions trouvé à la racine (`AGENTS.md`…), sinon `null`. */
  instructionsFile: string | null;
  packageManager: PackageManager | null;
  git: boolean;
  tokens: number;
}

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

export const MAX_CONTEXT_TOKENS = 2_500;
export const MAX_TREE_LINES = 60;
export const MAX_INSTRUCTIONS_CHARS = 6_000;
export const README_LINES = 30;
/** Fichiers d'instructions reconnus à la racine, par ordre de préférence. */
export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'RELAY.md'] as const;

const LOCKFILES: Array<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];
const MANIFESTS = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'composer.json'];
const MAX_MANIFESTS = 6;
const TRUNCATED = '… (truncated)';

export async function buildProjectContext(workspace: string): Promise<ProjectContext> {
  const entries = await listRoot(workspace);
  const topLevel = entries.filter((e) => !e.path.includes('/'));
  const names = new Set(topLevel.map((e) => e.path));

  const packageManager = LOCKFILES.find(([file]) => names.has(file))?.[1] ?? null;
  const [git, instructions, manifests, readme] = await Promise.all([
    detectGit(workspace),
    readInstructions(workspace, names),
    summarizeManifests(workspace, entries),
    readReadme(workspace, topLevel),
  ]);

  const tools = [
    git ? 'Git repository' : 'not a Git repository',
    packageManager ? `package manager: ${packageManager}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const sections: string[] = [
    `Project context:\nWorkspace "${basename(workspace)}" (${tools}).`,
    `Files (2 levels, folders show their entry count):\n${compactTree(entries)}`,
  ];
  if (manifests.length) sections.push(`Manifests:\n${manifests.join('\n')}`);
  if (instructions)
    sections.push(
      `Project instructions (${instructions.file}, follow them):\n${instructions.text}`,
    );
  if (readme) sections.push(`README (first ${README_LINES} lines):\n${readme}`);

  const text = capTokens(sections.join('\n\n'), MAX_CONTEXT_TOKENS);
  return {
    workspace,
    text,
    instructionsFile: instructions?.file ?? null,
    packageManager,
    git,
    tokens: estimateTokens(text),
  };
}

async function listRoot(workspace: string): Promise<FileEntry[]> {
  try {
    return (await agentCommands.listFiles(workspace, '.', 2)).entries;
  } catch {
    return [];
  }
}

/** `.git` n'est jamais listé par Rust : on sonde `HEAD` (dépôt) puis le fichier `.git` (worktree). */
async function detectGit(workspace: string): Promise<boolean> {
  for (const probe of ['.git/HEAD', '.git']) {
    try {
      await agentCommands.readFile(workspace, probe, 1, 1);
      return true;
    } catch {
      // Absent ou illisible : on essaie la sonde suivante.
    }
  }
  return false;
}

/**
 * Arborescence compactée : dossiers de premier niveau avec leur nombre d'entrées directes,
 * puis fichiers de premier niveau, plafonnée à `MAX_TREE_LINES` lignes.
 */
export function compactTree(entries: FileEntry[]): string {
  if (!entries.length) return '(empty folder)';
  const counts = new Map<string, number>();
  const dirs: string[] = [];
  const files: string[] = [];
  for (const e of entries) {
    const slash = e.path.indexOf('/');
    if (slash === -1) {
      if (e.kind === 'dir') {
        dirs.push(e.path);
        counts.set(e.path, counts.get(e.path) ?? 0);
      } else files.push(e.path);
      continue;
    }
    const parent = e.path.slice(0, slash);
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  const lines = [...dirs.map((d) => `${d}/ (${counts.get(d) ?? 0})`), ...files];
  if (lines.length <= MAX_TREE_LINES) return lines.join('\n');
  const hidden = lines.length - (MAX_TREE_LINES - 1);
  return [...lines.slice(0, MAX_TREE_LINES - 1), `… ${hidden} more entries`].join('\n');
}

async function readInstructions(
  workspace: string,
  names: Set<string>,
): Promise<{ file: string; text: string } | null> {
  const file = INSTRUCTION_FILES.find((f) => names.has(f));
  if (!file) return null;
  const content = await readText(workspace, file);
  if (content === null) return null;
  return { file, text: truncateChars(content.trim(), MAX_INSTRUCTIONS_CHARS) };
}

/** Manifestes à deux niveaux de profondeur au plus (ex. : `src-tauri/Cargo.toml`). */
async function summarizeManifests(workspace: string, entries: FileEntry[]): Promise<string[]> {
  const found = entries
    .filter((e) => e.kind === 'file' && MANIFESTS.includes(e.path.split('/').pop() ?? ''))
    .sort((a, b) => depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_MANIFESTS);
  const lines = await Promise.all(
    found.map(async (e) => {
      const content = await readText(workspace, e.path);
      return content === null ? null : `- ${e.path}: ${summarizeManifest(e.path, content)}`;
    }),
  );
  return lines.filter((l): l is string => l !== null);
}

export function summarizeManifest(path: string, content: string): string {
  const file = path.split('/').pop() ?? path;
  switch (file) {
    case 'package.json':
    case 'composer.json': {
      const json = parseJson(content);
      const name = typeof json.name === 'string' ? json.name : '(unnamed)';
      const scripts =
        json.scripts && typeof json.scripts === 'object'
          ? Object.keys(json.scripts as Record<string, unknown>)
          : [];
      return scripts.length ? `${name} — scripts: ${scripts.join(', ')}` : name;
    }
    case 'Cargo.toml':
    case 'pyproject.toml': {
      const name = tomlValue(content, 'name') ?? '(unnamed)';
      const version = tomlValue(content, 'version');
      return version ? `${name} ${version}` : name;
    }
    case 'go.mod':
      return /^module\s+(\S+)/m.exec(content)?.[1] ?? '(unnamed)';
    default:
      return '';
  }
}

async function readReadme(workspace: string, topLevel: FileEntry[]): Promise<string | null> {
  const readme = topLevel.find((e) => e.kind === 'file' && /^readme(\.|$)/i.test(e.path));
  if (!readme) return null;
  try {
    const file = await agentCommands.readFile(workspace, readme.path, 1, README_LINES);
    const text = file.content.trimEnd();
    return file.truncated ? `${text}\n${TRUNCATED}` : text;
  } catch {
    return null;
  }
}

/** Coupe le texte à la dernière fin de ligne sous le plafond de tokens, avec marqueur. */
export function capTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const budget = Math.floor(maxTokens * CHARS_PER_TOKEN) - TRUNCATED.length - 1;
  return `${cutAtLine(text, budget)}\n${TRUNCATED}`;
}

function truncateChars(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${cutAtLine(text, max - TRUNCATED.length - 1)}\n${TRUNCATED}`;
}

function cutAtLine(text: string, max: number): string {
  const head = text.slice(0, Math.max(0, max));
  const lastBreak = head.lastIndexOf('\n');
  return (lastBreak > max / 2 ? head.slice(0, lastBreak) : head).trimEnd();
}

async function readText(workspace: string, path: string): Promise<string | null> {
  try {
    return (await agentCommands.readFile(workspace, path)).content;
  } catch {
    return null;
  }
}

function parseJson(content: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(content);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Première clé `name = "…"` (ou `version`) rencontrée dans un TOML, sections `[package]`/`[project]` incluses. */
function tomlValue(content: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm');
  return re.exec(content)?.[1] ?? null;
}

const depthOf = (path: string): number => path.split('/').length;

function basename(workspace: string): string {
  const parts = workspace.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || workspace;
}
