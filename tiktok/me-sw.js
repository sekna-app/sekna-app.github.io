// Notifications for the TikTok personal page (/tiktok/me) only. Kept apart from the app's sw.js.
importScripts('/firebase-config.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp(self.SEKNA_FIREBASE);
firebase.messaging().onBackgroundMessage(p => {
  const d = (p && p.data) || {};
  return self.registration.showNotification(d.title || 'HEMERA', { body: d.body || '', badge: '/icons/badge-96.png', icon: '/icons/icon-192.png', tag: 'tiktok-me', data: { url: d.url || '/tiktok/me' } });
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data || {}).url || '/tiktok/me';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => {
    for (const c of l) if (c.url.indexOf('/tiktok/me') >= 0 && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
