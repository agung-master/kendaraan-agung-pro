/* Enzy_Gempa Pro: service worker.
   Menyimpan aset aplikasi (halaman + pustaka CDN) supaya aplikasi tetap terbuka saat tanpa sinyal.
   Data (API Apps Script) TIDAK disentuh di sini: permintaan POST/skrip Google selalu lewat jaringan.
   Cadangan data & antrean input offline ditangani oleh index.html (localStorage). */
const VERSION = 'v1';
const CORE = 'enzy-core-' + VERSION;
const RUNTIME = 'enzy-rt-' + VERSION;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const PRECACHE = [
  './',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE);
    // satu per satu: gagal memuat satu berkas tidak menggagalkan pemasangan
    await Promise.all(PRECACHE.map(async url => {
      try {
        const req = new Request(url, /^https?:/.test(url) ? { mode: 'no-cors' } : {});
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) await cache.put(req, res);
      } catch (e) { /* abaikan */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [CORE, RUNTIME];
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.indexOf('enzy-') === 0 && keep.indexOf(n) === -1).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(CORE);
  try {
    // jaringan lemah: tunggu paling lama 5 detik, lalu pakai salinan tersimpan bila ada
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
    ]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(req)) || (await cache.match('./')) || (await caches.match(req));
    if (hit) return hit;
    return new Response('Offline dan halaman belum tersimpan. Buka aplikasi sekali saat online.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(RUNTIME);
  const cached = (await cache.match(req)) || (await caches.match(req));
  const update = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(update); return cached; }
  return (await update) || Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // POST ke Apps Script: biarkan lewat jaringan
  let url; try { url = new URL(req.url); } catch (e) { return; }
  if (req.mode === 'navigate' && url.origin === self.location.origin) { event.respondWith(networkFirst(req)); return; }
  if (url.origin === self.location.origin || CDN_HOSTS.indexOf(url.hostname) !== -1) { event.respondWith(staleWhileRevalidate(event)); }
  // selain itu (peta OSM, Nominatim, Overpass, Google): tidak dicegat
});
