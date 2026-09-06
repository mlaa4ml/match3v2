// sw.js — минимальный service worker: кеширует "оболочку" приложения, чтобы
// установленная игра открывалась и работала без интернета. Стратегия
// простая (cache-first с фоновым обновлением) — этого достаточно для
// статичной игры без бэкенда.

const CACHE_NAME = "match3-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./stats.html",
  "./style.css",
  "./manifest.json",
  "./src/main.js",
  "./src/render.js",
  "./src/statsPage.js",
  "./src/game/board.js",
  "./src/game/session.js",
  "./src/stats/index.js",
  "./src/stats/statsProvider.js",
  "./src/stats/localStorageProvider.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached); // офлайн и не в кеше — тогда просто ничего не поделать
      return cached || network;
    })
  );
});
