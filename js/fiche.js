// Fiche pédagogique d'un élément. Tout le contenu provient des données (officielles ou calculées).
import { DB, CATS, catLabel, inArr, withArticle, item, aNm } from "./data.js";
import { esc, arrText, fmtDist } from "./util.js";

const nearTxt = (d) => (d < 20 ? "au contact" : fmtDist(d));
import { itemStats, mastery, MASTERY_LABELS } from "./store.js";

export function linkedItems(it) {
  return it.links.map(item).filter(Boolean);
}

export function nearItems(it, maxD = 400) {
  return it.near.filter(([, d]) => d <= maxD).map(([id, d]) => ({ it: item(id), d })).filter((x) => x.it);
}

/** Phrase-repère construite uniquement à partir des faits connus. */
export function memoTip(it) {
  const links = linkedItems(it);
  const places = links.filter((l) => l.isPlace);
  const ways = links.filter((l) => l.isWay);
  const near = nearItems(it, 300).filter((x) => x.it.isLandmark);
  const parts = [];
  const name = withArticle(it);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  if (it.cat === "anneau") {
    const m = it.members;
    return `${cap(name)} enchaînent ${m.length} boulevards, ${it.seqDir} : ${m[0].name} → ${m[1].name} → … → ${m[m.length - 1].name}. Retenez d'abord les deux extrémités, puis les étapes du milieu.`
      .replace(/^(L'anneau[^,]*) enchaînent/, "$1 enchaîne");
  }
  if (it.isPorte) {
    const ring = DB.levels.find((l) => l.ring?.length)?.ring || [];
    const k = ring.indexOf(it.id);
    if (k >= 0) {
      const prev = item(ring[(k - 1 + ring.length) % ring.length]), next = item(ring[(k + 1) % ring.length]);
      return `${cap(name)} se trouve ${inArr(it)}, entre ${withArticle(prev)} et ${withArticle(next)} (dans le sens des aiguilles d'une montre). C'est la ${k === 0 ? "1re" : `${k + 1}e`} porte en partant du nord.`;
    }
  }
  if (it.isWay && places.length >= 2) {
    parts.push(`${cap(name)} relie ${withArticle(places[0])} ${aNm(places[1])}`);
  } else if (it.isWay && places.length === 1) {
    parts.push(`${cap(name)} passe par ${withArticle(places[0])}`);
  } else if (it.isPlace && ways.length) {
    parts.push(`Sur ${withArticle(it)} débouchent ${ways.slice(0, 3).map(withArticle).join(", ")}`);
  } else {
    parts.push(`${cap(name)} se trouve ${inArr(it)}`);
  }
  if (it.orientation) parts.push(`selon un axe ${it.orientation}`);
  let s = parts.join(", ");
  if (near.length) s += `. Repère visuel : ${withArticle(near[0].it)} (${nearTxt(near[0].d)})`;
  if (it.arr.length > 1 && !s.includes(inArr(it))) s += `. Attention, ${it.arr.length} arrondissements concernés : ${arrText(it.arr)}`;
  return s + ".";
}

export function ficheHTML(it, { compact = false } = {}) {
  const c = CATS[it.cat] || CATS.voie;
  const links = linkedItems(it);
  const near = nearItems(it);
  const st = itemStats(it.id);
  const m = mastery(it.id);
  const chips = it.arr.map((n) => `<span class="chip arr" data-arr="${n}">${n === 1 ? "1er" : n + "e"}</span>`).join("");
  const rows = [];
  if (it.cat === "anneau") {
    rows.push(`<div class="kv"><span>Les ${it.members.length} boulevards, ${esc(it.seqDir)}</span><ol class="chain">${it.members.map((mm) => `<li>${esc(mm.name)} <small>${arrText(mm.arr)}</small></li>`).join("")}</ol></div>`);
  } else if (it.sequence?.length >= 2) {
    rows.push(`<div class="kv"><span>Dans l'ordre, ${esc(it.seqDir)}</span><ol class="chain">${it.sequence.map((x) => `<li>${x.id ? `<button class="link" data-goto="${x.id}">${esc(x.name)}</button>` : esc(x.name)}</li>`).join("")}</ol></div>`);
  }
  if (it.debut || it.fin) {
    rows.push(`<div class="kv"><span>Tenants</span><p>${it.debut ? `Commence : ${esc(it.debut)}` : ""}${it.fin ? `<br>Finit : ${esc(it.fin)}` : ""}</p></div>`);
  }
  if (it.orientation) rows.push(`<div class="kv"><span>Orientation</span><p>Axe ${esc(it.orientation)}</p></div>`);
  if (it.longueurOfficielle || it.longueurCalculee) rows.push(`<div class="kv"><span>Longueur</span><p>${fmtDist(it.longueurOfficielle || it.longueurCalculee)}${it.longueurOfficielle ? "" : " (mesurée sur le tracé)"}</p></div>`);
  if (it.quartiers?.length) rows.push(`<div class="kv"><span>Quartiers</span><p>${esc(it.quartiers.join(", "))}</p></div>`);
  if (links.length) rows.push(`<div class="kv"><span>Reliée à</span><p>${links.map((l) => `<button class="link" data-goto="${l.id}">${esc(l.name)}</button>`).join(" ")}</p></div>`);
  if (near.length) rows.push(`<div class="kv"><span>À proximité</span><p>${near.slice(0, 6).map(({ it: n, d }) => `<button class="link" data-goto="${n.id}">${esc(n.name)}</button> <small>${nearTxt(d)}</small>`).join(" · ")}</p></div>`);
  if (!compact && it.orig) rows.push(`<div class="kv"><span>Origine du nom</span><p>${esc(it.orig)}</p></div>`);
  if (it.alias?.length) rows.push(`<div class="kv"><span>Aussi appelé</span><p>${esc(it.alias.join(", "))}</p></div>`);

  return `
  <article class="fiche" style="--cat:${c.color}">
    <header>
      <span class="cat">${esc(catLabel(it))}${it.complement ? " · complément" : ""}</span>
      <h2>${esc(it.name)}</h2>
      <div class="chips">${chips}</div>
    </header>
    ${it.photo ? `<figure class="photo"><img src="${esc(it.photo.src)}" alt="${esc(it.name)}" loading="lazy" decoding="async"><figcaption>Photo : ${esc(it.photo.author)}${it.photo.license ? `, ${esc(it.photo.license)}` : ""} — <a href="${esc(it.photo.page)}" target="_blank" rel="noopener">Wikimedia Commons</a></figcaption></figure>` : ""}
    ${it.note ? `<p class="note">${esc(it.note)}</p>` : ""}
    <p class="memo"><strong>Pour retenir —</strong> ${esc(memoTip(it))}</p>
    <div class="kvs">${rows.join("")}</div>
    <footer>
      <span class="mastery m${m}">${MASTERY_LABELS[m]}${st ? ` · ${st.ok}/${st.seen} réussites` : ""}</span>
      <span class="src">Source : ${esc(it.source)}</span>
    </footer>
  </article>`;
}

export const allItems = () => DB.items;
