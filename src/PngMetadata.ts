/* eslint-disable no-bitwise */
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function writeUint32BE(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

export function isPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

interface PngChunk {
  type: string;
  data: Uint8Array;
}

function parseChunks(bytes: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = 8; // skip signature

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) break;

    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);

    if (offset + 12 + length > bytes.length) break;

    const data = bytes.slice(offset + 8, offset + 8 + length);
    chunks.push({type, data});

    offset += 12 + length; // 4 length + 4 type + data + 4 crc

    if (type === 'IEND') break;
  }

  return chunks;
}

export function readPngCharaMetadata(pngBase64: string): string | null {
  try {
    const binary = atob(pngBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    if (!isPngSignature(bytes)) return null;

    const chunks = parseChunks(bytes);

    for (const chunk of chunks) {
      if (chunk.type === 'tEXt') {
        const nullIndex = chunk.data.indexOf(0);
        if (nullIndex === -1) continue;

        const keyword = String.fromCharCode(...chunk.data.slice(0, nullIndex));
        if (keyword === 'chara') {
          const value = String.fromCharCode(...chunk.data.slice(nullIndex + 1));
          return atob(value);
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function writePngWithCharaMetadata(avatarBase64: string, charaJson: string): string {
  const binary = atob(avatarBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  if (!isPngSignature(bytes)) {
    throw new Error('Not a valid PNG file');
  }

  const keyword = 'chara';
  const encoded = btoa(charaJson);
  const valueBytes = new TextEncoder().encode(encoded);

  const keywordBytes = new TextEncoder().encode(keyword);
  const chunkData = new Uint8Array(keywordBytes.length + 1 + valueBytes.length);
  chunkData.set(keywordBytes, 0);
  chunkData[keywordBytes.length] = 0; // null separator
  chunkData.set(valueBytes, keywordBytes.length + 1);

  const typeBytes = new TextEncoder().encode('tEXt');
  const crcInput = new Uint8Array(typeBytes.length + chunkData.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(chunkData, typeBytes.length);
  const crc = crc32(crcInput);

  const lengthBytes = writeUint32BE(chunkData.length);
  const crcBytes = writeUint32BE(crc);

  const newChunk = new Uint8Array(12 + chunkData.length);
  newChunk.set(lengthBytes, 0);
  newChunk.set(typeBytes, 4);
  newChunk.set(chunkData, 8);
  newChunk.set(crcBytes, 8 + chunkData.length);

  let iendOffset = bytes.length;
  const charaSpans: Array<[number, number]> = [];
  let offset = 8; // skip signature
  while (offset + 8 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const chunkEnd = offset + 12 + length; // length + type + data + crc
    if (chunkEnd > bytes.length) break;

    if (type === 'tEXt') {
      const data = bytes.slice(offset + 8, offset + 8 + length);
      const nullIndex = data.indexOf(0);
      if (nullIndex !== -1) {
        const kw = String.fromCharCode(...data.slice(0, nullIndex));
        if (kw === keyword) {
          charaSpans.push([offset, chunkEnd]);
        }
      }
    }

    offset = chunkEnd;
    if (type === 'IEND') {
      iendOffset = offset - 12 - length; // start of IEND chunk
      break;
    }
  }

  const segments: Uint8Array[] = [];
  let cursor = 0;
  for (const [start, end] of charaSpans) {
    if (start > cursor) segments.push(bytes.slice(cursor, start));
    cursor = Math.max(cursor, end);
  }
  if (cursor < iendOffset) segments.push(bytes.slice(cursor, iendOffset));
  const prefix = concatUint8(segments);

  const result = new Uint8Array(prefix.length + newChunk.length + (bytes.length - iendOffset));
  result.set(prefix, 0);
  result.set(newChunk, prefix.length);
  result.set(bytes.slice(iendOffset), prefix.length + newChunk.length);

  let output = '';
  for (let i = 0; i < result.length; i++) {
    output += String.fromCharCode(result[i]);
  }
  return btoa(output);
}

function concatUint8(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
