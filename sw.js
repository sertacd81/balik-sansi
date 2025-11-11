const CACHE='balik-sansi-v14';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll([
'./','./index.html','./manifest.webmanifest',
'./icons/apple-touch-icon-120.png','./icons/apple-touch-icon-152.png','./icons/apple-touch-icon-167.png','./icons/apple-touch-icon-180.png',
'./icons/icon-192.png','./icons/icon-512.png','./icons/favicon-32.png','./icons/favicon-64.png'
])))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(k1=>caches.delete(k1)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
