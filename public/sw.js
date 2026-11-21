const CACHE_NAME = "eira-seguro-shell-v1";
const APP_SHELL_ASSETS = ["/kiosco", "/paciente", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        APP_SHELL_ASSETS.map(async (assetUrl) => {
          try {
            const response = await fetch(assetUrl, { cache: "no-cache" });
            if (response && response.ok) {
              await cache.put(assetUrl, response.clone());
            }
          } catch {
            // Skip unreachable asset during initial install
          }
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((legacyKey) => caches.delete(legacyKey))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated medical APIs or PDF streams in Service Worker cache
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  const isAppShellOrStatic =
    request.mode === "navigate" ||
    APP_SHELL_ASSETS.includes(url.pathname) ||
    url.pathname.startsWith("/_next/static/");

  if (!isAppShellOrStatic) return;

  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok && networkResponse.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone()).catch(() => {});
        }
        return networkResponse;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === "navigate") {
          const fallbackKiosk = await caches.match("/kiosco");
          if (fallbackKiosk) return fallbackKiosk;
          const fallbackPatient = await caches.match("/paciente");
          if (fallbackPatient) return fallbackPatient;
        }

        return new Response(
          "EIRA Resultados Seguros: modo sin conexión activo. Usa la caché local sincronizada en /kiosco.",
          {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }
    })()
  );
});
