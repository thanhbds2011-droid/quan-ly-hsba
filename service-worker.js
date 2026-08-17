'use strict';

const APP_VERSION = '9.5.7';
const CACHE_PREFIX = 'tong-hop-so-lieu-y-te-firebase-';
const CACHE_NAME = CACHE_PREFIX + 'v' + APP_VERSION;
const LEGACY_CACHE_NAMES = new Set(['yte-tan-hiep-v5']);
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=9.5.7',
  './reports.css?v=9.5.7',
  './journeys.css?v=9.5.7',
  './app-config.js?v=9.5.7',
  './ui.js?v=9.5.7',
  './update-manager.js?v=9.5.7',
  './app.js?v=9.5.7',
  './reports.js?v=9.5.7',
  './journeys.js?v=9.5.7',
  './version.json',
  './manifest.webmanifest',
  './offline.html',
  './assets/favicon-32.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) =>
          (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) ||
          LEGACY_CACHE_NAMES.has(key)
        ).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'YTE_SW_VERSION', version: APP_VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./offline.html')))
    );
    return;
  }

  // Code/version files luôn ưu tiên mạng để các máy nhận source mới nhanh nhất.
  const networkFirst = /\.(?:js|css|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/version.json');
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
