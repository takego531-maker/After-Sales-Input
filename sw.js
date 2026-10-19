/* Service Worker — menyimpan tampilan aplikasi di HP supaya bisa dibuka tanpa sinyal.
   Naikkan CACHE (mis. mhc-v1.0.1) setiap kali file aplikasi diubah. */
var CACHE = 'asi-v2.3.1';
var SHELL = ['./', './index.html', './app.js', './styles.css', './config.js', './manifest.webmanifest',
             './icons/icon-192.png', './icons/icon-512.png', './logos/ipe.png', './logos/ike.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
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

  // Stale-while-revalidate: tampil cepat dari cache, update di belakang layar
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () { return null; });
      if (cached) { e.waitUntil(net); return cached; }
      return net.then(function (res) {
        if (res) return res;
        if (req.mode === 'navigate') return cache.match('./index.html');
        return new Response('', { status: 504 });
      });
    });
  }));
});
