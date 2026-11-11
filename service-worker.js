/* =========================================================================
   service-worker.js — fait fonctionner l'application SANS RÉSEAU.

   ► POUR PUBLIER UNE MISE À JOUR : changez le numéro ci-dessous
     (ex. 'v1.0.1'), puis envoyez les fichiers modifiés sur GitHub.
     Le téléphone verra que ce fichier a changé, téléchargera la nouvelle
     version et supprimera l'ancienne.
   ========================================================================= */
var VERSION = 'v1.0.0';

var CACHE = 'entrainement-' + VERSION;
var FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './timer-engine.js',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

// Installation : on télécharge tous les fichiers (en ignorant le cache HTTP)
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

// Activation : on supprime les anciennes versions
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('entrainement-') === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Requêtes : d'abord le cache (instantané, hors ligne), sinon le réseau
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () {
          if (req.mode === 'navigate') return cache.match('./index.html');
          return new Response('', { status: 504, statusText: 'Hors ligne' });
        });
      });
    })
  );
});
