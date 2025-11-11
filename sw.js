// v0.4.3 – icon & splash integrated; force update
const CACHE = 'balik-sansi-v13';
const ASSETS = [
  './','./index.html','./app.js?v=0.4.2','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png',
  './icons/favicon-32.png','./icons/favicon-64.png'
];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k!==CACHE).map(k => caches.delete(k)))).then(()=> self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
