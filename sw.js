// Joolry Daily — Service Worker v17 (speed build)
// App shell: stale-while-revalidate (instant open, refreshes in background).
// /api/* and script.google.com: never cached. BUMP `CACHE` ON EVERY DEPLOY.
const CACHE = 'joolry-v19-20261008';
const SHELL = ['./', './index.html', './app.js', './appconfig.js', './app.css', './core.js', './manifest.json'];
const CDN = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function swr(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) c.put(req, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u = new URL(req.url);
  if (u.pathname.indexOf('/api/') === 0 || u.hostname === 'script.google.com') return;
  if (u.origin === location.origin) {
    // navigations map to the cached index.html shell
    e.respondWith(req.mode === 'navigate' ? swr(new Request('./index.html')) : swr(req));
    return;
  }
  if (CDN.indexOf(u.hostname) > -1) e.respondWith(swr(req));
});
