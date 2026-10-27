/* Service Worker — menyimpan aplikasi di HP supaya bisa dibuka tanpa sinyal.
   File aplikasi diambil dari internet dulu (versi terbaru), cache hanya dipakai saat offline.
   Naikkan CACHE setiap kali file aplikasi diubah. */
var CACHE = 'asi-v2.12.1';
var SHELL = ['./', './index.html', './app.js', './styles.css', './config.js', './manifest.webmanifest',
             './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png', './icons/aspire-icon.svg', './logos/ipe.png', './logos/ike.png'];

self.addEventListener('install', function (e) {
  // cache: 'reload' = lewati cache browser supaya yang tersimpan benar-benar versi terbaru
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return fetch(new Request(u, { cache: 'reload' })).then(function (r) { if (r.ok) return c.put(u, r); }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // POST ke Apps Script tidak disentuh
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var isAsset = /\.(png|jpg|jpeg|svg|webmanifest)$/.test(url.pathname);

  if (isAsset) {   // gambar: cache dulu
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (c) { return c || fetch(req); }));
    return;
  }
  // halaman & kode: internet dulu (no-cache), cadangan cache saat offline
  e.respondWith(fetch(new Request(req, { cache: 'no-cache' })).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (c) {
      return c || (req.mode === 'navigate' ? caches.match('./index.html') : new Response('', { status: 504 }));
    });
  }));
});

// Klik notifikasi "pekerjaan baru" → buka / fokuskan aplikasi di daftar yang sesuai
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var filter = (e.notification.data && e.notification.data.filter) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0) { list[i].postMessage({ openFilter: filter }); return list[i].focus(); }
    }
    return self.clients.openWindow(self.registration.scope);
  }));
});
