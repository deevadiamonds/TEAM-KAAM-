/* Team Kaam service worker: keeps the app shell and Firebase SDK available offline.
   Firestore traffic is never touched — the Firebase SDK handles its own offline cache. */
const VERSION = 'tk-v3';

/* Firebase Cloud Messaging: shows notifications sent by the Team Kaam notification server while the app is closed. */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyDb6GJql9H0dot4S-d-qj307DIqCdXF9HA',
    authDomain: 'task-management-5b21b.firebaseapp.com',
    projectId: 'task-management-5b21b',
    storageBucket: 'task-management-5b21b.firebasestorage.app',
    messagingSenderId: '767497921708',
    appId: '1:767497921708:web:f11013fc847cf0ee87ab09'
  });
  firebase.messaging();
} catch (e) { /* offline or unsupported: app still works, just no closed-app notifications */ }
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('notificationclick', e => {
  if (e.notification.data && e.notification.data.FCM_MSG) return; /* Firebase handles its own clicks */
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put('./index.html', copy));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  const cacheable = u.origin === self.location.origin
    || (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/'))
    || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;
  e.respondWith(caches.open(VERSION).then(c => c.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});
