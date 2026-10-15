/**
 * Safety worker for the retired web-push service worker.
 *
 * The web logging app registered `/firebase-messaging-sw.js` for web push
 * until 2026-08-30 (ADR-0036 deleted it with the rest of the app). Browsers
 * that registered it still run it, and their update checks hit this URL;
 * without this file the `**` rewrite answers with the HTML shell, the update
 * fails on its MIME type and the old worker stays installed forever.
 *
 * This is the same recipe as `ngsw-worker.js`: install over the old worker,
 * take control, unregister. The push worker never cached the app, so there
 * is nothing to clear and no page to reload. Keep it for as long as anyone
 * might still carry the old worker; it costs nothing to serve.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await self.registration.unregister();
    })(),
  );
});
