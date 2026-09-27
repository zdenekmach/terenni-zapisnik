// Offline: aplikace se po první návštěvě spouští z mezipaměti. Seznamy druhů
// sem nepatří — aplikace si je ukládá sama do IndexedDB (nastavení → země).
// Při změně kterékoli části aplikace zvýšit VERZE, jinak telefon drží starou.
const VERZE = 'zapisnik-0.2.0';
const SOUBORY = ['./', 'index.html', 'app.js', 'styly.css', 'manifest.webmanifest',
  'ikony/ikona-180.png', 'ikony/ikona-192.png', 'ikony/ikona-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERZE).then(c => c.addAll(SOUBORY)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(x => x !== VERZE).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.includes('/data/')) return;          // vždy ze sítě
  e.respondWith(caches.match(e.request, {ignoreSearch: true})
    .then(r => r || fetch(e.request).catch(() => caches.match('index.html'))));
});
