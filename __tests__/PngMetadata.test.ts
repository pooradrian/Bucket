import {
  isPngSignature,
  readPngCharaMetadata,
  writePngWithCharaMetadata,
} from '../src/PngMetadata';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function buildMinimalPngBase64(): string {
  const ihdrData = [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0];
  const ihdr = [0, 0, 0, 13, 73, 72, 68, 82, ...ihdrData, 0, 0, 0, 0];
  const iend = [0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0];
  const bytes = [...PNG_SIGNATURE, ...ihdr, ...iend];
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function bytesToBase64(bytes: number[]): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe('isPngSignature', () => {
  test('recognizes a valid PNG signature', () => {
    expect(isPngSignature(new Uint8Array(PNG_SIGNATURE))).toBe(true);
  });

  test('rejects a wrong signature', () => {
    expect(isPngSignature(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(false);
  });

  test('rejects input shorter than 8 bytes', () => {
    expect(isPngSignature(new Uint8Array([137, 80]))).toBe(false);
    expect(isPngSignature(new Uint8Array([]))).toBe(false);
  });
});

describe('readPngCharaMetadata', () => {
  test('returns null for a PNG with no chara chunk', () => {
    expect(readPngCharaMetadata(buildMinimalPngBase64())).toBeNull();
  });

  test('returns null for non-PNG input', () => {
    expect(readPngCharaMetadata(bytesToBase64([1, 2, 3, 4, 5]))).toBeNull();
  });

  test('returns null for invalid base64', () => {
    expect(readPngCharaMetadata('!!!not-base64!!!')).toBeNull();
  });
});

describe('writePngWithCharaMetadata', () => {
  test('round-trips chara JSON through write then read', () => {
    const png = buildMinimalPngBase64();
    const json = '{"name":"Test","description":"hello"}';
    const written = writePngWithCharaMetadata(png, json);
    expect(readPngCharaMetadata(written)).toBe(json);
  });

  test('preserves the original PNG signature', () => {
    const written = writePngWithCharaMetadata(buildMinimalPngBase64(), '{}');
    const binary = atob(written);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    expect(isPngSignature(bytes)).toBe(true);
  });

  test('still reads chara from a PNG that already had one (overwrite path)', () => {
    const png = buildMinimalPngBase64();
    const first = writePngWithCharaMetadata(png, '{"v":1}');
    const second = writePngWithCharaMetadata(first, '{"v":2}');
    expect(readPngCharaMetadata(second)).toBe('{"v":2}');
  });

  test('throws on non-PNG input', () => {
    expect(() => writePngWithCharaMetadata(bytesToBase64([1, 2, 3, 4]), '{}')).toThrow(
      'Not a valid PNG file',
    );
  });
});
