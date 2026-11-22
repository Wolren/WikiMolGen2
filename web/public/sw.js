/*
 * Offline shell for WikiMolGen 2.
 *
 * The HTML is network-first, so a deploy is seen at once. Hashed assets and the large
 * vendor wasm are cache-first. Bump CACHE when this file or the shell changes.
 */
const CACHE = "wikimolgen2-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  try {
    // The build writes the hashed asset names here; a missing file still leaves the shell.
    const response = await fetch("precache-manifest.json", { cache: "no-cache" });
    if (response.ok) {
      const files = await response.json();
      await Promise.allSettled(files.map((file) => cache.add(file)));
    }
  } catch {
    // The shell above is enough to open the page.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached !== undefined) return cached;
          const shell = await caches.match("./index.html");
          if (shell !== undefined) return shell;
          return new Response("Offline", {
            status: 503,
            headers: { "content-type": "text/plain" },
          });
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached !== undefined) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
