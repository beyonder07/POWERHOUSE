self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Never try cache fallback for non-GET requests such as login/reset actions.
  if (request.method !== 'GET') {
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({
        error: 'Network unavailable. Please check your connection and try again.'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Minimal service worker: network-first with a safe offline fallback.
  event.respondWith((async () => {
    try {
      return await fetch(request);
    } catch (_error) {
      const cached = await caches.match(request);
      if (cached) {
        return cached;
      }

      return new Response('Offline. This page is not cached yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
