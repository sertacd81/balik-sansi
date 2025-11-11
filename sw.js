self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('balik-sansi-v8').then(cache => cache.addAll([
    './','./index.html','./styles.css','./app.js?v=0.3.1','./manifest.webmanifest'
  ])));
});
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(resp => resp || fetch(e.request)));
});
