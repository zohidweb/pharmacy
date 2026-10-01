#!/usr/bin/env node
// Writes the Service Worker of apps/web into its static export (ADR-0015, ось 6б):
//
//   node tools/scripts/build-sw.mjs apps/web/out
//
// The precache manifest lists every file of out/ (HTML, RSC payloads, /_next/static/*, fonts);
// the version is a SHA-256 over paths and contents, so any change of the build is a new worker.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, process.argv[2] ?? 'apps/web/out');
const template = join(root, 'apps/web/sw/sw.template.js');
// served by the worker itself or never cached
const SKIP = new Set(['sw.js']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(outDir)
  .map((path) => relative(outDir, path).split(sep).join('/'))
  .filter((path) => !SKIP.has(path))
  .sort();

const hash = createHash('sha256');
for (const path of files) {
  hash.update(path);
  hash.update(readFileSync(join(outDir, path)));
}
const version = hash.digest('hex').slice(0, 16);
const manifest = files.map((path) => `/${path}`);

const source = readFileSync(template, 'utf8')
  .replace("'__SW_VERSION__'", JSON.stringify(version))
  .replace('self.__PRECACHE_MANIFEST__', JSON.stringify(manifest));
writeFileSync(join(outDir, 'sw.js'), source);
console.log(`sw.js: ${manifest.length} files, version ${version}`);
