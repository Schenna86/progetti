const CARD_ASSET_CACHE = "collectible-card-assets-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();

    await Promise.all(
      keys
        .filter(key =>
          key.startsWith("collectible-card-assets-") &&
          key !== CARD_ASSET_CACHE
        )
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

function isCollectibleAsset(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;

  // Funziona anche su GitHub Pages con repository in una sottocartella:
  // scope .../casino/cards/ -> assets .../casino/cards/assets/
  const scopePath = new URL(self.registration.scope).pathname;
  return url.pathname.startsWith(`${scopePath}assets/`);
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (!isCollectibleAsset(request)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CARD_ASSET_CACHE);

    // Usato dal pulsante AGGIORNA: forza rete e sostituisce la copia locale.
    if (request.cache === "reload" || request.cache === "no-store") {
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    }

    // Navigazione normale: cache-first.
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
