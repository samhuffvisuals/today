// Offline-first service worker.
// Bump VERSION whenever you deploy changed files so phones pick up the update.
const VERSION = 'today-v14';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/store.js',
  './js/rollover.js',
  './js/haptics.js',
  './js/actions.js',
  './js/ui/icons.js',
  './js/ui/render.js',
  './js/ui/gestures.js',
  './js/ui/sheets.js',
  './js/ui/effects.js',
  './js/ui/history.js',
  './js/ui/toast.js',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache, so a new version never installs with stale files
  // (GitHub Pages serves everything with a 10-minute max-age).
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.all(ASSETS.map((u) => fetch(u, { cache: 'reload' }).then((r) => (r.ok ? c.put(u, r) : Promise.reject(new Error(`${u} ${r.status}`)))))))
      .then(() => self.skipWaiting())
  );
});

// The page can ask which version is serving it.
self.addEventListener('message', (e) => {
  if (e.data === 'version') e.source?.postMessage({ version: VERSION });
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
