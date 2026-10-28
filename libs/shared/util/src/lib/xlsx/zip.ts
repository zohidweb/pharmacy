import { crc32 } from './crc32';

export interface ZipFile {
  /** ASCII path inside the archive. */
  name: string;
  /** Backed by an ArrayBuffer: a Blob of the browser takes no shared memory. */
  data: Uint8Array<ArrayBuffer>;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const VERSION = 20;
const DEFLATE = 8;
// 1980-01-01 00:00 in MS-DOS format: every entry gets the same time, the archive is deterministic
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
const MAX_SIZE = 0xffffffff;

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A zip of deflated entries (ADR-0015, amendment 2026-10-27): local headers with the CRC and sizes known before the
 * data (no data descriptor), the central directory, the end record. No zip64: an entry or the archive over 4 GB is a
 * RangeError.
 */
export async function zipFiles(
  files: readonly ZipFile[],
): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const entries = await Promise.all(
    files.map(async (file) => ({
      name: encoder.encode(file.name),
      crc: crc32(file.data),
      size: file.data.length,
      packed: await deflateRaw(file.data),
    })),
  );

  const localLength = entries.reduce(
    (sum, e) => sum + 30 + e.name.length + e.packed.length,
    0,
  );
  const centralLength = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const total = localLength + centralLength + 22;
  if (
    total > MAX_SIZE ||
    entries.some((e) => e.size > MAX_SIZE || e.packed.length > MAX_SIZE)
  ) {
    throw new RangeError('The archive is over 4 GB: zip64 is not written');
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(at);
    view.setUint32(at, LOCAL, true);
    view.setUint16(at + 4, VERSION, true);
    view.setUint16(at + 6, 0, true);
    view.setUint16(at + 8, DEFLATE, true);
    view.setUint16(at + 10, DOS_TIME, true);
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, e.crc, true);
    view.setUint32(at + 18, e.packed.length, true);
    view.setUint32(at + 22, e.size, true);
    view.setUint16(at + 26, e.name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(e.name, at + 30);
    out.set(e.packed, at + 30 + e.name.length);
    at += 30 + e.name.length + e.packed.length;
  }

  const centralStart = at;
  entries.forEach((e, i) => {
    view.setUint32(at, CENTRAL, true);
    view.setUint16(at + 4, VERSION, true);
    view.setUint16(at + 6, VERSION, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, DEFLATE, true);
    view.setUint16(at + 12, DOS_TIME, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, e.crc, true);
    view.setUint32(at + 20, e.packed.length, true);
    view.setUint32(at + 24, e.size, true);
    view.setUint16(at + 28, e.name.length, true);
    // extra, comment, disk number, internal and external attributes stay zero
    view.setUint32(at + 42, offsets[i], true);
    out.set(e.name, at + 46);
    at += 46 + e.name.length;
  });

  view.setUint32(at, END, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);
  return out;
}
