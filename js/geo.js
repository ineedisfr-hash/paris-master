// Calculs géométriques en mètres (projection locale équirectangulaire, précise à l'échelle de Paris).
import { DB } from "./data.js";

const LAT0 = 48.8566;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110574;
const P = ([lat, lng]) => [(lng - 2.3488) * KX, (lat - LAT0) * KY];

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const cache = new WeakMap();
function projected(it) {
  let c = cache.get(it);
  if (!c) {
    c = {
      lines: it.geom.lines.map((l) => l.map(P)),
      polys: it.geom.polys.map((poly) => poly.map((r) => r.map(P))),
      point: P(it.point),
    };
    cache.set(it, c);
  }
  return c;
}

/** Distance (m) entre un point [lat, lng] et la géométrie réelle d'un élément. */
export function distToItem(latlng, it) {
  const p = P(latlng);
  const g = projected(it);
  let best = Infinity;
  for (const poly of g.polys) {
    if (inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h))) return 0;
    for (const r of poly) for (let i = 0; i < r.length - 1; i++) best = Math.min(best, segDist(p, r[i], r[i + 1]));
  }
  for (const l of g.lines) for (let i = 0; i < l.length - 1; i++) best = Math.min(best, segDist(p, l[i], l[i + 1]));
  if (!g.lines.length && !g.polys.length) best = Math.hypot(p[0] - g.point[0], p[1] - g.point[1]);
  return best;
}

/** Point de la géométrie le plus proche d'un clic (pour tracer la correction). */
export function nearestPoint(latlng, it) {
  const p = P(latlng);
  const g = projected(it);
  let best = Infinity, out = g.point;
  const consider = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    const q = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best) { best = d; out = q; }
  };
  for (const l of g.lines) for (let i = 0; i < l.length - 1; i++) consider(l[i], l[i + 1]);
  for (const poly of g.polys) for (const r of poly) for (let i = 0; i < r.length - 1; i++) consider(r[i], r[i + 1]);
  return [out[1] / KY + LAT0, out[0] / KX + 2.3488];
}

export function distBetween(a, b) {
  const p = P(a), q = P(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

/** Distance minimale entre deux éléments (échantillonnage de A contre la géométrie de B). */
export function distItems(a, b) {
  const pts = [a.point, ...a.geom.lines.flat(), ...a.geom.polys.flat(2)];
  let best = Infinity;
  for (const p of pts) best = Math.min(best, distToItem(p, b));
  return best;
}

/** Arrondissement (officiel) contenant un point, ou null hors de Paris. */
export function arrAt(latlng) {
  const p = P(latlng);
  for (const a of DB.arrs) {
    const rings = (a._xy ||= a.rings.map((r) => r.map(P)));
    if (inRing(p, rings[0]) && !rings.slice(1).some((h) => inRing(p, h))) return a.n;
  }
  return null;
}

/** Score de précision d'un clic : 1 jusqu'à `perfect` m, 0 au-delà de `zero` m. */
export function precisionScore(d, perfect = 60, zero = 900) {
  if (d <= perfect) return 1;
  if (d >= zero) return 0;
  return 1 - (d - perfect) / (zero - perfect);
}

// ------------------------------------------------------------------ « Quelle est cette rue ? »
// Index en grille (cellules de 250 m) des 8 000+ tronçons du filaire officiel, construit au premier usage.
let GRID = null;
const CELL = 250;
function streetGrid() {
  if (GRID || !DB.context) return GRID;
  GRID = new Map();
  for (const s of DB.context.streets) {
    const pts = [];
    for (let i = 2; i < s.length; i += 2) pts.push(P([s[i], s[i + 1]]));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const seg = [a, b, s[1]];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const y0 = Math.floor(Math.min(a[1], b[1]) / CELL), y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = x + ":" + y;
        if (!GRID.has(k)) GRID.set(k, []);
        GRID.get(k).push(seg);
      }
    }
  }
  return GRID;
}

/** Voie officielle la plus proche d'un point : { name, d } ou null au-delà de `max` mètres. */
export function nearestStreet(latlng, max = 60) {
  const g = streetGrid();
  if (!g) return null;
  const p = P(latlng);
  const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
  let best = null;
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
    for (const [a, b, n] of g.get(x + ":" + y) || []) {
      const d = segDist(p, a, b);
      if (d <= max && (!best || d < best.d)) best = { name: DB.context.names[n], d };
    }
  }
  return best;
}
