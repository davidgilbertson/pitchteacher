// Cache only external Soundfont assets. Do not cache HTML or app code.
const CACHE_NAME = 'sf-cache-v1';

self.addEventListener('install', (event) => {
  // Activate immediately so new logic applies on next fetches
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Clean up old caches
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n !== CACHE_NAME ? caches.delete(n) : Promise.resolve())));
    await self.clients.claim();
  })());
});

function isSoundfontRequest(url) {
  try {
    const u = new URL(url);
    // Cache GitHub-hosted MIDI JS Soundfonts (.js wrapper and subsequent media)
    return (
      u.hostname === 'gleitz.github.io' &&
      u.pathname.includes('/midi-js-soundfonts/')
    );
  } catch {
    return false;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const resp = await fetch(request, { cache: 'no-store' });
  if (resp && resp.ok) {
    // Store a copy; SW cache lifetime is independent of server TTLs
    cache.put(request, resp.clone());
  }
  return resp;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Never handle navigations or HTML; avoid the SPA-stuck-on-old-index problem
  if (request.mode === 'navigate') return;
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return;

  if (isSoundfontRequest(request.url)) {
    event.respondWith(cacheFirst(request));
  }
});

