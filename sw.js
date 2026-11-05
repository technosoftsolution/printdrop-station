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
  if (event.request.method === 'POST' && (url.searchParams.has('share_target') || url.pathname.includes('connect.html') || url.pathname.includes('share-target'))) {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        let files = formData.getAll('shared_files');
        
        // Comprehensive fallback: scan all formData entries in case Android mapped under a different field name
        if (!files || files.length === 0) {
          files = [];
          for (const [key, val] of formData.entries()) {
            if (val && typeof val === 'object' && (val.name || val.size !== undefined)) {
              files.push(val);
            }
          }
        }

        if (files && files.length > 0) {
          // Open IndexedDB
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
            try {
              // Convert to ArrayBuffer for 100% reliable IndexedDB cloning in Chromium Service Workers
              const arrayBuffer = await file.arrayBuffer();
              store.add({
                name: file.name || 'shared_document',
                type: file.type || 'application/octet-stream',
                size: file.size || arrayBuffer.byteLength,
                buffer: arrayBuffer,
                timestamp: Date.now()
              });
            } catch (err) {
              console.warn('Failed to buffer shared file in SW:', err);
            }
          }
          await new Promise((res) => { tx.oncomplete = res; });
        }
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
