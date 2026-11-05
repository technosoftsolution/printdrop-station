// PrintDrop Permanent PWA Service Worker with Native File Share Target
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept Web Share Target POST request from Android native share sheet
  if (event.request.method === 'POST' && (url.searchParams.has('share_target') || url.pathname.includes('connect.html'))) {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const files = formData.getAll('shared_files');

        // Store shared files in IndexedDB so connect.html can read and transfer them to the station
        const openReq = indexedDB.open('printdrop_share_db', 1);
        await new Promise((resolve, reject) => {
          openReq.onupgradeneeded = () => {
            const db = openReq.result;
            if (!db.objectStoreNames.contains('incoming')) {
              db.createObjectStore('incoming', { autoIncrement: true });
            }
          };
          openReq.onsuccess = () => resolve(openReq.result);
          openReq.onerror = () => reject(openReq.error);
        });

        const db = openReq.result;
        const tx = db.transaction('incoming', 'readwrite');
        const store = tx.objectStore('incoming');

        for (const file of files) {
          store.add({
            name: file.name,
            type: file.type,
            size: file.size,
            data: file,
            timestamp: Date.now()
          });
        }
        await new Promise((res) => { tx.oncomplete = res; });
      } catch (err) {
        console.warn('PWA Service worker share-target error:', err);
      }

      // 303 See Other redirect to connect.html?shared=1
      return Response.redirect('/printdrop-station/connect.html?shared=1', 303);
    })());
    return;
  }

  // Let network fetch all other requests fresh
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
