// SEKNA web app shell. The page is always fetched fresh when online, so updates
// appear right away; the cached copy is only used when the network is unavailable.
// Dashboard data comes live from the SEKNA server and is never cached here.
const CACHE = 'sekna-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html')))
  );
});
