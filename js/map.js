// Carte Leaflet au rendu « type Google Maps » :
//  - fond vectoriel OpenFreeMap (style Liberty) rendu par MapLibre GL, noms forcés en français ;
//    en mode mémorisation, toutes les étiquettes du fond sont masquées ;
//  - repli : tuiles OpenStreetMap si WebGL est indisponible, puis fond vectoriel officiel local
//    (toutes les voies de Paris + la Seine) si le réseau manque.
// Par-dessus : arrondissements officiels, tracés et épingles des éléments à apprendre.
import { DB, CATS } from "./data.js";
import { S } from "./store.js";
import { esc, arrLabel } from "./util.js";

const L = window.L;
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const ATTR_GL = '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ATTR_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const OSM_TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const PARIS_BOUNDS = [[48.8155, 2.2242], [48.9022, 2.4699]];
const PARIS_CENTER = [48.8586, 2.3470];

/** Nom court d'une porte pour la vue d'ensemble : « Porte de la Chapelle » -> « Chapelle ». */
export function porteShort(name) {
  return name.replace(/^Porte\s+(?:de\s+la\s+|de\s+l['’]|de\s+|d['’]|des\s+|du\s+)?/i, "");
}
/** Côté où placer l'étiquette d'une porte : vers l'extérieur de Paris. */
function porteSide(pt) {
  const dy = pt[0] - PARIS_CENTER[0], dx = (pt[1] - PARIS_CENTER[1]) * Math.cos((PARIS_CENTER[0] * Math.PI) / 180);
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx > 0 ? "e" : "w") : dy > 0 ? "n" : "s";
}
const PORTE_TRY = { n: ["n", "e", "w"], s: ["s", "e", "w"], e: ["e", "n", "s"], w: ["w", "n", "s"] };

/** Couleurs des tracés, choisies pour un fond clair. */
export const STYLE_COL = { focus: "#1a73e8", good: "#188038", bad: "#d93025", hint: "#e37400" };
export const arrColor = (n) => `hsl(${(n * 137.508) % 360} 58% 40%)`;

// ------------------------------------------------------------------ fond vectoriel (WebGL)

export const GL_OK = (() => {
  try {
    const c = document.createElement("canvas");
    return !!(window.maplibregl && L.maplibreGL && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
})();

let stylePromise = null;
export function loadStyle() {
  stylePromise ||= fetch(STYLE_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((s) => {
      for (const l of s.layers) {
        const tf = l.layout?.["text-field"];
        if (tf && JSON.stringify(tf).includes("name")) l.layout["text-field"] = ["coalesce", ["get", "name:fr"], ["get", "name"]];
      }
      return s;
    })
    .catch((e) => { stylePromise = null; throw e; });
  return stylePromise;
}
/** Couches « transports » du fond (arrêts de bus, stations) : masquées sauf réglage contraire. */
export const isTransitLayer = (id) => /transit|airport|railway.*(label|name)/.test(id);
export const POLICE_COL = "#0b3d91";

/** Pastilles de police : commissariats (grandes, bouclier) et autres sites de police nationale. */
export function policeHTML(p) {
  return `<strong>${esc(p.name)}</strong><small>${p.addr ? esc(p.addr) + " · " : ""}${arrLabel(p.arr)} arrondissement</small><small class="src">Source : OpenStreetMap (${esc(p.osm)}), à vérifier</small>`;
}

export const labelLayerIds = (style) => style.layers.filter((l) => l.type === "symbol" && !l.id.startsWith("road_one_way")).map((l) => l.id);

// ------------------------------------------------------------------ fond de secours local

let CTX = null;
function contextShapes() {
  if (CTX || !DB.context) return CTX;
  const pairs = (a) => { const o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };
  const major = [], minor = [];
  for (const s of DB.context.streets) (s[0] === 0 ? major : minor).push(pairs(s.slice(2)));
  CTX = { major, minor, water: DB.context.water.map((poly) => poly.map(pairs)) };
  return CTX;
}

// ------------------------------------------------------------------ épingles

const GLYPH = {
  monument: "M4 10h16L12 4.5zM6 11h2.4v6H6zm4.8 0h2.4v6h-2.4zm4.8 0H18v6h-2.4zM4 18h16v2H4z",
  gare: "M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm0 3v4h10V6zm1 7a1.3 1.3 0 1 0 0 2.6A1.3 1.3 0 0 0 8 13zm8 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zM7 19h2l-2 3H5zm8 0h2l2 3h-2z",
  parc: "M12 2l6 9h-3l4 6H5l4-6H6zm-1 15h2v5h-2z",
  eau: "M2 14c3-3 5-3 8 0s5 3 8 0 4-2 4-2v4s-1 1-4 2c-3 3-5 3-8 0s-5-3-8 0zm0-6c3-3 5-3 8 0s5 3 8 0 4-2 4-2v3s-1 1-4 2c-3 3-5 3-8 0s-5-3-8 0z",
  place: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
  porte: "M3 21V10a9 9 0 0 1 18 0v11h-5v-9a4 4 0 0 0-8 0v9z",
  police: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zm0 5l-1.2 2.6-2.8.3 2.1 1.9-.6 2.8 2.5-1.4 2.5 1.4-.6-2.8 2.1-1.9-2.8-.3z",
};

/** SVG d'une épingle à pictogramme (partagé avec la vue 3D). */
export function pinSVG(cat, color, s = 30) {
  const g = GLYPH[cat] || GLYPH.monument;
  return `<svg viewBox="0 0 32 40" width="${s}" height="${s * 1.25}" aria-hidden="true">
      <path d="M16 39C16 39 3 24.5 3 15a13 13 0 0 1 26 0c0 9.5-13 24-13 24z" fill="${color}" stroke="#fff" stroke-width="2"/>
      <g transform="translate(8 6.5) scale(.667)"><path d="${g}" fill="#fff"/></g></svg>`;
}

function pinIcon(it, color, { big = false, pulse = false, muted = false } = {}) {
  const s = big ? 40 : 30;
  return L.divIcon({
    className: `mpin cat-${it.cat}${pulse ? " pulse" : ""}${muted ? " muted" : ""}`,
    iconSize: [s, s * 1.25],
    iconAnchor: [s / 2, s * 1.2],
    html: pinSVG(it.cat, color, s),
  });
}

// ------------------------------------------------------------------ carte

export function createMap(el, { labels = true, arrNumbers = true, arrFill = true, police = false, photos = false, farPins = false } = {}) {
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    minZoom: 11,
    maxZoom: 18.5,
    maxBounds: [[48.76, 2.12], [48.96, 2.58]],
    maxBoundsViscosity: 0.8,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,
    tap: true,
  });
  map.fitBounds(PARIS_BOUNDS); // une vue est nécessaire avant d'ajouter des calques
  L.control.zoom({ position: "topright" }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution("Voies et limites : Ville de Paris");

  let destroyed = false;
  let showLabels = labels;
  const notice = document.createElement("div");
  notice.className = "map-offline";
  notice.textContent = "Fond de carte indisponible : plan simplifié (tracés officiels, sans noms).";
  el.appendChild(notice);

  // 1. fond local, toujours présent sous le reste (visible tant que le fond détaillé charge)
  map.createPane("context");
  map.getPane("context").style.zIndex = 150;
  const ctxRenderer = L.canvas({ pane: "context", padding: 0.4 });
  const cs = contextShapes();
  if (cs) {
    L.polygon(cs.water, { renderer: ctxRenderer, pane: "context", stroke: false, fillColor: "#aadaff", fillOpacity: 1, interactive: false }).addTo(map);
    L.polyline(cs.minor, { renderer: ctxRenderer, pane: "context", color: "#ffffff", weight: 1.4, interactive: false }).addTo(map);
    L.polyline(cs.major, { renderer: ctxRenderer, pane: "context", color: "#fde293", weight: 3, interactive: false }).addTo(map);
  }

  // 2. fond détaillé
  let gl = null, glStyle = null, osm = null;
  const offline = (on) => el.classList.toggle("tiles-off", on);
  function setOsm(on) {
    if (osm) { map.removeLayer(osm); osm = null; }
    if (!on) return;
    let ok = 0, ko = 0;
    osm = L.tileLayer(OSM_TILE, { maxZoom: 19, attribution: ATTR_OSM });
    osm.on("tileload", () => { ok++; offline(false); });
    osm.on("tileerror", () => { if (++ko >= 4 && !ok) offline(true); });
    osm.addTo(map);
  }
  function applyGlLabels() {
    const mm = gl?.getMaplibreMap();
    if (!mm || !glStyle) return;
    const vis = showLabels ? "visible" : "none";
    for (const id of labelLayerIds(glStyle)) if (mm.getLayer(id)) mm.setLayoutProperty(id, "visibility", isTransitLayer(id) && !S.settings.transit ? "none" : vis);
  }
  if (GL_OK) {
    loadStyle()
      .then((style) => {
        if (destroyed) return;
        glStyle = style;
        const s = structuredClone(style);
        for (const l of s.layers) if (labelLayerIds(style).includes(l.id) && (!showLabels || (isTransitLayer(l.id) && !S.settings.transit))) (l.layout ||= {}).visibility = "none";
        gl = L.maplibreGL({ style: s, attributionControl: false, interactive: false, fadeDuration: 0 }).addTo(map);
        map.attributionControl.addAttribution(ATTR_GL);
        gl.getMaplibreMap().on("error", () => {}); // tuile manquante : le fond local reste visible dessous
      })
      .catch(() => { if (!destroyed) { if (showLabels) setOsm(true); else offline(!cs); } });
  } else if (showLabels) setOsm(true);

  // 3. arrondissements et calques de travail
  const arrGroup = L.layerGroup().addTo(map);
  const arrLabels = L.layerGroup();
  const overlay = L.layerGroup().addTo(map);
  const labelsLayer = L.layerGroup().addTo(map);
  const policeLayer = L.layerGroup();

  function drawPolice() {
    policeLayer.clearLayers();
    for (const p of DB.police?.items || []) {
      const big = p.type !== "police";
      const icon = L.divIcon({ className: `ppin ${p.type}`, iconSize: big ? [26, 32] : [18, 22], iconAnchor: big ? [13, 31] : [9, 21], html: pinSVG("police", POLICE_COL, big ? 26 : 18) });
      L.marker(p.at, { icon, keyboard: false, zIndexOffset: -100, title: p.name })
        .bindPopup(`<div class="gpop-body">${policeHTML(p)}</div>`, { className: "gpop", closeButton: false })
        .addTo(policeLayer);
    }
  }
  if (police && DB.police) { drawPolice(); policeLayer.addTo(map); }

  // étiquettes de suites : si deux pastilles se chevauchent, la seconde ne garde que son numéro
  function declutter() {
    const spans = [...el.querySelectorAll(".seqm span")];
    spans.forEach((sp) => sp.classList.remove("tight"));
    const kept = [];
    for (const sp of spans) {
      const r = sp.getBoundingClientRect();
      if (kept.some((k) => !(r.right < k.left - 2 || r.left > k.right + 2 || r.bottom < k.top - 1 || r.top > k.bottom + 1))) sp.classList.add("tight");
      else kept.push(r);
    }
  }
  map.on("zoomend", () => !destroyed && declutter());

  // vue d'ensemble : épingles réduites, pour que les noms des portes restent lisibles
  const FAR_ZOOM = 12;
  const updateFar = () => { if (farPins && !destroyed) el.classList.toggle("far", map.getZoom() < FAR_ZOOM); };
  map.on("zoomend", updateFar);
  updateFar();

  // étiquettes courtes des portes : celles qui en chevauchent une autre sont masquées (le zoom les révèle)
  let porteRaf = 0;
  function declutterPortes() {
    porteRaf = 0;
    if (destroyed) return;
    const spans = [...el.querySelectorAll(".lbl-porte span")];
    spans.forEach((sp) => sp.classList.remove("lbl-hide"));
    const kept = [];
    const hits = (r) => kept.some((k) => !(r.right < k.left - 3 || r.left > k.right + 3 || r.bottom < k.top - 1 || r.top > k.bottom + 1));
    const setSide = (box, side) => { box.classList.remove("lbl-n", "lbl-s", "lbl-e", "lbl-w"); box.classList.add(`lbl-${side}`); };
    for (const sp of spans) {
      const box = sp.parentElement;
      const first = box.dataset.side;
      // côté extérieur d'abord, puis les côtés perpendiculaires ; masquée seulement si aucun ne convient
      let placed = false;
      for (const side of PORTE_TRY[first] || [first]) {
        setSide(box, side);
        const r = sp.getBoundingClientRect();
        if (!hits(r)) { kept.push(r); placed = true; break; }
      }
      if (!placed) { setSide(box, first); sp.classList.add("lbl-hide"); }
    }
  }
  const queuePortes = () => { if (!porteRaf) porteRaf = requestAnimationFrame(declutterPortes); };

  function drawArrs(sel = null) {
    arrGroup.clearLayers();
    for (const a of DB.arrs) {
      const on = sel === null || a.n === sel;
      L.polygon(a.rings, {
        color: arrColor(a.n), weight: on && sel !== null ? 3 : 1.6, opacity: on ? 0.75 : 0.3,
        dashArray: sel !== null && a.n === sel ? null : "6 5",
        fillColor: arrColor(a.n), fillOpacity: on && sel !== null ? 0.1 : arrFill ? 0.035 : 0, interactive: false,
      }).addTo(arrGroup);
    }
  }
  drawArrs();
  for (const a of DB.arrs) {
    L.marker(a.center, {
      interactive: false,
      icon: L.divIcon({ className: "arr-num", html: `<span style="--c:${arrColor(a.n)}">${a.label}</span>`, iconSize: null }),
    }).addTo(arrLabels);
  }
  if (arrNumbers) arrLabels.addTo(map);

  const api = {
    map,
    el,
    get labels() { return showLabels; },
    setLabels(on) {
      showLabels = on;
      if (gl) applyGlLabels();
      else if (!GL_OK || !glStyle) setOsm(on);
    },
    setPolice(on) {
      if (on && DB.police) { if (!policeLayer.getLayers().length) drawPolice(); policeLayer.addTo(map); }
      else map.removeLayer(policeLayer);
    },
    setArrNumbers(on) {
      on ? arrLabels.addTo(map) : map.removeLayer(arrLabels);
    },
    clear() {
      overlay.clearLayers();
      labelsLayer.clearLayers();
    },
    /**
     * Dessine un élément.
     * style : "normal" | "focus" | "good" | "bad" | "muted" | "hint"
     */
    draw(it, { style = "normal", label = false, onClick = null, group = overlay, animate = false } = {}) {
      const col = STYLE_COL[style] || (CATS[it.cat] || CATS.voie).color;
      const muted = style === "muted";
      const strong = style !== "normal" && !muted;
      const z = map.getZoom();
      const zf = z < 12.5 ? 0.65 : z < 14 ? 0.85 : 1;
      const w = (strong ? 7 : 4.5) * zf;
      const layers = [];
      const click = (e) => { L.DomEvent.stop(e); onClick(it); };
      for (const line of it.geom.lines) {
        if (!muted) layers.push(L.polyline(line, { color: "#fff", weight: w + 4, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false, className: animate ? "draw-anim" : "" }));
        layers.push(L.polyline(line, { color: col, weight: w, opacity: muted ? 0.4 : 1, lineCap: "round", lineJoin: "round", interactive: false, className: `${strong ? "glow" : ""}${animate ? " draw-anim" : ""}` }));
        if (onClick) layers.push(L.polyline(line, { color: "#000", weight: 24, opacity: 0.001, className: "hit" }).on("click", click));
      }
      for (const poly of it.geom.polys) {
        const p = L.polygon(poly, { color: col, weight: strong ? 3 : 2, opacity: muted ? 0.45 : 1, fillColor: col, fillOpacity: muted ? 0.08 : strong ? 0.28 : 0.18, interactive: !!onClick });
        if (onClick) p.on("click", click);
        layers.push(p);
      }
      if (it.isLandmark || it.isPlace || !it.geom.lines.length) {
        const m = L.marker(it.point, {
          icon: pinIcon(it, col, { big: strong, pulse: style === "focus", muted }),
          interactive: !!onClick, keyboard: false, riseOnHover: true, zIndexOffset: strong ? 1000 : 0,
        });
        if (onClick) m.on("click", click);
        if (photos && it.photo && (style === "normal" || style === "muted")) {
          m.bindTooltip(`<img src="${esc(it.photo.src)}" alt="" loading="lazy"><span>${esc(it.name)}</span>`, { direction: "top", offset: [0, -34], className: "phototip", opacity: 1 });
        }
        layers.push(m);
      }
      const g = L.featureGroup(layers).addTo(group);
      // l'effet de tracé repose sur un pointillé géant : on le retire une fois l'animation finie
      if (animate) setTimeout(() => layers.forEach((l) => l._path?.classList.remove("draw-anim")), 2400);
      if (label) api.label(it, style, { short: label === "short" });
      return g;
    },
    /** Étiquette d'un élément ; `short` (portes, vue d'ensemble) : nom court placé vers l'extérieur. */
    label(it, style = "normal", { short = false } = {}) {
      const pinned = it.isLandmark || it.isPlace || !it.geom.lines.length;
      const side = porteSide(it.point);
      const cls = short ? `lbl lbl-porte lbl-${side}` : `lbl lbl-${style}${pinned ? " lbl-pin" : ""}`;
      const mk = L.marker(it.point, {
        interactive: false,
        icon: L.divIcon({ className: cls, html: `<span>${esc(short ? porteShort(it.name) : it.name)}</span>`, iconSize: null }),
        zIndexOffset: short ? 1800 : 2000,
        title: short ? it.name : "",
      }).addTo(labelsLayer);
      if (short) { const e = mk.getElement(); if (e) e.dataset.side = side; queuePortes(); }
    },
    /**
     * Pastilles d'une suite de croisements : [{ at, label, n?, style? }].
     * `stagger` (ms) les fait apparaître une à une, dans l'ordre du trajet.
     */
    marks(list, { stagger = 0 } = {}) {
      list.forEach((m, i) => {
        const st = m.style || "hint";
        const html = `<span style="--d:${i * stagger}ms">${m.n ? `<b>${m.n}</b>` : ""}${st === "muted" ? "" : `<em>${esc(m.label)}</em>`}</span>`;
        L.marker(m.at, { interactive: false, zIndexOffset: st === "muted" ? 1500 : 2500, title: m.label, icon: L.divIcon({ className: `seqm seqm-${st}`, html, iconSize: null }) }).addTo(labelsLayer);
      });
      setTimeout(() => !destroyed && declutter(), list.length * stagger + 450);
    },
    marker(latlng, cls = "pin") {
      return L.marker(latlng, { interactive: false, icon: L.divIcon({ className: cls, html: "<span></span>", iconSize: null }), zIndexOffset: 3000 }).addTo(overlay);
    },
    dashed(a, b) {
      return L.polyline([a, b], { color: STYLE_COL.focus, weight: 3, dashArray: "2 8", lineCap: "round", interactive: false, className: "draw-in" }).addTo(overlay);
    },
    ring(latlng, radius, color = STYLE_COL.hint) {
      return L.circle(latlng, { radius, color, weight: 2, fillColor: color, fillOpacity: 0.12, interactive: false }).addTo(overlay);
    },
    /** Cadre les éléments ; `inset` = { top, bottom, right } réserve la place d'un panneau superposé. */
    fit(items, { pad = 40, maxZoom = 16.5, inset = null } = {}) {
      if (destroyed) return;
      const pts = items.flatMap((it) => [it.point, ...it.geom.lines.flat(), ...it.geom.polys.flat(2)]);
      if (!pts.length) return;
      map.invalidateSize(); // la taille réelle du conteneur peut avoir changé depuis la création
      const o = { maxZoom, animate: true };
      if (inset) { o.paddingTopLeft = [pad, pad + (inset.top || 0)]; o.paddingBottomRight = [pad + (inset.right || 0), pad + (inset.bottom || 0)]; }
      else o.padding = [pad, pad];
      map.flyToBounds(L.latLngBounds(pts), { ...o, duration: 0.6 });
    },
    fitLatLngs(pts, { pad = 40, maxZoom = 16.5 } = {}) {
      if (destroyed) return;
      map.invalidateSize();
      map.flyToBounds(L.latLngBounds(pts), { padding: [pad, pad], maxZoom, duration: 0.6 });
    },
    fitArr(n) {
      if (destroyed) return;
      const a = DB.arrs.find((x) => x.n === n);
      map.flyToBounds(L.latLngBounds(a.rings[0]), { padding: [20, 20], duration: 0.6 });
    },
    /** Vue d'ensemble ; `inset.top` réserve la place de la barre d'outils pour que les portes du nord restent visibles. */
    fitParis({ inset = null } = {}) {
      if (destroyed) return;
      map.invalidateSize();
      const top = inset?.top || 0;
      map.fitBounds(PARIS_BOUNDS, { paddingTopLeft: [10, 10 + top], paddingBottomRight: [10, 10] });
      updateFar();
    },
    highlightArr(n) {
      drawArrs(n);
    },
    refresh() {
      setTimeout(() => !destroyed && map.invalidateSize(), 0);
    },
    destroy() {
      destroyed = true;
      try {
        map.stop();
        map.off();
        // une fin d'animation de zoom déjà programmée ne doit plus toucher la carte
        map._animatingZoom = false;
        map._onZoomTransitionEnd = () => {};
        map._catchTransitionEnd = () => {};
      } catch { /* déjà détachée */ }
      // Leaflet termine ses animations de zoom par un minuteur de 250 ms : supprimer la carte
      // avant provoque une erreur interne. On attend donc la fin de l'animation.
      setTimeout(() => { try { map.remove(); } catch { /* déjà supprimée */ } }, 700);
    },
  };
  return api;
}
