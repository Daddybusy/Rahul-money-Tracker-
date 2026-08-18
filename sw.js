const CACHE_NAME = "rma-money-tracker-v1";

const STATIC_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /*
    Do not manually cache Firebase/Firestore private data.
  */
  if (
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("firebaseapp.com")
  ) {
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) {
          return cached;
        }

        return fetch(request)
          .then((response) => {
            if (
              !response ||
              response.status !== 200 ||
              response.type === "opaque"
            ) {
              return response;
            }

            const copy = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, copy);
              });

            return response;
          })
          .catch(() => {
            return caches.match("./index.html");
          });
      })
  );
});