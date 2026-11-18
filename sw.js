// HEMERA web app service worker: offline shell + notifications.
// The page is always fetched fresh when online, so updates appear right away; the
// cached copy is only used without a network. Dashboard data is never cached here.
const CACHE = 'sekna-shell-v15';
const MEDIA = 'hemera-media-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './firebase-config.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png', './icons/badge-96.png', './fonts/changa-ar.woff2'];

importScripts('firebase-config.js');
if (self.SEKNA_FIREBASE && self.SEKNA_FIREBASE.apiKey) {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebase.initializeApp(self.SEKNA_FIREBASE);
  firebase.messaging().onBackgroundMessage(payload => showSeknaNotification((payload && payload.data) || {}));
}

// Android already shows the HEMERA app icon next to every notification, so the
// large icon is only added on computers (otherwise the logo appears twice).
const IS_ANDROID = /Android/i.test(self.navigator.userAgent || '');

function showSeknaNotification(d) {
  const tag = d.eventType === 'new_day' ? 'data-' + (d.accountKey || 'usa') : (d.eventType || 'sekna');
  // a season push opens that season in the Seasons Calendar
  const sk = d.eventType === 'season' ? (String(d.image || '').match(/\/seasons\/([a-z0-9]+)\.jpg/) || [])[1] : '';
  // an Alexandra push: an access request opens her requests page, "you are in" opens the chat
  const ak = d.eventType === 'alexandra' ? (/request/i.test(d.title || '') ? 'req' : 'chat') : '';
  const options = { body: d.body || '', badge: 'icons/badge-96.png', tag: tag, data: { url: sk ? './?ss=' + sk : ak ? './?ak=' + ak : './', season: sk || '', ak: ak } };
  if (!IS_ANDROID) options.icon = 'icons/icon-192.png';
  if (d.image) options.image = d.image;
  return self.registration.showNotification(d.title || 'HEMERA', options);
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        const sk = (event.notification.data || {}).season;
        if (sk) client.postMessage({ type: 'openSeason', key: sk });
        const ak = (event.notification.data || {}).ak;
        if (ak) client.postMessage({ type: 'openAk', to: ak });
        return client.focus();
      }
    }
    return self.clients.openWindow(((event.notification.data || {}).url) || './');
  }));
});

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== MEDIA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // v551 and the story's music, voice and sound files (a/*.mp3)
  // v515 Alexandra's story videos are kept on the device after the first view (no flash, no download again).
  // A video asks for byte ranges, so a saved copy is answered with the part it asks for.
  if (/^\/icons\/alexandra\/(v\/[a-z0-9-]+\.mp4|a\/[a-z0-9-]+\.mp3)$/.test(url.pathname)) { event.respondWith(mediaFromCache(event.request)); return; }
  const nav = event.request.mode === 'navigate';
  // the app page itself (other pages such as the download page keep their own copy)
  const app = nav && (url.pathname === '/' || url.pathname === '/index.html');
  // Pages skip the browser's HTTP cache too, so a new release shows on the next open.
  // Redirects stay manual so the browser follows them itself (a followed redirect
  // handed back to a page load makes it fail).
  const net = (nav
    ? fetch(url.href, { cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' })
    : fetch(event.request))
    .then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(app ? './index.html' : event.request, copy));
      }
      return res;
    });
  const cached = () => caches.match(app ? './index.html' : event.request);
  if (!app) {
    event.respondWith(net.catch(() => cached().then(hit => hit || caches.match('./index.html'))));
    return;
  }
  // Opening the app on a slow connection: if the page has not come back within 2.5 seconds,
  // the saved copy opens instead, and the download carries on to update it for next time.
  // The opening screen never waits on the internet.
  event.respondWith(new Promise(resolve => {
    let done = false;
    const give = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => cached().then(give), 2500);
    net.then(res => { clearTimeout(timer); give(res); })
      .catch(() => { clearTimeout(timer); cached().then(hit => { if (hit) give(hit); else if (!done) { done = true; resolve(Response.error()); } }); });
  }));
  event.waitUntil(net.catch(() => {}));
});

async function mediaFromCache(req) {
  const cache = await caches.open(MEDIA), key = new URL(req.url).href;
  let full = await cache.match(key);
  if (!full) {
    try {
      const res = await fetch(key, { credentials: 'same-origin' });
      if (res.ok && res.status === 200) { await cache.put(key, res.clone()); full = res; }
      else return res;
    } catch (e) { return fetch(req); }
  }
  const range = req.headers.get('range');
  if (!range) return full;
  const buf = await full.clone().arrayBuffer(), size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? parseInt(m[1], 10) : 0, end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (!m[1] && m[2]) { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
    'Content-Type': 'video/mp4', 'Content-Length': String(end - start + 1), 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Accept-Ranges': 'bytes' } });
}
