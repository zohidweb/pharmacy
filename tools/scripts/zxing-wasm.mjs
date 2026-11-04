#!/usr/bin/env node
// Copies the barcode reader of zxing-wasm into the static files of apps/web (ADR-0025, п. 4):
//
//   node tools/scripts/zxing-wasm.mjs apps/web/public
//
// The camera window loads it from its own origin — never the jsDelivr default of the package — as
// /vendor/zxing_reader-<version>.wasm; the export carries it into out/, where the Service Worker precaches it. The
// version and the SHA-256 are those of the loader that runs in the browser: barcode-detector bundles its own copy of
// the zxing-wasm loader, so the file is taken from the zxing-wasm barcode-detector resolves (a nested one when only
// one of the two packages was upgraded) and a file that does not match its loader stops the build. Older versions are
// removed. The file is not in git.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from 'barcode-detector/ponyfill';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vendorDir = join(root, process.argv[2] ?? 'apps/web/public', 'vendor');
const require = createRequire(import.meta.url);
const source = createRequire(require.resolve('barcode-detector/ponyfill')).resolve(
  'zxing-wasm/reader/zxing_reader.wasm',
);
const name = `zxing_reader-${ZXING_WASM_VERSION}.wasm`;

const sha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

if (sha256(source) !== ZXING_WASM_SHA256) {
  console.error(
    `zxing-wasm: ${source} is not the reader of the loader in barcode-detector (zxing-wasm ${ZXING_WASM_VERSION})`,
  );
  process.exit(1);
}

mkdirSync(vendorDir, { recursive: true });
for (const file of readdirSync(vendorDir)) {
  if (/^zxing_reader-.+\.wasm$/.test(file) && file !== name) {
    rmSync(join(vendorDir, file));
  }
}
copyFileSync(source, join(vendorDir, name));
