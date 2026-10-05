/* LUMINA : l'application s'ouvre même sans réseau (à la racine d'un domaine ou dans un sous-dossier). */
const V = 'lumina-v2';
const SCOPE = self.registration.scope;               // ex. https://site.io/  ou  https://site.io/Depot/
const BASE = new URL(SCOPE).pathname;
const SHELL = ['', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png'].map((p) => new URL(p, SCOPE).href);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (!u.pathname.startsWith(BASE)) return;
    const rel = u.pathname.slice(BASE.length);
    if (rel.startsWith('api/') || rel.startsWith('media/') || rel.startsWith('convert')) return; // toujours le réseau
    if (req.mode === 'navigate' || SHELL.includes(u.origin + u.pathname)) {
      e.respondWith(
        fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((x) => x.put(req, c)); } return r; })
          .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match(SCOPE)))
      );
    }
    return;
  }
  // Bibliothèques externes (lecteur HLS, conversion) : gardées en cache après le premier chargement.
  if (/(^|\.)cdn\.jsdelivr\.net$|(^|\.)cdnjs\.cloudflare\.com$/.test(u.host)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { const c = res.clone(); caches.open(V).then((x) => x.put(req, c)); return res; })));
  }
});
