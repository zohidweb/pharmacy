import { SpreadsheetError } from './cells';

/** An entry of the central directory of a zip (an .xlsx is one). */
export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const corrupt = () => new SpreadsheetError('corrupt');

/**
 * The central directory of a zip (spec 2026-10-20-data-import, 3.2): the end record is searched in the last 64 KB, its
 * entries give the method, the sizes and the offset of the local header. Zip64 and encryption are not read: an .xlsx
 * of 10 MB needs neither.
 */
export function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const last = bytes.length - 22;
  let end = -1;
  for (let at = last; at >= Math.max(0, last - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === EOCD) {
      end = at;
      break;
    }
  }
  if (end < 0) throw corrupt();
  const count = view.getUint16(end + 10, true);
  const start = view.getUint32(end + 16, true);
  if (count === 0xffff || start === 0xffffffff) throw corrupt();

  const names = new TextDecoder('utf-8');
  const entries = new Map<string, ZipEntry>();
  let at = start;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) {
      throw corrupt();
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const entry: ZipEntry = {
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
      name: names.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
    };
    entries.set(entry.name, entry);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * The bytes of an entry: stored or deflated (`DecompressionStream('deflate-raw')` of the browser). More than
 * `maxBytes` unpacked — a zip bomb — stops the reading.
 */
export async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  maxBytes: number,
): Promise<Uint8Array> {
  if ((entry.flags & 1) !== 0) throw corrupt();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    entry.offset + 30 > bytes.length ||
    view.getUint32(entry.offset, true) !== LOCAL
  ) {
    throw corrupt();
  }
  const dataStart =
    entry.offset +
    30 +
    view.getUint16(entry.offset + 26, true) +
    view.getUint16(entry.offset + 28, true);
  const data = bytes.slice(dataStart, dataStart + entry.compressedSize);
  if (data.length !== entry.compressedSize) throw corrupt();
  if (entry.method === 0) {
    if (data.length > maxBytes) throw corrupt();
    return data;
  }
  if (entry.method !== 8) throw corrupt();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = new Blob([data])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
      .getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw corrupt();
      }
      chunks.push(value);
    }
  } catch {
    throw corrupt();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}
