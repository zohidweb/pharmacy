import type { SiteMediaType } from '@pharmacy/shared-dto';

export interface SniffedImage {
  type: SiteMediaType;
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngOf(bytes: Buffer): SniffedImage | null {
  // 8 bytes of the signature, then the IHDR chunk: length (4), "IHDR" (4), width (4), height (4).
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    return null;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return {
    type: 'image/png',
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

// SOF0 (baseline), SOF1 (extended sequential), SOF2 (progressive): the frame header holds the size.
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2]);

function jpegOf(bytes: Buffer): SniffedImage | null {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  )
    return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    // Fill bytes: any number of 0xFF before a marker.
    let marker = bytes[i + 1];
    let at = i + 1;
    while (marker === 0xff && at + 1 < bytes.length) {
      at += 1;
      marker = bytes[at];
    }
    i = at + 1;
    // Markers without a length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (i + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(i);
    if (JPEG_FRAMES.has(marker)) {
      // length (2), precision (1), height (2), width (2).
      if (length < 7 || i + 7 > bytes.length) return null;
      return {
        type: 'image/jpeg',
        height: bytes.readUInt16BE(i + 3),
        width: bytes.readUInt16BE(i + 5),
      };
    }
    // The scan starts: no frame header before it, the file is not a picture we can size.
    if (marker === 0xda) return null;
    if (length < 2) return null;
    i += length;
  }
  return null;
}

function webpOf(bytes: Buffer): SniffedImage | null {
  if (
    bytes.length < 30 ||
    bytes.toString('latin1', 0, 4) !== 'RIFF' ||
    bytes.toString('latin1', 8, 12) !== 'WEBP'
  )
    return null;
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // Lossy: frame tag (3), start code 9D 01 2A, then 14-bit width and height.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a)
      return null;
    return {
      type: 'image/webp',
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    // Lossless: signature 0x2F, then 14 bits of width - 1 and 14 bits of height - 1.
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes.readUInt32LE(21);
    return {
      type: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X') {
    // Extended: flags (4), canvas width - 1 (24 bits), canvas height - 1 (24 bits).
    return {
      type: 'image/webp',
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
    };
  }
  return null;
}

/**
 * The type and the size of an image by its signature, never by the name or the declared type (ADR-0023, P3): JPEG,
 * PNG and WebP only (no SVG: it can carry a script). `null` — not one of them, or the header is cut or has no size.
 */
export function sniffImage(bytes: Buffer): SniffedImage | null {
  const found = pngOf(bytes) ?? jpegOf(bytes) ?? webpOf(bytes);
  if (found === null || found.width < 1 || found.height < 1) return null;
  return found;
}
