// Carte interactive : modes apprentissage (noms affichés) et mémorisation (noms masqués),
// vue 2D ou 3D (relief des bâtiments, survol), filtres, arrondissement, recherche,
// fiche pédagogique au toucher d'un élément, « quelle est cette rue ? » au toucher du plan.
import { DB, CATS, item } from "../data.js";
import { createMap, GL_OK } from "../map.js";
import { create3D } from "../map3d.js";
import { orientHTML, wireOrient } from "../orient.js";
import { ficheHTML } from "../fiche.js";
import * as store from "../store.js";
import { esc, toast, arrLabel, fmtDist } from "../util.js";
import { nearestStreet, arrAt } from "../geo.js";

const PREF = "paris-master.explore";
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } };
const savePref = (p) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* facultatif */ } };
const norm = (x) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-'’]/g, " ").replace(/\s+/g, " ").trim();

export default function explore(root, params) {
  const pref = { learn: true, cats: Object.keys(CATS), arr: null, d3: false, ...loadPref() };
  if (params.get("vue") === "3d") pref.d3 = true;
  // catégorie apparue après l'enregistrement des filtres : visible par défaut
  if (!pref.cats2) { pref.cats = [...new Set([...pref.cats, "anneau"])]; pref.cats2 = true; }
  if (!pref.cats3) { pref.cats = [...new Set([...pref.cats, "porte"])]; pref.cats3 = true; }
  if (!GL_OK) pref.d3 = false;
  const usedCats = Object.keys(CATS).filter((c) => DB.items.some((i) => i.cat === c));
  root.innerHTML = `
  <section class="explore">
    <div id="emap"></div>
    <div id="emap3d" hidden></div>
    <div class="ex-bar">
      <div class="seg" role="group" aria-label="Mode de la carte">
        <button data-learn="1" class="${pref.learn ? "on" : ""}">Apprentissage</button>
        <button data-learn="0" class="${pref.learn ? "" : "on"}">Mémorisation</button>
      </div>
      ${GL_OK ? `<button class="btn small d3-btn ${pref.d3 ? "on" : ""}" aria-pressed="${pref.d3}" title="Vue 3D">3D</button>` : ""}
      <input class="search" type="search" list="ex-list" placeholder="Rechercher une voie, un lieu…" aria-label="Rechercher">
      <datalist id="ex-list">${DB.items.map((i) => `<option value="${esc(i.name)}">`).join("")}</datalist>
      <button class="btn small filters-btn" aria-expanded="false">Filtres</button>
    </div>
    <p class="d3-hint" hidden>Deux doigts : tourner et incliner la carte (ou les boutons en bas)</p>
    ${orientHTML()}
    <div class="ex-filters" hidden>
      <label>Arrondissement
        <select class="arr-select"><option value="">Tout Paris</option>${DB.arrs.map((a) => `<option value="${a.n}" ${pref.arr === a.n ? "selected" : ""}>${a.label} — ${esc(a.name)}</option>`).join("")}</select>
      </label>
      <label class="chk police-chk" style="--c:#0b3d91"><input type="checkbox" class="police-toggle" ${store.S.settings.police ? "checked" : ""}><span>Commissariats et police</span></label>
      <div class="cat-toggles">${usedCats.map((c) => `<label class="chk" style="--c:${CATS[c].color}"><input type="checkbox" value="${c}" ${pref.cats.includes(c) ? "checked" : ""}><span>${CATS[c].plural}</span></label>`).join("")}</div>
      <div class="ex-modes">
        <a class="btn small" href="#/jouer/retrouve">Mode examen : localiser</a>
        <a class="btn small" href="#/jouer/identifie">Mode reconnaissance</a>
        ${store.S.settings.geoloc ? `<button class="btn small locate-me">Me localiser</button>` : ""}
      </div>
    </div>
    <div class="sheet" hidden><button class="icon-btn close" aria-label="Fermer">✕</button><div class="sheet-body"></div></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const m = createMap($("#emap"), { labels: pref.learn, arrNumbers: true, police: store.S.settings.police, photos: true });
  m.refresh();
  let m3 = null;
  let selected = null;
  let meMarker = null;

  // ------------------------------------------------------------ rendu
  function render() {
    m.clear();
    m.highlightArr(pref.arr);
    const visible = DB.items.filter((i) => pref.cats.includes(i.cat) && (!pref.arr || i.arr.includes(pref.arr)));
    const z = m.map.getZoom();
    // ordre : surfaces, puis lignes, puis points (pour que tout reste cliquable)
    const order = (i) => (i.geom.polys.length && !i.isPlace ? 0 : i.geom.lines.length ? 1 : 2);
    for (const it of [...visible].sort((a, b) => order(a) - order(b))) {
      const isSel = selected && selected.id === it.id;
      // les portes gardent un nom court même en vue d'ensemble, pour apprendre le tour de Paris
      const full = isSel || z >= 14.5 || (pref.arr && z >= 13.5);
      const showLabel = pref.learn && (full || (it.isPorte ? "short" : false));
      m.draw(it, { style: isSel ? "focus" : selected ? "muted" : "normal", label: showLabel, onClick: open });
    }
    if (selected && !visible.includes(selected)) m.draw(selected, { style: "focus", label: pref.learn, onClick: open });
    if (m3) { m3.setFilter({ cats: pref.cats, arr: pref.arr }); m3.select(selected); }
  }

  // zone de carte réellement visible : sous la barre d'outils, hors de la fiche
  const inset = () => {
    const sh = $(".sheet");
    const wide = window.matchMedia("(min-width: 900px)").matches;
    const top = $(".ex-bar").getBoundingClientRect().height + 10;
    if (sh.hidden) return { top };
    return wide ? { top, right: sh.offsetWidth + 12 } : { top, bottom: sh.offsetHeight };
  };
  const flyTo = (it) => (m3 ? m3.fly(it, { inset: inset() }) : m.fit([it], { pad: 30, inset: inset() }));
  const fitArr = (n) => (m3 ? m3.fitArr(n) : m.fitArr(n));

  function open(it, { fly = false } = {}) {
    selected = it;
    const sh = $(".sheet");
    sh.hidden = false;
    $(".sheet-body").innerHTML = `${ficheHTML(it)}
      <div class="sheet-actions">
        <button class="btn small center">Centrer</button>
        ${GL_OK ? `<button class="btn small primary orbit">Survol 360°</button>` : ""}
        <a class="btn small" href="#/apprendre/${it.firstLevel}?item=${it.id}">Niveau ${it.firstLevel}</a>
      </div>`;
    $(".sheet-body .center").addEventListener("click", () => flyTo(it));
    $(".sheet-body .orbit")?.addEventListener("click", async () => {
      if (!m3) await set3D(true);
      // la fiche se replie pour laisser la place au survol
      sh.hidden = true;
      m3?.orbit(it);
      toast("Survol en cours : touchez la carte pour l'arrêter");
    });
    root.querySelectorAll(".sheet [data-goto]").forEach((b) => b.addEventListener("click", () => open(item(b.dataset.goto), { fly: true })));
    root.querySelectorAll(".sheet .chip.arr").forEach((c) => c.addEventListener("click", () => { pref.arr = Number(c.dataset.arr); $(".arr-select").value = pref.arr; savePref(pref); fitArr(pref.arr); render(); }));
    if (fly) flyTo(it);
    render();
  }

  function closeSheet() {
    selected = null;
    $(".sheet").hidden = true;
    render();
  }

  // ------------------------------------------------------------ « Quelle est cette rue ? »
  function streetPopup(ll) {
    const st = nearestStreet(ll, 45);
    const n = arrAt(ll);
    const known = st && DB.items.find((i) => norm(i.official || i.name) === norm(st.name));
    const hidden = !pref.learn;
    const html = `<div class="gpop-body">
      ${st ? `<strong class="gp-name ${hidden ? "masked" : ""}">${esc(st.name)}</strong>` : `<strong>Aucune voie ici</strong>`}
      <small>${n ? `${arrLabel(n)} arrondissement` : "Hors de Paris"}${st && st.d > 8 ? ` · à ${fmtDist(st.d)}` : ""}</small>
      <div class="gp-actions">
        ${st && hidden ? `<button class="btn small primary gp-reveal">Révéler</button>` : ""}
        ${known ? `<button class="btn small gp-fiche" ${hidden ? "hidden" : ""}>Voir la fiche</button>` : ""}
      </div></div>`;
    const wire = (el, close) => {
      el.querySelector(".gp-reveal")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        el.querySelector(".gp-name").classList.remove("masked");
        ev.currentTarget.remove();
        el.querySelector(".gp-fiche")?.removeAttribute("hidden");
      });
      el.querySelector(".gp-fiche")?.addEventListener("click", () => { close(); open(known, { fly: true }); });
    };
    return { html, wire };
  }

  m.map.on("click", (e) => {
    if (selected) return closeSheet();
    const { html, wire } = streetPopup([e.latlng.lat, e.latlng.lng]);
    const popup = window.L.popup({ className: "gpop", closeButton: false, offset: [0, -4], autoPanPadding: [20, 80] }).setLatLng(e.latlng).setContent(html).openOn(m.map);
    wire(popup.getElement(), () => m.map.closePopup());
  });
  m.map.on("zoomend", render);

  // ------------------------------------------------------------ 3D
  let popup3 = null;
  async function set3D(on) {
    pref.d3 = on;
    savePref(pref);
    const b = $(".d3-btn");
    b?.classList.toggle("on", on);
    b?.setAttribute("aria-pressed", String(on));
    $("#emap").hidden = on;
    $("#emap3d").hidden = !on;
    $(".d3-hint").hidden = !on;
    $(".orient").hidden = !on;
    if (on && !m3) {
      m3 = create3D($("#emap3d"), {
        labels: pref.learn,
        onItemClick: (it) => open(it, { fly: true }),
        onMapClick: (ll, lngLat) => {
          if (selected) return closeSheet();
          popup3?.remove();
          const { html, wire } = streetPopup([ll.lat, ll.lng]);
          popup3 = new window.maplibregl.Popup({ className: "gpop3d", closeButton: false, offset: 10, maxWidth: "280px" }).setLngLat(lngLat).setHTML(html).addTo(m3.map);
          wire(popup3.getElement(), () => popup3.remove());
        },
      });
      try {
        await m3.ready;
      } catch {
        toast("Vue 3D indisponible (fond de carte injoignable)");
        m3?.destroy(); m3 = null;
        return set3D(false);
      }
      render();
      if (selected) m3.fly(selected, { inset: inset() });
      else if (pref.arr) m3.fitArr(pref.arr);
      setTimeout(() => $(".d3-hint") && ($(".d3-hint").hidden = true), 4000);
    } else if (!on && m3) {
      m3.destroy();
      m3 = null;
      m.refresh();
      if (selected) m.fit([selected], { pad: 30, inset: inset() });
    }
  }
  $(".d3-btn")?.addEventListener("click", () => set3D(!pref.d3));

  // orientation (vue 3D) : rotation, nord, inclinaison, boussole
  const unOrient = wireOrient(root, () => m3);

  // ------------------------------------------------------------ commandes
  root.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
    pref.learn = b.dataset.learn === "1";
    root.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
    m.setLabels(pref.learn);
    m3?.setLabels(pref.learn);
    savePref(pref);
    render();
    toast(pref.learn ? "Noms affichés" : "Noms masqués : touchez une rue et devinez son nom avant de le révéler");
  }));
  $(".filters-btn").addEventListener("click", (e) => {
    const f = $(".ex-filters");
    f.hidden = !f.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!f.hidden));
  });
  $(".arr-select").addEventListener("change", (e) => {
    pref.arr = e.target.value ? Number(e.target.value) : null;
    savePref(pref);
    if (pref.arr) fitArr(pref.arr);
    else if (m3) m3.home();
    else m.fitParis({ inset: inset() });
    render();
  });
  $(".police-toggle").addEventListener("change", (e) => {
    store.S.settings.police = e.target.checked;
    store.save();
    m.setPolice(e.target.checked);
    m3?.setPolice(e.target.checked);
  });
  root.querySelectorAll(".cat-toggles input").forEach((c) => c.addEventListener("change", () => {
    pref.cats = [...root.querySelectorAll(".cat-toggles input:checked")].map((x) => x.value);
    savePref(pref);
    render();
  }));
  $(".search").addEventListener("change", (e) => {
    const v = e.target.value.trim().toLowerCase();
    const it = DB.items.find((i) => i.name.toLowerCase() === v) || DB.items.find((i) => i.name.toLowerCase().includes(v) || i.alias?.some((a) => a.toLowerCase().includes(v)));
    if (it) { open(it, { fly: true }); e.target.value = ""; e.target.blur(); }
    else toast("Aucun élément ne correspond");
  });
  $(".close").addEventListener("click", closeSheet);
  $(".locate-me")?.addEventListener("click", () => {
    if (!navigator.geolocation) return toast("Géolocalisation indisponible");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const ll = [p.coords.latitude, p.coords.longitude];
        if (m3) { m3.map.flyTo({ center: [ll[1], ll[0]], zoom: 16.5, pitch: 55 }); return; }
        meMarker?.remove();
        meMarker = window.L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(m.map);
        m.map.setView(ll, 16);
      },
      () => toast("Position refusée ou indisponible"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  if (pref.arr) m.fitArr(pref.arr);
  else m.fitParis({ inset: inset() });
  render();
  if (params.get("item") && item(params.get("item"))) open(item(params.get("item")), { fly: true });
  if (pref.d3) set3D(true);
  return () => { unOrient(); m3?.destroy(); m.destroy(); };
}

export { arrLabel };
