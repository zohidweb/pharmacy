/*
 * Kill switch of the Service Worker (ADR-0015): publish this file as /sw.js to remove every cache
 * of apps/web and unregister the worker on all terminals at their next visit.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) =>
        clients.forEach((client) => client.navigate(client.url)),
      ),
  );
});
