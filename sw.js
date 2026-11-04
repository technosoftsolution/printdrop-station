// PrintDrop Permanent PWA Service Worker
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Let network fetch all requests fresh
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
