import { describe, expect, it } from 'vitest';
import { AttachmentError, attachmentFromBytes, formatBytes, toContentParts } from './attachments';

describe('attachmentFromBytes', () => {
  it('reconnaît images, PDF et texte', () => {
    expect(attachmentFromBytes('photo.PNG', new Uint8Array([1, 2, 3])).kind).toBe('image');
    expect(attachmentFromBytes('doc.pdf', new Uint8Array([1])).kind).toBe('pdf');
    const text = attachmentFromBytes('main.rs', new TextEncoder().encode('fn main() {}'));
    expect(text.kind).toBe('text');
    expect(text.text).toBe('fn main() {}');
  });

  it('rejette les types inconnus et les fichiers trop lourds', () => {
    expect(() => attachmentFromBytes('a.exe', new Uint8Array([1]))).toThrow(AttachmentError);
    expect(() => attachmentFromBytes('big.png', new Uint8Array(10 * 1024 * 1024 + 1))).toThrow(
      /too_large/,
    );
  });
});

describe('toContentParts', () => {
  it('renvoie une chaîne sans pièce jointe et un tableau sinon', () => {
    expect(toContentParts('Salut', [])).toBe('Salut');
    const parts = toContentParts('Lis ça', [
      {
        id: '1',
        kind: 'pdf',
        name: 'r.pdf',
        mime: 'application/pdf',
        size: 3,
        data: 'data:application/pdf;base64,QUJD',
      },
    ]);
    expect(parts).toEqual([
      { type: 'text', text: 'Lis ça' },
      { type: 'file', file: { filename: 'r.pdf', file_data: 'data:application/pdf;base64,QUJD' } },
    ]);
  });
});

describe('formatBytes', () => {
  it('formate en o, Ko, Mo', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(2048)).toBe('2 Ko');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 Mo');
  });
});
