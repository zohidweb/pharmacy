/*
 * Service Worker of the cloud build of apps/web (ADR-0015, ось 6б) — our own, minimal.
 * - precache: the manifest of out/ injected at build time (HTML, RSC payloads, /_next/static/*,
 *   fonts) so the POS reloads during an outage;
 * - /api/* is never touched — buffering of operations is the job of the page (IndexedDB outbox);
 * - pages: network first, cache as the fallback; /_next/static/*: cache first (immutable);
 * - a new version waits and is activated by the page only while the receipt is empty
 *   (message SKIP_WAITING) — never in the middle of a sale;
 * - kill switch: publish sw/kill-switch.js as /sw.js (see apps/web/README.md).
 */
const VERSION = '__SW_VERSION__';
const PRECACHE = `pharmacy-web-${VERSION}`;
const MANIFEST = self.__PRECACHE_MANIFEST__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(MANIFEST)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith('pharmacy-web-') && key !== PRECACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function htmlPathOf(pathname) {
  if (pathname === '/') return '/index.html';
  return pathname.endsWith('.html') ? pathname : `${pathname}.html`;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            if (response.ok)
              caches.open(PRECACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(() =>
      caches
        .match(request, { ignoreSearch: true })
        .then((cached) => cached || caches.match(htmlPathOf(url.pathname)))
        .then((cached) => cached || caches.match('/404.html'))
        .then((cached) => cached || Response.error()),
    ),
  );
});
