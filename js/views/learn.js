// Mode Apprendre, par paliers de 5 éléments.
// Les axes se dessinent de bout en bout et leurs croisements apparaissent dans l'ordre.
// Un palier découvert doit être validé par un contrôle (80 %) avant d'ouvrir le suivant ;
// au-delà du plafond de nouveautés du jour, l'application conseille de réviser.
import { item, levelById } from "../data.js";
import { createMap, GL_OK } from "../map.js";
import { ficheHTML } from "../fiche.js";
import { seqMarks } from "../questions.js";
import * as store from "../store.js";
import { esc, toast } from "../util.js";

export default function learn(root, params, [levelId]) {
  const level = levelById(levelId);
  if (!level) { root.innerHTML = `<section class="page"><p>Niveau introuvable.</p></section>`; return; }
  if (!store.levelUnlocked(level.id)) { location.hash = "#/niveaux"; return; }
  const ids = level.items;
  const nP = store.palierCount(level);
  const P = store.PALIER;
  // dernier élément accessible : fin du palier en cours (les paliers validés restent consultables)
  const limit = () => Math.min(ids.length, (store.paliersPassed(level) + 1) * P);
  const palierOf = (idx) => Math.floor(idx / P);

  let i = Math.max(0, ids.indexOf(params.get("item")));
  if (!params.get("item")) {
    const firstNew = ids.findIndex((id, k) => k < limit() && store.mastery(id) === 0);
    i = firstNew >= 0 ? firstNew : Math.min(limit(), ids.length) - 1;
  }
  if (i >= limit()) i = limit() - 1;
  let capOverride = false;

  root.innerHTML = `
  <section class="play learn">
    <div class="play-map"><div id="lmap"></div></div>
    <div class="play-panel">
      <div class="play-top">
        <a class="icon-btn" href="#/niveaux#n${level.id}" aria-label="Retour">✕</a>
        <div class="bar"><i></i></div>
        <span class="count"></span>
      </div>
      <p class="play-title">Apprendre — ${esc(level.title)}</p>
      <div class="paliers" aria-label="Paliers"></div>
      <div class="learn-body"></div>
      <div class="learn-nav">
        <button class="btn prev">← Précédent</button>
        <button class="btn primary ok">J'ai compris</button>
      </div>
    </div>
  </section>`;
  const $ = (s) => root.querySelector(s);
  const m = createMap($("#lmap"), { labels: true, arrNumbers: true, police: store.S.settings.police, photos: true });
  m.refresh();

  function renderPaliers(cur) {
    const passed = store.paliersPassed(level);
    $(".paliers").innerHTML = Array.from({ length: nP }, (_, k) => {
      const st = k < passed ? "done" : k === passed ? "now" : "locked";
      return `<span class="pal ${st} ${k === cur ? "cur" : ""}" title="Palier ${k + 1}${st === "done" ? " — validé" : st === "locked" ? " — verrouillé" : " — en cours"}">${k + 1}</span>`;
    }).join("");
  }

  /** Dessine l'élément ; pour un axe ou un anneau, tracé animé puis croisements un à un. */
  function drawMap(it) {
    m.clear();
    m.highlightArr(it.arr.length === 1 ? it.arr[0] : null);
    const marks = seqMarks(it);
    const isChain = marks.length >= 2;
    if (!isChain) {
      // repères du palier en cours (et voisins immédiats pour une porte)
      const k = palierOf(ids.indexOf(it.id));
      for (const id of store.palierItems(level, k)) if (id !== it.id) m.draw(item(id), { style: "muted", label: it.isPorte });
      for (const c of it.links.map(item).filter(Boolean)) m.draw(c, { style: "normal", label: true });
    }
    m.draw(it, { style: "focus", label: !isChain, animate: isChain });
    if (isChain) m.marks(marks.map((x, k) => ({ ...x, n: k + 1, style: "hint" })), { stagger: Math.min(450, 2600 / marks.length) });
    m.fit([it], { pad: it.isWay ? 40 : it.isPorte ? 220 : 160, maxZoom: 16 });
  }

  function show() {
    const it = item(ids[i]);
    renderPaliers(palierOf(i));
    if (!store.getCard(it.id)?.learned && store.newLeftToday() === 0 && !capOverride) return showCap();
    $(".learn-nav").hidden = false;
    $(".bar i").style.width = `${(ids.filter((id) => store.mastery(id) >= 1).length / ids.length) * 100}%`;
    $(".count").textContent = `${i + 1}/${ids.length}`;
    const chain = seqMarks(it).length >= 2;
    $(".learn-body").innerHTML = ficheHTML(it) + `<div class="row learn-extra">
      ${chain ? `<button class="btn small replay">Rejouer le tracé</button>` : ""}
      ${GL_OK ? `<a class="btn small d3-link" href="#/carte?item=${it.id}&vue=3d">Voir en 3D</a>` : ""}</div>`;
    root.querySelectorAll(".learn-body [data-goto]").forEach((b) => b.addEventListener("click", () => {
      const j = ids.indexOf(b.dataset.goto);
      if (j >= 0 && j < limit()) { i = j; show(); } else location.hash = `#/carte?item=${b.dataset.goto}`;
    }));
    $(".replay")?.addEventListener("click", () => drawMap(it));
    drawMap(it);
    $(".prev").disabled = i === 0;
    const learned = store.getCard(it.id)?.learned;
    $(".ok").textContent = !learned ? "J'ai compris" : i + 1 >= ids.length ? "Terminer" : (i + 1) % P === 0 ? "Contrôle du palier →" : "Suivant →";
    $(".play-panel").scrollTop = 0;
  }

  function showCap() {
    const n = store.todayStats().learned;
    $(".learn-nav").hidden = true;
    $(".learn-body").innerHTML = `<div class="result pause">
      <h2>Bien joué pour aujourd'hui</h2>
      <p class="muted">Vous avez découvert ${n} nouveautés aujourd'hui. Au-delà, elles se mélangent et s'oublient plus vite : le plus efficace est maintenant de les réviser, puis de revenir demain.</p>
      <div class="fb-actions col">
        <a class="btn primary" href="#/jouer/revision">Réviser maintenant</a>
        <button class="btn more">Continuer quand même</button>
      </div>
      <p class="small muted">Plafond réglable dans le Profil (actuellement ${store.S.settings.newPerDay || "sans limite"} par jour).</p></div>`;
    $(".more").addEventListener("click", () => { capOverride = true; show(); });
  }

  /** Fin d'un palier : contrôle obligatoire avant d'aller plus loin. */
  function showGate(k) {
    renderPaliers(k);
    const list = store.palierItems(level, k);
    $(".learn-nav").hidden = true;
    $(".learn-body").innerHTML = `<div class="result pause">
      <p class="eyebrow">Palier ${k + 1} sur ${nP}</p>
      <h2>Contrôle du palier</h2>
      <p class="muted">Pour passer au palier suivant, réussissez ce contrôle à ${Math.round(store.PALIER_PASS * 100)} % (6 questions sur ces ${list.length} éléments). Vous pouvez d'abord relire les fiches.</p>
      <ul class="errors">${list.map((id) => `<li><button class="link reread" data-id="${id}">${esc(item(id).name)}</button></li>`).join("")}</ul>
      <div class="fb-actions col">
        <a class="btn primary" href="#/jouer/palier?niveau=${level.id}&palier=${k}&retour=${encodeURIComponent(`/apprendre/${level.id}`)}">Passer le contrôle du palier ${k + 1}</a>
      </div></div>`;
    root.querySelectorAll(".reread").forEach((b) => b.addEventListener("click", () => { i = ids.indexOf(b.dataset.id); show(); }));
    m.clear();
    for (const id of list) m.draw(item(id), { style: "normal", label: true });
    m.fit(list.map(item), { pad: 40, maxZoom: 15 });
  }

  function showEnd() {
    renderPaliers(nP - 1);
    $(".learn-nav").hidden = true;
    $(".learn-body").innerHTML = `<div class="result"><h2>Niveau découvert</h2>
      <p class="muted">Les ${nP} paliers de « ${esc(level.title)} » sont validés. Les éléments reviendront dans vos révisions au bon moment ; vous pouvez passer l'examen du niveau.</p>
      <div class="fb-actions col">
        <a class="btn primary" href="#/jouer/examen?niveau=${level.id}">Passer l'examen</a>
        <a class="btn" href="#/jouer/${level.ring ? "portes" : "axes"}?niveau=${level.id}">${level.ring ? "Les portes dans l'ordre" : "Grands axes : dans l'ordre"}</a>
        <a class="btn" href="#/jouer/retrouve?niveau=${level.id}">Retrouver sur la carte</a>
      </div></div>`;
    m.clear();
    for (const x of ids) m.draw(item(x), { style: "normal", label: false });
    m.fit(ids.map(item), { pad: 30 });
  }

  $(".prev").addEventListener("click", () => { if (i > 0) { i--; show(); } });
  $(".ok").addEventListener("click", () => {
    const id = ids[i];
    if (store.markLearned(id)) store.addXP(5);
    const b = store.checkBadges();
    store.save();
    b.forEach((x) => toast(`Badge : ${x.name}`, "gold"));
    const k = palierOf(i);
    const endOfPalier = (i + 1) % P === 0 || i + 1 >= ids.length;
    if (endOfPalier && k >= store.paliersPassed(level)) {
      // palier en cours : tout découvert ? contrôle ; sinon, retour au premier élément non vu
      if (store.palierLearned(level, k)) return showGate(k);
      i = store.palierItems(level, k).map((x) => ids.indexOf(x)).find((x) => !store.getCard(ids[x])?.learned);
      toast("Il reste des éléments à découvrir dans ce palier");
      return show();
    }
    if (i + 1 >= ids.length) return store.allPaliersPassed(level) ? showEnd() : showGate(k);
    i++;
    show();
  });
  const onKey = (e) => {
    if (e.key === "ArrowRight") $(".ok")?.click();
    if (e.key === "ArrowLeft") $(".prev")?.click();
  };
  document.addEventListener("keydown", onKey);

  // arrivée : palier en cours entièrement découvert mais pas validé → contrôle ; tout validé → fin
  const cur = store.paliersPassed(level);
  if (store.allPaliersPassed(level) && !params.get("item")) showEnd();
  else if (cur < nP && store.palierLearned(level, cur) && !params.get("item")) showGate(cur);
  else show();
  return () => { document.removeEventListener("keydown", onKey); m.destroy(); };
}
