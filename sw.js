// PrintDrop Permanent PWA Service Worker with Native File Share Target (v2.2.2)
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
      // Must compute fully-qualified absolute URL because Response.redirect() requires an absolute URL in the Fetch API
      const redirectUrl = new URL('/printdrop-station/connect.html?shared=1', self.location.origin).href;

      try {
        const processPromise = (async () => {
          const formData = await event.request.formData();
          let files = formData.getAll('shared_files');
          
          // Fallback: scan all formData entries in case Android mapped under a different field name
          if (!files || files.length === 0) {
            files = [];
            for (const [_, val] of formData.entries()) {
              if (val && typeof val === 'object' && (val.name || val.size !== undefined)) {
                files.push(val);
              }
            }
          }

          if (files && files.length > 0) {
            // STEP 1: Buffer all files into ArrayBuffers asynchronously FIRST, BEFORE opening any IndexedDB transaction
            const bufferedItems = [];
            for (const file of files) {
              try {
                const arrayBuffer = await file.arrayBuffer();
                bufferedItems.push({
                  name: file.name || 'shared_document',
                  type: file.type || 'application/octet-stream',
                  size: file.size || arrayBuffer.byteLength,
                  buffer: arrayBuffer,
                  timestamp: Date.now()
                });
              } catch (err) {
                console.warn('Failed to buffer file:', err);
              }
            }

            // STEP 2: Open IndexedDB and write all buffered items synchronously in one transaction
            if (bufferedItems.length > 0) {
              const openReq = indexedDB.open('printdrop_share_db', 1);
              const db = await new Promise((resolve) => {
                openReq.onupgradeneeded = () => {
                  const d = openReq.result;
                  if (!d.objectStoreNames.contains('incoming')) {
                    d.createObjectStore('incoming', { autoIncrement: true });
                  }
                };
                openReq.onsuccess = () => resolve(openReq.result);
                openReq.onerror = () => resolve(null);
              });

              if (db) {
                await new Promise((resolve) => {
                  try {
                    const tx = db.transaction('incoming', 'readwrite');
                    const store = tx.objectStore('incoming');
                    for (const item of bufferedItems) {
                      store.add(item);
                    }
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => resolve();
                    tx.onabort = () => resolve();
                  } catch (e) {
                    console.warn('IDB write error:', e);
                    resolve();
                  }
                });
              }
            }
          }
        })();

        // Safety timeout: 2500ms max. Never freeze Android app waiting on background operations
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 2500));
        await Promise.race([processPromise, timeoutPromise]);
      } catch (err) {
        console.warn('PWA Service worker share-target error:', err);
      }

      // 303 See Other redirect to absolute URL
      return Response.redirect(redirectUrl, 303);
    })());
    return;
  }

  // Let network fetch all other requests fresh
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
