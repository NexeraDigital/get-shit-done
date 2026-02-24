/// <reference lib="webworker" />

import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// Precache and route Vite build assets
precacheAndRoute(self.__WB_MANIFEST);

// Push event handler - receives push notifications from the server
// Suppresses notifications when the dashboard is already visible (user sees live SSE updates)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const payload = event.data.json();
  const { title, body, icon, badge, tag, requireInteraction, silent, data } =
    payload;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const clientInfo = clients.map((c) => ({
          url: c.url,
          visibilityState: c.visibilityState,
          focused: c.focused,
        }));
        console.log('[SW] Push received:', title, '| clients:', JSON.stringify(clientInfo));

        // If any dashboard window is visible, user already sees live SSE updates
        const hasVisibleClient = clients.some(
          (client) =>
            client.url.startsWith(self.location.origin) &&
            client.visibilityState === 'visible'
        );

        if (hasVisibleClient) {
          console.log('[SW] Suppressed notification — dashboard is visible');
          return;
        }

        console.log('[SW] Showing notification:', title);
        return self.registration.showNotification(title, {
          body,
          icon: icon || '/icon-192.png',
          badge: '/badge-72.png',
          tag,
          requireInteraction,
          silent,
          data,
        });
      })
  );
});

// Notification click handler - opens or focuses the dashboard
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';
  const fullUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Try to find an existing window to focus
        const client = clients.find(
          (c) => c.url.startsWith(self.location.origin)
        );

        if (client) {
          return client.navigate(fullUrl).then(() => client.focus());
        }

        // No existing window, open a new one
        return self.clients.openWindow(fullUrl);
      })
  );
});

// Activate handler - take control of existing clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Install handler - skip waiting for immediate activation
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
