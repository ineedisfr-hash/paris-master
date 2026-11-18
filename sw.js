// Service worker : application et données disponibles hors connexion ;
// les tuiles de fond de carte déjà vues sont gardées en cache (limité).
const VERSION = "pm-v5";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/app.css", "data/paris.json", "data/context.json", "data/police.json",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "vendor/maplibre/maplibre-gl.js", "vendor/maplibre/maplibre-gl.css", "vendor/maplibre/leaflet-maplibre-gl.js", "icons/icon.svg",
  "js/main.js", "js/data.js", "js/util.js", "js/geo.js", "js/store.js", "js/map.js", "js/fiche.js",
  "js/questions.js", "js/session.js", "js/fx.js", "js/map3d.js",
  "js/views/dashboard.js", "js/views/explore.js", "js/views/levels.js", "js/views/learn.js",
  "js/views/play.js", "js/views/stats.js", "js/views/badges.js", "js/views/settings.js",
];
const TILES = "pm-tiles";
const MAX_TILES = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  if (url.hostname === "tile.openstreetmap.org" || url.hostname === "tiles.openfreemap.org") {
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === "opaque") { c.put(e.request, res.clone()); trimTiles(); }
        return res;
      }),
    );
    return;
  }

  if (url.origin === location.origin) {
    // réseau d'abord (pour recevoir les mises à jour), cache en secours hors connexion
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))),
    );
  }
});
