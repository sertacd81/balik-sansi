self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('balik-sansi-v7').then(cache => cache.addAll([
    './','./index.html','./styles.css','./app.js?v=0.3.0','./manifest.webmanifest'
  ])));
});
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(resp => resp || fetch(e.request)));
});
