const CACHE = 'dse-m2-v22';
const ASSETS = [
  './',
  './index.html',
  './add.html',
  './css/app.css',
  './css/m2.css',
  './js/storage.js',
  './js/app.js',
  './js/analytics.js',
  './data/sample.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Same-origin documents (./, index.html, add.html, and any navigation).
// Query strings are ignored so add.html and add.html?id= share one shell entry.
function isAppHtml(url, req) {
  if (req.mode === 'navigate') return true;
  return /\/(?:index\.html|add\.html)?$/.test(url.pathname);
}

function htmlCacheRequest(req) {
  var url = new URL(req.url);
  url.search = '';
  url.hash = '';
  // cache.put rejects mode "navigate".
  return new Request(url.toString());
}

function store(req, res) {
  if (!res || !res.ok) return;
  var copy = res.clone();
  caches.open(CACHE).then(function (cache) {
    cache.put(htmlCacheRequest(req), copy).catch(function () {});
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
          return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // Cross-origin (LandsD / Leaflet): network-first, cache fallback.
  // Same-origin HTML: network-first, cache fallback. A Pages lag at install
  // must not pin a stale add.html inside this CACHE name. Edit (?id=) and
  // add share the query-less shell entry.
  // Other same-origin assets: cache-first.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }
  if (isAppHtml(url, req)) {
    event.respondWith(
      fetch(req).then(function (res) {
        store(req, res);
        return res;
      }).catch(function () {
        return caches.match(htmlCacheRequest(req));
      })
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(function (cached) {
      return (
        cached ||
        fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(req, copy);
          });
          return res;
        })
      );
    })
  );
});
