/* Legacy CRM service worker: caches the app shell and static assets so field mode opens with no connection.
 * API responses are NEVER cached (they contain customer data and need a valid session). */
const VERSION = 'v1';
const SHELL = `legacy-shell-${VERSION}`;
const ASSETS = `legacy-assets-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/favicon.png', '/brand/logo-full-520.png'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never touch API traffic or other origins' data requests (fonts are fine to cache below).
  if (url.pathname.startsWith('/api/') || (url.origin !== self.location.origin && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname))) return;

  // Page navigations: network first, fall back to the cached SPA shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(SHELL).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || new Response('Offline. Open the app once while online to use field mode offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))),
    );
    return;
  }

  // Static assets (hashed bundles, images, fonts): cache first, refresh in the background.
  event.respondWith(
    caches.open(ASSETS).then(async (cache) => {
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) void cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
