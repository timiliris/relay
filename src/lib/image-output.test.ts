import { describe, expect, it } from 'vitest';
import {
  base64Size,
  dataUrlToBytes,
  describeDataUrl,
  imageAttachmentFromUrl,
  toImageParts,
} from './image-output';
import { normalizeModel, supportsImageOutput } from './openrouter';

// 1×1 PNG (70 octets) : en-tête PNG reconnaissable, utile pour la taille et le décodage.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('describeDataUrl / base64Size', () => {
  it('déduit le type MIME et la taille décodée sans décoder', () => {
    expect(base64Size('QUJD')).toBe(3);
    expect(base64Size('QUI=')).toBe(2);
    expect(base64Size('QQ==')).toBe(1);
    expect(describeDataUrl(`data:image/png;base64,${PNG}`)).toEqual({
      mime: 'image/png',
      size: 70,
    });
    expect(describeDataUrl('data:image/svg+xml;utf8,<svg/>')).toEqual({
      mime: 'image/svg+xml',
      size: 6,
    });
    expect(describeDataUrl('https://example.com/a.png')).toBeNull();
  });
});

describe('imageAttachmentFromUrl', () => {
  it("construit une pièce jointe image nommée d'après son rang", () => {
    const a = imageAttachmentFromUrl(`data:image/png;base64,${PNG}`, 1);
    expect(a).toMatchObject({ kind: 'image', name: 'image-1.png', mime: 'image/png', size: 70 });
    expect(a.data).toBe(`data:image/png;base64,${PNG}`);
    expect(a.id).toBeTruthy();
  });

  it('adapte l’extension au type MIME et retombe sur PNG pour une URL inconnue', () => {
    expect(imageAttachmentFromUrl('data:image/webp;base64,AAAA', 2).name).toBe('image-2.webp');
    expect(imageAttachmentFromUrl('data:image/jpeg;base64,AAAA', 3).name).toBe('image-3.jpg');
    const remote = imageAttachmentFromUrl('https://cdn.example.com/x', 4);
    expect(remote).toMatchObject({ name: 'image-4.png', mime: 'image/png', size: 0 });
  });
});

describe('toImageParts', () => {
  it('ne renvoie que les images munies de données, au format image_url', () => {
    expect(
      toImageParts([
        { id: '1', kind: 'image', name: 'a.png', mime: 'image/png', size: 1, data: 'data:x' },
        { id: '2', kind: 'text', name: 'n.md', mime: 'text/markdown', size: 1, text: '#' },
        { id: '3', kind: 'image', name: 'b.png', mime: 'image/png', size: 1 },
      ]),
    ).toEqual([{ type: 'image_url', image_url: { url: 'data:x' } }]);
  });
});

describe('dataUrlToBytes', () => {
  it('décode une data URL base64 en octets', () => {
    const bytes = dataUrlToBytes(`data:image/png;base64,${PNG}`);
    expect(bytes).toHaveLength(70);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(() => dataUrlToBytes('https://example.com')).toThrow();
  });
});

describe('supportsImageOutput', () => {
  const raw = (output_modalities: unknown) => ({
    id: 'test/model',
    architecture: { input_modalities: ['text'], output_modalities },
  });

  it('reconnaît les modèles dont output_modalities contient image', () => {
    expect(supportsImageOutput(normalizeModel(raw(['image', 'text'])) ?? undefined)).toBe(true);
    expect(supportsImageOutput(normalizeModel(raw(['text'])) ?? undefined)).toBe(false);
    expect(supportsImageOutput(normalizeModel(raw(undefined)) ?? undefined)).toBe(false);
    expect(supportsImageOutput(undefined)).toBe(false);
  });
});
