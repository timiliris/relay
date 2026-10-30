/**
 * Pièces jointes : lecture des fichiers (sélecteur, glisser-déposer, collage),
 * limites, et conversion en parties de message pour l'API.
 */
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import type { Attachment } from './db';
import { newId } from './db';
import type { ContentPart } from './openrouter';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;

const IMAGE_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const TEXT_EXT = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'tsv',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'log',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'rs',
  'go',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'rb',
  'php',
  'swift',
  'sh',
  'bash',
  'ps1',
  'sql',
  'html',
  'css',
  'scss',
  'vue',
  'svelte',
]);

export const acceptedExtensions = [...Object.keys(IMAGE_EXT), 'pdf', ...TEXT_EXT];

export class AttachmentError extends Error {
  readonly code: 'too_large' | 'unsupported';
  readonly fileName: string;

  constructor(code: 'too_large' | 'unsupported', fileName: string) {
    super(`${code}: ${fileName}`);
    this.code = code;
    this.fileName = fileName;
  }
}

function extension(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase();
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Construit une pièce jointe depuis des octets, selon l'extension du nom. */
export function attachmentFromBytes(
  name: string,
  bytes: Uint8Array,
  mimeHint?: string,
): Attachment {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentError('too_large', name);
  const ext = extension(name);
  const base = { id: newId(), name, size: bytes.byteLength };

  if (IMAGE_EXT[ext] || mimeHint?.startsWith('image/')) {
    const mime = IMAGE_EXT[ext] ?? mimeHint ?? 'image/png';
    return { ...base, kind: 'image', mime, data: toDataUrl(bytes, mime) };
  }
  if (ext === 'pdf' || mimeHint === 'application/pdf') {
    return {
      ...base,
      kind: 'pdf',
      mime: 'application/pdf',
      data: toDataUrl(bytes, 'application/pdf'),
    };
  }
  if (TEXT_EXT.has(ext) || mimeHint?.startsWith('text/')) {
    const text = new TextDecoder().decode(bytes).slice(0, MAX_TEXT_CHARS);
    return { ...base, kind: 'text', mime: mimeHint ?? 'text/plain', text };
  }
  throw new AttachmentError('unsupported', name);
}

/** Depuis un `File` du navigateur (collage ou glisser-déposer). */
export async function attachmentFromFile(file: File): Promise<Attachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fallback = file.type.startsWith('image/')
    ? `image.${file.type.split('/')[1] ?? 'png'}`
    : 'fichier';
  return attachmentFromBytes(file.name || fallback, bytes, file.type || undefined);
}

/** Ouvre le sélecteur natif et lit les fichiers choisis. */
export async function pickAttachments(filterName: string): Promise<Attachment[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [{ name: filterName, extensions: acceptedExtensions }],
  });
  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  const result: Attachment[] = [];
  for (const path of paths) {
    const name = path.split(/[\\/]/).pop() ?? path;
    result.push(attachmentFromBytes(name, await readFile(path)));
  }
  return result;
}

/** Parties de message pour l'API : texte (+ fichiers texte inlinés), images, PDF. */
export function toContentParts(text: string, attachments: Attachment[]): string | ContentPart[] {
  if (attachments.length === 0) return text;
  const inlined = attachments
    .filter((a) => a.kind === 'text' && a.text !== undefined)
    .map((a) => `\n\n[Fichier : ${a.name}]\n\`\`\`${extension(a.name)}\n${a.text}\n\`\`\``)
    .join('');
  const parts: ContentPart[] = [{ type: 'text', text: `${text}${inlined}`.trim() }];
  for (const a of attachments) {
    if (a.kind === 'image' && a.data) parts.push({ type: 'image_url', image_url: { url: a.data } });
    if (a.kind === 'pdf' && a.data) {
      parts.push({ type: 'file', file: { filename: a.name, file_data: a.data } });
    }
  }
  return parts;
}

/** Estimation grossière du coût en tokens d'une pièce jointe. */
export function estimateAttachmentTokens(a: Attachment): number {
  if (a.kind === 'image') return 1100;
  if (a.kind === 'pdf') return Math.ceil(a.size / 5);
  return Math.ceil((a.text?.length ?? 0) / 3.5);
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}
