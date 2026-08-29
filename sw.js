/* オフラインでも開けるようにアプリ本体をキャッシュする。
   利用データ（音声・文字起こし・メモ）は IndexedDB 側にあり、ここでは扱わない。 */

const CACHE = 'kioku-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/main.js',
  './js/store.js',
  './js/db.js',
  './js/ui.js',
  './js/speech.js',
  './js/recorder.js',
  './js/settings.js',
  './js/lib/model.js',
  './js/lib/search.js',
  './js/lib/export.js',
  './js/lib/time.js',
  './js/lib/stopwatch.js',
  './js/lib/transcript.js',
  './js/views/dashboard.js',
  './js/views/record.js',
  './js/views/detail.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ネットワーク優先＋キャッシュ更新。圏外ではキャッシュを返す。 */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
