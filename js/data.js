// Chargement et indexation des données géographiques (data/paris.json, généré par tools/build_data.py).
import { arrText } from "./util.js";

export const CATS = {
  porte: { label: "Porte de Paris", plural: "Portes de Paris", color: "#202124" },
  anneau: { label: "Anneau de boulevards", plural: "Anneaux de boulevards", color: "#3949ab" },
  avenue: { label: "Avenue", plural: "Avenues", color: "#e37400" },
  boulevard: { label: "Boulevard", plural: "Boulevards", color: "#c5221f" },
  rue: { label: "Rue", plural: "Rues", color: "#1967d2" },
  quai: { label: "Quai", plural: "Quais", color: "#00897b" },
  pont: { label: "Pont", plural: "Ponts", color: "#8e24aa" },
  place: { label: "Place", plural: "Places", color: "#b06000" },
  monument: { label: "Monument", plural: "Monuments", color: "#c2185b" },
  gare: { label: "Gare", plural: "Gares", color: "#5f6368" },
  parc: { label: "Parc et bois", plural: "Parcs et bois", color: "#188038" },
  eau: { label: "Canal et bassin", plural: "Canaux et bassins", color: "#0288d1" },
  voie: { label: "Voie", plural: "Voies", color: "#5f6368" },
};

export const WAY_CATS = ["anneau", "avenue", "boulevard", "rue", "quai", "pont", "voie"];
export const LANDMARK_CATS = ["monument", "gare", "parc", "eau"];

export const DB = { items: [], byId: {}, levels: [], arrs: [], meta: {}, context: null, police: null };

export async function loadData() {
  // fond vectoriel (toutes les voies + la Seine) : facultatif, la carte fonctionne sans
  const ctx = fetch("data/context.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const police = fetch("data/police.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const res = await fetch("data/paris.json");
  if (!res.ok) throw new Error(`Données indisponibles (${res.status})`);
  const d = await res.json();
  DB.meta = d.meta;
  DB.arrs = d.arrondissements;
  DB.levels = d.levels;
  DB.byId = d.items;
  DB.items = Object.values(d.items);
  for (const it of DB.items) {
    it.levels = DB.levels.filter((l) => l.items.includes(it.id)).map((l) => l.id);
    it.firstLevel = Math.min(...it.levels);
    it.isWay = WAY_CATS.includes(it.cat);
    it.isPlace = it.cat === "place";
    it.isLandmark = LANDMARK_CATS.includes(it.cat);
    it.isPorte = it.cat === "porte";
  }
  for (const a of DB.arrs) a.center = ringCenter(a.rings[0]);
  DB.context = await ctx;
  DB.police = await police;
  return DB;
}

function ringCenter(ring) {
  // barycentre surfacique (suffisant pour placer une étiquette)
  let A = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [y1, x1] = ring[j], [y2, x2] = ring[i];
    const f = x1 * y2 - x2 * y1;
    A += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  return [cy / (3 * A), cx / (3 * A)];
}

export const item = (id) => DB.byId[id];
export const levelById = (id) => DB.levels.find((l) => l.id === Number(id));

export function catLabel(it) {
  return (CATS[it.cat] || CATS.voie).label;
}

/** « dans le 11e » / « dans les 8e, 9e, 17e et 18e » */
export function inArr(it) {
  return it.arr.length > 1 ? `dans les ${arrText(it.arr)}` : `dans le ${arrText(it.arr)}`;
}

/** Nom avec article pour les phrases (« le boulevard Voltaire », « la place d'Italie »). */
export function withArticle(it) {
  const n = it.name.replace(/\s*\(.*\)$/, "");
  if (/^Grands Boulevards/.test(n)) return "les Grands Boulevards";
  if (/^Boulevards des/.test(n)) return "les b" + n.slice(1);
  if (/^Anneau/.test(n)) return "l'a" + n.slice(1);
  const low = n.charAt(0).toLowerCase() + n.slice(1); // nom commun en tête : « la rue… »
  if (/^(rue|avenue|place|gare|tour|bibliothèque|porte)\b/i.test(n)) return `la ${low}`;
  if (/^(boulevard|quai|pont|parc|bois|canal|bassin|cimetière|musée|palais)\b/i.test(n)) return `le ${low}`;
  if (/^(Panthéon|Sacré)/.test(n)) return `le ${n}`;
  if (/^(Arc|Hôtel)\b/.test(n)) return `l'${n}`;
  if (/^Invalides/.test(n)) return "les Invalides";
  return n;
}

/** « du boulevard Voltaire », « de la place d'Italie », « des Invalides », « de Notre-Dame » */
export function deNm(it) {
  const n = withArticle(it);
  if (n.startsWith("le ")) return "du " + n.slice(3);
  if (n.startsWith("les ")) return "des " + n.slice(4);
  return "de " + n;
}

/** « au boulevard Voltaire », « à la place d'Italie », « aux Invalides » */
export function aNm(it) {
  const n = withArticle(it);
  if (n.startsWith("le ")) return "au " + n.slice(3);
  if (n.startsWith("les ")) return "aux " + n.slice(4);
  return "à " + n;
}
