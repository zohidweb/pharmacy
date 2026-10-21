#!/usr/bin/env node
// Prepares a static export for the reverse proxy (ADR-0012, «Сжатие»):
//
//   node tools/scripts/precompress.mjs apps/web/out apps/admin/out
//
// Removes source maps (they are not served) and writes `.br` and `.gz` next to every text file worth
// compressing; Caddy serves them with `file_server { precompressed br gzip }`. node:zlib only.
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';

const COMPRESSIBLE = new Set([
  '.js',
  '.css',
  '.html',
  '.txt',
  '.svg',
  '.json',
  '.ico',
  '.webmanifest',
]);
const MIN_BYTES = 1024;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('Usage: node tools/scripts/precompress.mjs <dir> [dir...]');
  process.exit(1);
}

for (const dir of dirs) {
  let maps = 0;
  let compressed = 0;
  for (const path of walk(dir)) {
    if (path.endsWith('.map')) {
      rmSync(path);
      maps += 1;
      continue;
    }
    if (!COMPRESSIBLE.has(extname(path)) || statSync(path).size < MIN_BYTES)
      continue;
    const source = readFileSync(path);
    const br = brotliCompressSync(source, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    });
    const gz = gzipSync(source, { level: constants.Z_BEST_COMPRESSION });
    // a variant that is not smaller only costs a disk read
    if (br.length < source.length) writeFileSync(`${path}.br`, br);
    if (gz.length < source.length) writeFileSync(`${path}.gz`, gz);
    compressed += 1;
  }
  console.log(
    `${dir}: ${compressed} files precompressed, ${maps} source maps removed`,
  );
}
