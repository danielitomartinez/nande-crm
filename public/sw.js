// Service Worker for Ñande CRM PWA & Web Notifications
const CACHE_NAME = 'nande-crm-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Notification click event — opens app or switches to open tab
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/inbox';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (event.notification.data?.url) {
            client.navigate(urlToOpen);
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

// Push notification event for background push
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || 'Ñande CRM';
    const options = {
      body: data.body || 'Tienes un nuevo mensaje en Ñande CRM',
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'nande-crm-notification',
      data: {
        url: data.url || '/inbox',
      },
      vibrate: [100, 50, 100],
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error('[SW] Error handling push event:', err);
  }
});
