// Joolry Daily — Service Worker v8 (2026-10-03)
// HTML always network-first. Never sticky-cache index.html.

const CACHE = 'joolry-v16-20261003';
const STATIC = [
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(STATIC).catch(function (err) {
        console.warn('[SW] Precache partial:', err);
      });
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  // Never cache GAS
  if (url.indexOf('script.google.com') > -1 || url.indexOf('macros/s/') > -1) return;

  // HTML / navigate / index.html → always network, no-store
  if (
    e.request.mode === 'navigate' ||
    url.indexOf('index.html') > -1 ||
    (e.request.headers.get('accept') || '').indexOf('text/html') > -1
  ) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // CDN: cache-first
  if (url.indexOf('cdnjs') > -1 || url.indexOf('jsdelivr') > -1 || url.indexOf('fonts.g') > -1) {
    e.respondWith(
      caches.match(e.request).then(function (cached) {
        var net = fetch(e.request).then(function (res) {
          if (res && res.status === 200) {
            var clone = res.clone();
            caches.open(CACHE).then(function (c) { c.put(e.request, clone); });
          }
          return res;
        });
        return cached || net;
      })
    );
    return;
  }

  // Default: network
  e.respondWith(
    fetch(e.request).catch(function () {
      return caches.match(e.request);
    })
  );
});
