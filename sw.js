/* Offline cache.
   Bump ASSET_V on every release AND change the matching ?v= in index.html.
   The two must agree — that is what stops a new index.html from pairing with
   a stale app.js out of the browser's HTTP cache. */
const ASSET_V = '10';
const CACHE = `wrk-v${ASSET_V}`;

/* Same URLs the page actually requests, query string included, so the offline
   cache holds the versions that will really be asked for. */
const SHELL = [
  './',
  './index.html',
  `./styles.css?v=${ASSET_V}`,
  `./parse.js?v=${ASSET_V}`,
  `./viz.js?v=${ASSET_V}`,
  `./app.js?v=${ASSET_V}`,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      /* 'reload' bypasses the HTTP cache, so installing can't bake a stale
         copy of a file into a fresh cache. */
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network-first, but always revalidating: 'no-cache' forces a conditional
   request rather than trusting a max-age copy. Without it GitHub Pages'
   ten-minute max-age can hand back an old script alongside new markup. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(url.href, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
