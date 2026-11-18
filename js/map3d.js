// Vue 3D (MapLibre GL natif) : carte inclinable et orientable, bâtiments en relief
// (hauteurs réelles OpenStreetMap), ciel, tracés et épingles des éléments, survol à 360°.
import { DB, CATS, item } from "./data.js";
import { loadStyle, labelLayerIds, pinSVG, arrColor, STYLE_COL, isTransitLayer, POLICE_COL, policeHTML, porteShort } from "./map.js";
import { S } from "./store.js";
import { esc } from "./util.js";

const ml = () => window.maplibregl;
const toLngLat = ([lat, lng]) => [lng, lat];
const HOME = { center: [2.3430, 48.8590], zoom: 12.6, pitch: 55, bearing: -17 };
const MAX_TILT = 75;

let FC = null;
function itemsGeoJSON() {
  if (FC) return FC;
  const features = [];
  for (const it of DB.items) {
    const props = { id: it.id, cat: it.cat, name: it.name, short: it.isPorte ? porteShort(it.name) : it.name, color: (CATS[it.cat] || CATS.voie).color, arr: it.arr };
    for (const l of it.geom.lines) features.push({ type: "Feature", properties: { ...props, kind: "line" }, geometry: { type: "LineString", coordinates: l.map(toLngLat) } });
    for (const p of it.geom.polys) features.push({ type: "Feature", properties: { ...props, kind: "poly" }, geometry: { type: "Polygon", coordinates: p.map((r) => r.map(toLngLat)) } });
    features.push({ type: "Feature", properties: { ...props, kind: "pt" }, geometry: { type: "Point", coordinates: toLngLat(it.point) } });
  }
  const arrs = DB.arrs.map((a) => ({ type: "Feature", properties: { n: a.n, label: a.label, color: arrColor(a.n) }, geometry: { type: "Polygon", coordinates: a.rings.map((r) => r.map(toLngLat)) } }));
  const arrPts = DB.arrs.map((a) => ({ type: "Feature", properties: { label: a.label, color: arrColor(a.n) }, geometry: { type: "Point", coordinates: toLngLat(a.center) } }));
  FC = { items: { type: "FeatureCollection", features }, arrs: { type: "FeatureCollection", features: arrs }, arrPts: { type: "FeatureCollection", features: arrPts } };
  return FC;
}

/**
 * @param el conteneur
 * @param opts { labels, onItemClick(it), onMapClick({lat,lng}, lngLat) }
 */
export function create3D(el, { labels = true, onItemClick = null, onMapClick = null } = {}) {
  let map = null, style = null, destroyed = false, showLabels = labels;
  let filt = { cats: Object.keys(CATS), arr: null };
  let selected = null, lastItemClick = 0;
  const markers = [];
  const itemClick = (it) => { lastItemClick = Date.now(); onItemClick?.(it); };

  const ready = loadStyle().then((base) => {
    if (destroyed) return null;
    style = base;
    const s = structuredClone(base);
    // bâtiments plus présents en 3D, ciel et brume à l'horizon
    const b3d = s.layers.find((l) => l.id === "building-3d");
    if (b3d) {
      // la tour Eiffel n'est décrite que par son emprise et sa hauteur : extrudée, elle deviendrait
      // un bloc plein de 330 m. On écarte du relief ce cas (> 250 m) ; son épingle reste visible.
      b3d.filter = ["all", b3d.filter, ["<", ["coalesce", ["get", "render_height"], 0], 250]];
      b3d.minzoom = 13.5; b3d.paint["fill-extrusion-opacity"] = 0.92; b3d.paint["fill-extrusion-color"] = ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0], 0, "#e8e2d6", 30, "#ddd3c2", 80, "#cfc3ae"]; }
    s.sky = { "sky-color": "#9fcbff", "sky-horizon-blend": 0.5, "horizon-color": "#eaf3ff", "horizon-fog-blend": 0.6, "fog-color": "#eef2f6", "fog-ground-blend": 0.75 };
    for (const l of s.layers) if (labelLayerIds(base).includes(l.id) && (!showLabels || (isTransitLayer(l.id) && !S.settings.transit))) (l.layout ||= {}).visibility = "none";

    map = new (ml().Map)({
      container: el, style: s, ...HOME, maxPitch: MAX_TILT, minZoom: 10.5, maxZoom: 19,
      maxBounds: [[2.10, 48.75], [2.60, 48.97]], attributionControl: false, fadeDuration: 0,
    });
    map.addControl(new (ml().NavigationControl)({ visualizePitch: true, showCompass: true }), "top-right");
    map.addControl(new (ml().AttributionControl)({ compact: true, customAttribution: "Voies et limites : Ville de Paris" }), "bottom-right");

    return new Promise((resolve) => map.on("load", () => {
      if (destroyed) return resolve(null);
      const fc = itemsGeoJSON();
      const firstLabel = s.layers.find((l) => l.type === "symbol")?.id;
      const under3d = map.getLayer("building-3d") ? "building-3d" : firstLabel; // emprises sous le relief
      map.addSource("pm-items", { type: "geojson", data: fc.items });
      map.addSource("pm-arrs", { type: "geojson", data: fc.arrs });
      map.addSource("pm-arrpts", { type: "geojson", data: fc.arrPts });
      map.addLayer({ id: "pm-arr", type: "line", source: "pm-arrs", paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.7, "line-dasharray": [3, 2] } }, firstLabel);
      map.addLayer({ id: "pm-arr-sel", type: "fill", source: "pm-arrs", filter: ["==", ["get", "n"], -1], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 } }, firstLabel);
      map.addLayer({ id: "pm-poly", type: "fill", source: "pm-items", filter: ["==", ["get", "kind"], "poly"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.28 } }, under3d);
      map.addLayer({ id: "pm-poly-line", type: "line", source: "pm-items", filter: ["==", ["get", "kind"], "poly"], paint: { "line-color": ["get", "color"], "line-width": 2.5 } }, under3d);
      map.addLayer({ id: "pm-case", type: "line", source: "pm-items", filter: ["==", ["get", "kind"], "line"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 11] } });
      map.addLayer({ id: "pm-line", type: "line", source: "pm-items", filter: ["==", ["get", "kind"], "line"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 7] } });
      map.addLayer({ id: "pm-sel-case", type: "line", source: "pm-items", filter: ["==", ["get", "id"], ""], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 8, 16, 16] } });
      map.addLayer({ id: "pm-sel", type: "line", source: "pm-items", filter: ["==", ["get", "id"], ""], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": STYLE_COL.focus, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 10] } });
      map.addLayer({ id: "pm-hit", type: "line", source: "pm-items", filter: ["==", ["get", "kind"], "line"], paint: { "line-color": "#000", "line-opacity": 0.001, "line-width": 24 } });
      map.addLayer({ id: "pm-arr-num", type: "symbol", source: "pm-arrpts", maxzoom: 14, layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 15 }, paint: { "text-color": ["get", "color"], "text-halo-color": "#fff", "text-halo-width": 2 } });
      map.addLayer({ id: "pm-label", type: "symbol", source: "pm-items", filter: ["all", ["==", ["get", "kind"], "pt"], ["!=", ["get", "cat"], "porte"]], minzoom: 13.5,
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true, visibility: showLabels ? "visible" : "none" },
        paint: { "text-color": "#202124", "text-halo-color": "#fff", "text-halo-width": 2 } });
      // portes : blanc sur fond sombre (comme leurs épingles), nom court de loin, nom complet de près ;
      // prioritaires sur les noms du fond de carte (communes, quartiers)
      map.addLayer({ id: "pm-porte-label", type: "symbol", source: "pm-items", filter: ["all", ["==", ["get", "kind"], "pt"], ["==", ["get", "cat"], "porte"]],
        layout: { "text-field": ["step", ["zoom"], ["get", "short"], 14, ["get", "name"]], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 11, 13, 15, 15],
          "text-variable-anchor": ["top", "left", "right", "bottom"], "text-radial-offset": 0.9, "text-optional": true, "symbol-sort-key": 0, visibility: showLabels ? "visible" : "none" },
        paint: { "text-color": "#fff", "text-halo-color": "#202124", "text-halo-width": 3.5, "text-halo-blur": 0 } });

      for (const it of DB.items) {
        if (!(it.isLandmark || it.isPlace || !it.geom.lines.length)) continue;
        const node = document.createElement("div");
        node.className = "mpin3d";
        node.innerHTML = pinSVG(it.cat, (CATS[it.cat] || CATS.voie).color, 30);
        node.addEventListener("click", (e) => { e.stopPropagation(); itemClick(it); });
        const mk = new (ml().Marker)({ element: node, anchor: "bottom" }).setLngLat(toLngLat(it.point)).addTo(map);
        if (it.photo) {
          // photo au survol (ordinateur) ; au toucher, la fiche s'ouvre avec la photo
          let pop = null;
          node.addEventListener("mouseenter", () => {
            if (!showLabels) return; // en mémorisation, pas d'indice
            pop = new (ml().Popup)({ className: "phototip3d", closeButton: false, offset: 36, maxWidth: "240px" })
              .setLngLat(toLngLat(it.point)).setHTML(`<img src="${esc(it.photo.src)}" alt=""><span>${esc(it.name)}</span>`).addTo(map);
          });
          node.addEventListener("mouseleave", () => { pop?.remove(); pop = null; });
        }
        markers.push({ it, mk, node });
      }
      drawPolice(S.settings.police);

      map.on("click", "pm-hit", (e) => { const id = e.features?.[0]?.properties?.id; if (id) { e.preventDefault(); itemClick(item(id)); } });
      map.on("mouseenter", "pm-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "pm-hit", () => { map.getCanvas().style.cursor = ""; });
      map.on("click", (e) => { if (!e.defaultPrevented && Date.now() - lastItemClick > 350) onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }, e.lngLat); });
      // toute interaction de l'utilisateur interrompt un survol en cours
      for (const ev of ["mousedown", "touchstart", "wheel"]) map.on(ev, () => { orbiting = false; });
      map.on("moveend", declutterMarks);
      applyFilter();
      el.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      resolve(map);
    }));
  });

  let orbiting = false;
  const seqMarkers = [];
  // comme en 2D : une pastille qui en chevauche une autre ne garde que son numéro (le tracé reste visible)
  function declutterMarks() {
    if (destroyed || !seqMarkers.length) return;
    const spans = seqMarkers.map((x) => x.getElement().querySelector("span")).filter(Boolean);
    spans.forEach((sp) => sp.classList.remove("tight"));
    const kept = [];
    for (const sp of spans) {
      const r = sp.getBoundingClientRect();
      if (kept.some((k) => !(r.right < k.left - 2 || r.left > k.right + 2 || r.bottom < k.top - 1 || r.top > k.bottom + 1))) sp.classList.add("tight");
      else kept.push(r);
    }
  }
  const policeMarkers = [];
  function drawPolice(on) {
    policeMarkers.forEach((m) => m.remove());
    policeMarkers.length = 0;
    if (!on || !map) return;
    for (const p of DB.police?.items || []) {
      const big = p.type !== "police";
      const node = document.createElement("div");
      node.className = `ppin3d ${p.type}`;
      node.innerHTML = pinSVG("police", POLICE_COL, big ? 26 : 18);
      const pop = new (ml().Popup)({ className: "gpop3d", closeButton: false, offset: big ? 30 : 22 }).setHTML(`<div class="gpop-body">${policeHTML(p)}</div>`);
      node.addEventListener("click", (e) => { e.stopPropagation(); lastItemClick = Date.now(); });
      policeMarkers.push(new (ml().Marker)({ element: node, anchor: "bottom" }).setLngLat(toLngLat(p.at)).setPopup(pop).addTo(map));
    }
  }

  // ------------------------------------------------------------ boussole (orientation du téléphone)
  let compassOn = false, lastHeading = null;
  const onOrient = (e) => {
    const h = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading : e.absolute && e.alpha !== null ? 360 - e.alpha : null;
    if (h === null || !map) return;
    if (lastHeading !== null && Math.abs(((h - lastHeading + 540) % 360) - 180) < 2) return; // filtre les tremblements
    lastHeading = h;
    map.easeTo({ bearing: h, duration: 200, easing: (t) => t });
  };
  async function setCompass(on) {
    if (on) {
      const D = window.DeviceOrientationEvent;
      if (!D) throw new Error("Boussole non disponible sur cet appareil");
      if (typeof D.requestPermission === "function") {
        const r = await D.requestPermission(); // iPhone : autorisation explicite
        if (r !== "granted") throw new Error("Accès à l'orientation refusé");
      }
      window.addEventListener("deviceorientationabsolute", onOrient);
      window.addEventListener("deviceorientation", onOrient);
      compassOn = true;
    } else {
      window.removeEventListener("deviceorientationabsolute", onOrient);
      window.removeEventListener("deviceorientation", onOrient);
      compassOn = false;
      lastHeading = null;
    }
    return compassOn;
  }

  function applyFilter() {
    if (!map?.getLayer("pm-line")) return;
    const cat = ["in", ["get", "cat"], ["literal", filt.cats]];
    const arr = filt.arr ? ["in", filt.arr, ["get", "arr"]] : true;
    const only = filt.ids ? ["in", ["get", "id"], ["literal", filt.ids]] : true;
    const f = (kind) => ["all", ["==", ["get", "kind"], kind], cat, arr, only];
    for (const id of ["pm-case", "pm-line", "pm-hit"]) map.setFilter(id, f("line"));
    for (const id of ["pm-poly", "pm-poly-line"]) map.setFilter(id, f("poly"));
    map.setFilter("pm-label", ["all", f("pt"), ["!=", ["get", "cat"], "porte"]]);
    map.setFilter("pm-porte-label", ["all", f("pt"), ["==", ["get", "cat"], "porte"]]);
    map.setFilter("pm-arr-sel", ["==", ["get", "n"], filt.arr ?? -1]);
    for (const { it, node } of markers) {
      const vis = filt.cats.includes(it.cat) && (!filt.arr || it.arr.includes(filt.arr)) && (!filt.ids || filt.ids.includes(it.id));
      node.style.display = vis || (selected && selected.id === it.id) ? "" : "none";
    }
  }

  const api = {
    ready,
    get map() { return map; },
    setLabels(on) {
      showLabels = on;
      if (!map || !style) return;
      for (const id of labelLayerIds(style)) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on && !(isTransitLayer(id) && !S.settings.transit) ? "visible" : "none");
      map.setLayoutProperty("pm-label", "visibility", on ? "visible" : "none");
      map.setLayoutProperty("pm-porte-label", "visibility", on ? "visible" : "none");
    },
    setFilter(f) {
      filt = { ...filt, ...f };
      applyFilter();
    },
    select(it) {
      selected = it;
      if (!map?.getLayer("pm-sel")) return;
      const f = ["==", ["get", "id"], it ? it.id : ""];
      map.setFilter("pm-sel", ["all", ["==", ["get", "kind"], "line"], f]);
      map.setFilter("pm-sel-case", ["all", ["==", ["get", "kind"], "line"], f]);
      for (const { it: x, node } of markers) node.classList.toggle("sel", !!it && x.id === it.id);
      applyFilter();
    },
    /** Vole vers un élément ; `inset` réserve la place d'un panneau. */
    fly(it, { inset = {} } = {}) {
      if (!map) return;
      orbiting = false;
      const pts = [it.point, ...it.geom.lines.flat(), ...it.geom.polys.flat(2)].map(toLngLat);
      const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
      const padding = { top: 60 + (inset.top || 0), bottom: 40 + (inset.bottom || 0), left: 40, right: 40 + (inset.right || 0) };
      const bounds = [[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]];
      const cam = map.cameraForBounds(bounds, { padding, maxZoom: it.geom.lines.length ? 16.2 : 16.8 });
      // l'inclinaison choisie par l'utilisateur est conservée d'un élément à l'autre
      map.flyTo({ ...cam, pitch: map.getPitch(), bearing: map.getBearing(), duration: 1600, essential: true });
    },
    /** Cadre plusieurs éléments en gardant l'inclinaison et l'orientation. */
    fitItems(items, { maxZoom = 15.5 } = {}) {
      if (!map || !items.length) return;
      orbiting = false;
      const pts = items.flatMap((it) => [it.point, ...it.geom.lines.flat(), ...it.geom.polys.flat(2)]).map(toLngLat);
      const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
      const cam = map.cameraForBounds([[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]], { padding: 40, maxZoom });
      if (cam) map.flyTo({ ...cam, pitch: map.getPitch(), bearing: map.getBearing(), duration: 1400, essential: true });
    },
    /** Pastilles numérotées d'une suite de croisements : [{ at, label, n }]. */
    marks(list, { stagger = 0 } = {}) {
      api.clearMarks();
      if (!map) return;
      list.forEach((m, i) => {
        const node = document.createElement("div");
        node.className = `seqm seqm3d seqm-${m.style || "hint"}`;
        node.innerHTML = `<span style="--d:${i * stagger}ms">${m.n ? `<b>${m.n}</b>` : ""}<em>${esc(m.label)}</em></span>`;
        // en relief, les noms couvriraient le tracé : numéro seul, le nom s'affiche au toucher
        node.title = m.label;
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          lastItemClick = Date.now();
          const was = node.classList.contains("open");
          seqMarkers.forEach((x) => x.getElement().classList.remove("open"));
          node.classList.toggle("open", !was);
        });
        seqMarkers.push(new (ml().Marker)({ element: node, anchor: "center" }).setLngLat(toLngLat(m.at)).addTo(map));
      });
      setTimeout(declutterMarks, list.length * stagger + 450);
    },
    clearMarks() { seqMarkers.forEach((x) => x.remove()); seqMarkers.length = 0; },
    fitArr(n) {
      if (!map) return;
      const a = DB.arrs.find((x) => x.n === n);
      const lng = a.rings[0].map((p) => p[1]), lat = a.rings[0].map((p) => p[0]);
      map.fitBounds([[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]], { padding: 40, pitch: 50, duration: 1400 });
    },
    home() {
      if (map) { orbiting = false; map.flyTo({ ...HOME, duration: 1400 }); }
    },
    /** Survol : la caméra tourne lentement autour de l'élément (interrompu au moindre geste). */
    orbit(it) {
      if (!map) return;
      orbiting = true;
      map.flyTo({ center: toLngLat(it.point), zoom: it.geom.lines.length ? 15.6 : 16.9, pitch: 64, duration: 1500, essential: true });
      map.once("moveend", () => {
        let last = performance.now();
        const step = (t) => {
          if (!orbiting || destroyed) return;
          map.setBearing(map.getBearing() + (t - last) * 0.012);
          last = t;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    },
    stopOrbit() { orbiting = false; },
    setPolice(on) { drawPolice(on); },
    /** Tourne la carte de `deg` degrés (sens des aiguilles d'une montre si positif). */
    rotate(deg) { if (map) { orbiting = false; map.easeTo({ bearing: map.getBearing() + deg, duration: 400 }); } },
    north() { if (map) { orbiting = false; map.easeTo({ bearing: 0, duration: 500 }); } },
    /** Incline (delta > 0) ou redresse (delta < 0) la carte, entre la vue à plat et l'inclinaison maximale. */
    tilt(delta) {
      if (!map) return;
      orbiting = false;
      map.easeTo({ pitch: Math.max(0, Math.min(MAX_TILT, map.getPitch() + delta)), duration: 400 });
    },
    get pitch() { return map ? map.getPitch() : 0; },
    maxTilt: MAX_TILT,
    /** Bascule vue à plat / inclinée ; renvoie true si la vue est maintenant à plat. */
    toggleFlat() {
      if (!map) return false;
      const flat = map.getPitch() > 5;
      map.easeTo({ pitch: flat ? 0 : 58, duration: 500 });
      return flat;
    },
    get bearing() { return map ? map.getBearing() : 0; },
    setCompass,
    get compass() { return compassOn; },
    resize() { map?.resize(); },
    destroy() {
      destroyed = true;
      orbiting = false;
      if (compassOn) setCompass(false);
      try { map?.remove(); } catch { /* déjà supprimée */ }
    },
  };
  return api;
}
