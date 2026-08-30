/**
 * Safety worker — served at the URL the retired PWA's service worker lived at.
 *
 * The web app shipped Angular's service worker until 2026-08-30 (ADR-0036).
 * Every browser that installed it still has it, and a service worker keeps
 * serving its cached app until something tells it to stop. This file is
 * Angular's own `safety-worker.js` recipe: the browser picks it up as an
 * "update" to the old worker, it claims the clients, clears every cache and
 * unregisters itself, so the next load comes from the network and lands on
 * the retired-routes page. (`/ngsw.json` is not emitted any more; under the
 * `**` rewrite the old worker gets the HTML shell there and fails to parse
 * it, which only degrades it — THIS file is what actually uninstalls it.)
 *
 * Keep this file for as long as anyone might still carry the old worker;
 * it costs nothing to serve.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) c.navigate(c.url);
    })(),
  );
});
