'use strict';

const CACHE_PREFIX = 'tong-hop-so-lieu-y-te-firebase-';
const CACHE_NAME = CACHE_PREFIX + 'v8.1.0';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=8.1.0',
  './ui-fixes.css?v=8.1.0',
  './reports.css?v=8.1.0',
  './journeys.css?v=8.1.0',
  './app-config.js?v=8.1.0',
  './app.js?v=8.1.0',
  './reports.js?v=8.1.0',
  './journeys.js?v=8.1.0',
  './ui-fixes.js?v=8.1.0',
  './manifest.webmanifest',
  './offline.html',
  './assets/favicon-32.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./offline.html')))
    );
    return;
  }

  const networkFirst = /(?:app-config|app|reports|journeys)\.js$/.test(url.pathname);
  if (networkFirst) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});
