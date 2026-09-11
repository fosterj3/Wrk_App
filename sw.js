/* Offline cache.
   Bump ASSET_V on every release AND change the matching ?v= in BOTH index.html
   (landing) and app.html.
   The two must agree — that is what stops a new index.html from pairing with
   a stale app.js out of the browser's HTTP cache. */
const ASSET_V = '36';
const CACHE = `cadence-v${ASSET_V}`;

/* Same URLs the page actually requests, query string included, so the offline
   cache holds the versions that will really be asked for. */
const SHELL = [
  './',
  './index.html',
  './app.html',
  `./styles.css?v=${ASSET_V}`,
  `./landing.css?v=${ASSET_V}`,
  `./util.js?v=${ASSET_V}`,
  `./library.js?v=${ASSET_V}`,
  `./parse.js?v=${ASSET_V}`,
  `./plan.js?v=${ASSET_V}`,
  `./viz.js?v=${ASSET_V}`,
  `./tour.js?v=${ASSET_V}`,
  `./app.js?v=${ASSET_V}`,
  './manifest.webmanifest',
  './icons/icon-192-v2.png',
  './icons/icon-512-v2.png',
  /* Brand assets carry their version in the filename rather than a ?v=.
     That is not cosmetic: an installed app's launcher icon is rasterised at
     install time and only refreshed when Chrome notices the manifest changed,
     and it compares icon URLs. Overwriting icon-192.png in place leaves the
     manifest byte-identical, so the phone keeps showing the old icon forever.
     CHANGE THE FILENAME whenever the artwork changes. */
  './logo-mark-v2.png',
  './favicon-32-v2.png',
  './favicon-180-v2.png',
  /* No ?v= on the fonts: the filename is the version. They are content-stable,
     so re-downloading 130KB on every release would be waste. Cached here so
     the app looks the same offline as online. */
  './fonts/inter-latin.woff2',
  './fonts/inter-latin-ext.woff2',
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
      .catch(() => caches.match(req).then((hit) => {
        if (hit) return hit;
        /* Offline navigation: fall back to the page they were actually asking
           for, so the app doesn't drop them on the marketing page. */
        const wantsApp = url.pathname.endsWith('/app.html');
        return caches.match(wantsApp ? './app.html' : './index.html');
      }))
  );
});
