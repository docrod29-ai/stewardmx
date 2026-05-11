const CACHE = 'stewardmx-v50';
const SHELL = ['/guia.html', '/manifest.json', '/icons/icon-192.svg', '/icons/icon-512.svg', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Mensaje desde el cliente para forzar skipWaiting al detectar nueva versión
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Dejar pasar Firebase y Google Auth sin interceptar (no se pueden cachear — son dinámicos)
  // cdnjs y jsdelivr SÍ se cachean vía stale-while-revalidate → chart.js y xlsx funcionan offline
  if (url.includes('firebase') || url.includes('googleapis') || url.includes('gstatic')) return;

  // index.html → SIEMPRE pedirlo a la red (evita servir versiones viejas con bugs de seguridad)
  // Solo se usa cache como fallback offline.
  const isIndex = url.endsWith('/') || url.endsWith('/index.html');
  if (isIndex) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(()=>{});
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Resto: stale-while-revalidate (rápido offline, actualiza en background)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone)).catch(()=>{});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
