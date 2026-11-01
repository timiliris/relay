/**
 * Images générées par un modèle à sortie image (OpenRouter, `modalities: ["image", "text"]`) :
 * conversion d'une data URL reçue dans le flux en pièce jointe du message assistant, et
 * inverse pour renvoyer ces images à l'API lors des tours suivants (édition multi-tours).
 */
import type { Attachment } from './db';
import { newId } from './db';
import type { ContentPart } from './openrouter';

const DATA_URL = /^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,(.*)$/s;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

/** Taille en octets d'une charge base64 (sans décoder). */
export function base64Size(payload: string): number {
  const clean = payload.replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** Type MIME et taille estimée d'une data URL ; `null` si ce n'en est pas une. */
export function describeDataUrl(url: string): { mime: string; size: number } | null {
  const match = DATA_URL.exec(url);
  if (!match) return null;
  const [, mime = 'text/plain', , base64, payload = ''] = match;
  const size = base64 ? base64Size(payload) : decodeURIComponent(payload).length;
  return { mime, size };
}

/**
 * Pièce jointe `image` pour une image produite par l'assistant. `index` (à partir de 1)
 * sert au nom de fichier : `image-1.png`.
 */
export function imageAttachmentFromUrl(url: string, index: number): Attachment {
  const described = describeDataUrl(url);
  const mime = described?.mime.startsWith('image/') ? described.mime : 'image/png';
  const ext = EXTENSIONS[mime] ?? mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'png';
  return {
    id: newId(),
    kind: 'image',
    name: `image-${index}.${ext}`,
    mime,
    size: described?.size ?? 0,
    data: url,
  };
}

/** Parties `image_url` à renvoyer dans le champ `images` d'un message assistant. */
export function toImageParts(
  attachments: Attachment[],
): Extract<ContentPart, { type: 'image_url' }>[] {
  return attachments
    .filter((a) => a.kind === 'image' && a.data)
    .map((a) => ({ type: 'image_url' as const, image_url: { url: a.data as string } }));
}

/** Octets d'une data URL base64, pour l'enregistrer sur disque. */
export function dataUrlToBytes(url: string): Uint8Array {
  const match = DATA_URL.exec(url);
  if (!match) throw new Error('data URL attendue');
  const [, , , base64, payload = ''] = match;
  if (!base64) return new TextEncoder().encode(decodeURIComponent(payload));
  const binary = atob(payload.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
