/**
 * Mentions `@chemin` dans le composeur : extraction de la mention en cours de saisie,
 * filtrage des chemins du dossier de travail et construction de la pièce jointe texte
 * correspondante. Les fonctions pures sont en tête ; la lecture du dossier (cache par
 * workspace) et du fichier passent par les commandes Rust du mode agent.
 */
import { AttachmentError, MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { type Attachment, newId } from '@/lib/db';
import { devFixturesEnabled } from '@/lib/dev-fixtures';
import { errorMessage } from '@/lib/tauri';
import { agentCommands, type FileContent, type FileEntry } from './commands';

export const MENTION_PREFIX = '@';
/** Lignes conservées d'un fichier joint par mention (le reste est signalé comme tronqué). */
export const MAX_MENTION_LINES = 400;
/** Résultats affichés au plus dans le menu. */
export const MAX_MENTION_RESULTS = 200;
/** Profondeur listée sous le dossier de travail (plafond côté Rust). */
export const MENTION_LIST_DEPTH = 3;

export interface Mention {
  /** Index du `@` dans le texte. */
  start: number;
  /** Position du curseur (fin de la mention). */
  end: number;
  /** Texte tapé après le `@`, sans espace. */
  query: string;
}

const isSpace = (ch: string) => /\s/.test(ch);

/**
 * Mention en cours : un `@` en début de texte ou précédé d'un blanc, suivi d'un texte sans
 * blanc jusqu'au curseur. `tim@example.com` n'en est pas une.
 */
export function activeMention(text: string, cursor: number): Mention | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, end);
  const start = before.lastIndexOf(MENTION_PREFIX);
  if (start === -1) return null;
  if (start > 0 && !isSpace(before.charAt(start - 1))) return null;
  const query = before.slice(start + 1);
  if ([...query].some(isSpace)) return null;
  return { start, end, query };
}

export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * Chemins correspondant à la requête, insensible à la casse : d'abord ceux dont le nom de
 * fichier commence par la requête, puis ceux dont le nom la contient, puis ceux dont le
 * chemin la contient. À rang égal, les chemins courts passent devant.
 */
export function filterPaths(
  paths: readonly string[],
  query: string,
  limit = MAX_MENTION_RESULTS,
): string[] {
  const q = query.toLowerCase();
  if (!q) return paths.slice(0, limit);
  const ranked: { path: string; rank: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const name = basename(lower);
    const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : lower.includes(q) ? 2 : -1;
    if (rank >= 0) ranked.push({ path, rank });
  }
  ranked.sort(
    (a, b) => a.rank - b.rank || a.path.length - b.path.length || a.path.localeCompare(b.path),
  );
  return ranked.slice(0, limit).map((r) => r.path);
}

/** Remplace la mention par `@chemin` suivi d'un espace ; renvoie le texte et le curseur. */
export function applyMention(
  text: string,
  mention: Mention,
  path: string,
): { text: string; cursor: number } {
  const after = text.slice(mention.end);
  const trailing = after.length === 0 || !isSpace(after.charAt(0)) ? ' ' : '';
  const inserted = `${MENTION_PREFIX}${path}${trailing}`;
  return {
    text: `${text.slice(0, mention.start)}${inserted}${after}`,
    cursor: mention.start + inserted.length,
  };
}

/** Pièce jointe texte depuis une lecture Rust ; la troncature est signalée dans le contenu. */
export function attachmentFromFileContent(path: string, file: FileContent): Attachment {
  const shown = file.content === '' ? 0 : file.content.split('\n').length;
  const text = file.truncated
    ? `${file.content}\n\n[Tronqué : ${shown} lignes affichées sur ${file.totalLines}]`
    : file.content;
  return {
    id: newId(),
    kind: 'text',
    name: path,
    mime: 'text/plain',
    size: new TextEncoder().encode(text).byteLength,
    text,
  };
}

// --- Accès au dossier de travail ---------------------------------------------------------

interface CachedList {
  version: number;
  entries: Promise<FileEntry[]>;
}

const cache = new Map<string, CachedList>();

/**
 * Fichiers du dossier de travail sur `MENTION_LIST_DEPTH` niveaux, mis en cache par
 * workspace. `version` (compteur du volet Fichiers) invalide le cache après une écriture.
 */
export function listWorkspaceFiles(workspace: string, version = 0): Promise<FileEntry[]> {
  const cached = cache.get(workspace);
  if (cached && cached.version === version) return cached.entries;
  const entries = devFixturesEnabled()
    ? Promise.resolve(demoEntries)
    : agentCommands
        .listFiles(workspace, '.', MENTION_LIST_DEPTH)
        .then((result) => result.entries.filter((e) => e.kind === 'file'));
  // Une liste en échec n'est pas conservée : la prochaine mention réessaie.
  entries.catch(() => cache.delete(workspace));
  cache.set(workspace, { version, entries });
  return entries;
}

export function invalidateWorkspaceFiles(workspace?: string): void {
  if (workspace === undefined) cache.clear();
  else cache.delete(workspace);
}

/**
 * Lit un fichier du dossier de travail comme pièce jointe texte (400 lignes au plus).
 * Lève `AttachmentError` : `too_large` d'après la taille connue, `unsupported` pour un binaire.
 */
export async function readWorkspaceAttachment(
  workspace: string,
  path: string,
  size?: number | null,
): Promise<Attachment> {
  if (size != null && size > MAX_ATTACHMENT_BYTES) throw new AttachmentError('too_large', path);
  if (devFixturesEnabled()) return attachmentFromFileContent(path, demoContent(path));
  try {
    const content = await agentCommands.readFile(workspace, path, 1, MAX_MENTION_LINES);
    return attachmentFromFileContent(path, content);
  } catch (err) {
    if (/binary/i.test(errorMessage(err))) throw new AttachmentError('unsupported', path);
    throw err;
  }
}

// --- Fichiers fictifs pour `pnpm dev` dans un navigateur (hors Tauri) ---------------------

const demoEntries: FileEntry[] = [
  'README.md',
  'package.json',
  'src/main.tsx',
  'src/App.tsx',
  'src/components/composer.tsx',
  'src/components/message-bubble.tsx',
  'src/lib/attachments.ts',
  'src/lib/db.ts',
  'src-tauri/src/main.rs',
  'src-tauri/icons/icon.png',
].map((path, i) => ({ path, kind: 'file', size: path.endsWith('.png') ? 48_210 : 320 + i * 97 }));

function demoContent(path: string): FileContent {
  if (path.endsWith('.png')) throw new AttachmentError('unsupported', path);
  const lines = Array.from({ length: 12 }, (_, i) => `// ${path} — ligne ${i + 1}`);
  return { content: lines.join('\n'), totalLines: 12, truncated: false };
}
