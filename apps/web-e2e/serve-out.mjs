/*
 * Static server of the production build apps/web/out for the e2e tests (no dependencies): clean
 * URLs like the reverse proxy will serve them (/pos → pos.html), 404.html otherwise. The API is
 * not served here — the tests answer /api/v1/* themselves (page.route), so this is never a backend.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../web/out',
);
const port = Number(process.env.PORT ?? 4400);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No build in ${root}: run \`npx nx build web\` first.`);
  process.exit(1);
}

function fileOf(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(
    /^([\\/])+/,
    '',
  );
  if (clean.startsWith('..')) return null;
  const candidates = [clean, `${clean}.html`, join(clean, 'index.html')];
  for (const candidate of candidates) {
    const path = join(root, candidate);
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  if (pathname.startsWith('/api/')) {
    response.writeHead(502, { 'Content-Type': 'application/problem+json' });
    response.end(JSON.stringify({ code: 'no_backend_in_e2e' }));
    return;
  }
  // a «new release» for one test: the cookie of its browser context changes the worker's bytes
  const release = /(?:^|;\s*)e2e-sw-release=([\w-]+)/.exec(
    request.headers.cookie ?? '',
  )?.[1];
  if (pathname === '/sw.js' && release) {
    response.writeHead(200, {
      'Content-Type': types['.js'],
      'Cache-Control': 'no-cache',
    });
    response.end(
      `${readFileSync(join(root, 'sw.js'), 'utf8')}\n// release ${release}\n`,
    );
    return;
  }
  const file = fileOf(pathname === '/' ? 'index.html' : pathname);
  const path = file ?? join(root, '404.html');
  response.writeHead(file ? 200 : 404, {
    'Content-Type': types[extname(path)] ?? 'application/octet-stream',
    // the Service Worker must always see its newest version
    ...(pathname === '/sw.js' && { 'Cache-Control': 'no-cache' }),
  });
  createReadStream(path).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`apps/web/out on http://127.0.0.1:${port}`);
});
