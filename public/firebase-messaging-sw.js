/**
 * Firebase Cloud Messaging background service worker.
 * Coexists with Angular's ngsw-worker.js — handles push events only.
 * ngsw handles asset caching; this SW handles FCM push messages.
 */
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js');

firebase.initializeApp({
  messagingSenderId: '647810616435',
});

const messaging = firebase.messaging();

// Background message handler — customizes the notification display.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? 'Macronaut';
  const body = payload.notification?.body ?? "You haven't logged today yet.";
  const options = {
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    data: { url: '/' },
  };
  self.registration.showNotification(title, options);
});

// Handle notification click — open or focus the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      if (windowClients.length > 0) {
        return windowClients[0].focus();
      }
      return clients.openWindow(event.notification.data?.url ?? '/');
    }),
  );
});
