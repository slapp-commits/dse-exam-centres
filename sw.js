const CACHE = 'dse-m2-v8';
const ASSETS = [
  './',
  './index.html',
  './add.html',
  './css/app.css',
  './css/m2.css',
  './js/storage.js',
  './js/app.js',
  './data/sample.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

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
  // Network-first for LandsD / Leaflet CDN; cache-first for app shell
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match(req);
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
