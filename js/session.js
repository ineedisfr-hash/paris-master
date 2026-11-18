// Moteur de session commun à tous les modes de jeu (quiz, localisation, chrono, examen, défi du jour…).
import { DB, item, levelById, withArticle } from "./data.js";
import { createMap } from "./map.js";
import { distToItem, nearestPoint, arrAt, precisionScore } from "./geo.js";
import { GEN, MODES, makeQuestion } from "./questions.js";
import * as store from "./store.js";
import { sound, buzz, floatText, shake, celebrate } from "./fx.js";
import { esc, shuffle, fmtDist, fmtPct, arrLabel, arrText, dayKey } from "./util.js";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Pool d'éléments jouables : un niveau, ou tous les niveaux débloqués. */
export function poolFor({ mode, levelId, items = null }) {
  const m = MODES[mode];
  let ids;
  if (items?.length) return items.filter((id) => item(id));
  if (levelId !== null && levelId !== undefined) ids = levelById(levelId).items;
  else ids = [...new Set(DB.levels.filter((l) => store.levelUnlocked(l.id)).flatMap((l) => l.items))];
  if (m.filter) ids = ids.filter((id) => m.filter(item(id)));
  // on ne joue que sur ce qui a été découvert en mode Apprendre (sauf examen, qui suppose tout appris)
  if (mode !== "examen" && !store.S.settings.unlockAll) ids = store.learnedOnly(ids);
  return ids;
}

/** Exécute fn avec un Math.random déterministe (même défi pour toute la journée). */
function seeded(seedText, fn) {
  let h = 1779033703;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  const rnd = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const orig = Math.random;
  Math.random = rnd;
  try { return fn(); } finally { Math.random = orig; }
}

const EXAM_PLAN = ["locate", "locate", "locate", "locate", "locate", "identify", "identify", "identify", "arrOf", "arrOf", "arrOf", "arrRecog", "linkAxis", "route", "crosses", "nearAxis", "order", "order", "between", "ringMember"];

function buildPlan({ mode, levelId, count, items }) {
  const m = MODES[mode];
  let pool = poolFor({ mode, levelId, items });
  if (mode === "revision") {
    const due = store.dueIds(pool);
    if (due.length) pool = due;
    else {
      // rien d'échu : les éléments déjà vus les plus fragiles
      const seen = pool.filter((id) => store.getCard(id)?.seen);
      pool = seen.sort((a, b) => (store.getCard(b).ko / store.getCard(b).seen) - (store.getCard(a).ko / store.getCard(a).seen)).slice(0, 15);
    }
  }
  if (!pool.length) return [];
  const plan = [];
  const used = {};
  if (mode === "examen") {
    for (const g of shuffle(EXAM_PLAN)) {
      const cands = shuffle(pool).sort((a, b) => (used[a] || 0) - (used[b] || 0));
      // si aucun élément du niveau ne se prête à ce type de question, on localise à la place
      for (const gen of [g, "locate"]) {
        const id = cands.find((x) => GEN[gen](item(x)));
        if (id) { plan.push(GEN[gen](item(id))); used[id] = (used[id] || 0) + 1; break; }
      }
    }
    return plan;
  }
  if (mode === "defi") {
    return seeded(dayKey() + "|" + pool.length, () => {
      for (const id of shuffle(pool)) {
        if (plan.length >= count) break;
        const q = makeQuestion(item(id), m.gens);
        if (q) plan.push(q);
      }
      return plan;
    });
  }
  let guard = 0;
  while (plan.length < count && guard++ < count * 6) {
    const batch = store.weightedPick(pool, Math.min(pool.length, count - plan.length));
    for (const id of batch) {
      if (plan.length >= count) break;
      if ((used[id] || 0) >= 2) continue;
      const q = makeQuestion(item(id), m.gens);
      if (q) { plan.push(q); used[id] = (used[id] || 0) + 1; }
    }
  }
  return plan;
}

export function runSession(root, opts) {
  const { mode, levelId = null, timeLimit = null, items = null, back = null, palier = null } = opts;
  const m = MODES[mode];
  const count = opts.count || m.count;
  const plan = buildPlan({ mode, levelId, count, items });
  const level = levelId !== null ? levelById(levelId) : null;
  const title = mode === "examen" ? `Examen — ${level.title}` : m.title + (level ? ` — ${level.title}` : "");
  const hintsAllowed = !["examen", "chrono", "defi"].includes(mode);

  if (!plan.length) {
    root.innerHTML = `<section class="page narrow"><h1>${esc(title)}</h1>
      <p class="lead">${mode === "revision" ? "Rien à réviser pour l'instant : commencez par découvrir un niveau, les éléments appris reviendront ici au bon moment." : "Rien à jouer ici pour l'instant : les jeux portent sur les éléments déjà découverts. Commencez par le mode Apprendre, palier par palier."}</p>
      <a class="btn primary" href="#/niveaux">Voir les niveaux</a></section>`;
    return () => {};
  }

  root.innerHTML = `
  <section class="play" data-mode="${mode}">
    <div class="play-map"><div id="pmap"></div></div>
    <div class="play-panel">
      <div class="play-top">
        <a class="icon-btn" href="${back ? esc(back.href) : "#/jouer"}" aria-label="Quitter">✕</a>
        <div class="bar"><i style="width:0"></i></div>
        <span class="count"></span>
        <span class="combo" hidden></span>
        ${timeLimit ? `<span class="timer"></span>` : ""}
      </div>
      <p class="play-title">${esc(title)}</p>
      <div class="q"></div>
      <div class="opts"></div>
      <div class="feedback" hidden></div>
    </div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const mapApi = createMap($("#pmap"), { labels: false, arrNumbers: false });
  mapApi.refresh();

  const gradeBefore = store.grade().index;
  const st = { i: -1, correct: 0, quality: 0, xp: 0, combo: 0, bestCombo: 0, errors: [], started: Date.now(), done: false, timer: null, hints: 0 };
  let qStart = 0, onMapClick = null, pin = null, keyHandler = null, hinted = false;

  // une vue peut désigner un élément par son identifiant ou directement par un objet (tronçon d'anneau)
  const res = (x) => (typeof x === "string" ? item(x) : x);
  function applyView(v = {}, extra = []) {
    mapApi.clear();
    mapApi.setArrNumbers(!!v.arrNumbers);
    mapApi.highlightArr(v.highlightArr ?? null);
    const shows = [...(v.show || []), ...extra];
    for (const [id, style, label] of shows) mapApi.draw(res(id), { style, label });
    if (v.marks) mapApi.marks(v.marks, { stagger: v.marks.length > 3 ? 90 : 0 });
    if (v.fit === "paris" || !v.fit) { if (v.fit === "paris") mapApi.fitParis(); }
    else mapApi.fit(v.fit.map(res), { pad: v.fitPad ?? 50 });
  }

  function updateTop() {
    $(".bar i").style.width = `${((st.i + (st.answered ? 1 : 0)) / plan.length) * 100}%`;
    $(".count").textContent = `${Math.min(st.i + 1, plan.length)}/${plan.length}`;
    const c = $(".combo");
    c.hidden = st.combo < 3;
    c.textContent = `🔥 ×${st.combo}`;
  }

  function hintButton(q) {
    if (!hintsAllowed) return "";
    return `<button class="btn small hint-btn" type="button">Indice <small>(XP ÷ 2)</small></button>`;
  }

  function useHint(q) {
    if (st.answered || hinted) return;
    hinted = true;
    st.hints++;
    const b = $(".hint-btn");
    if (b) b.disabled = true;
    if (q.mode === "mcq") {
      // 50/50 : on retire deux mauvaises réponses
      const wrong = shuffle([...root.querySelectorAll(".opt")].filter((el, i) => !q.options[i].correct)).slice(0, 2);
      wrong.forEach((el) => { el.disabled = true; el.classList.add("gone"); });
    } else {
      const it = item(q.id);
      mapApi.highlightArr(it.arr[0]);
      mapApi.setArrNumbers(true);
      mapApi.fitArr(it.arr[0]);
      $(".hint").textContent = `Indice : c'est ${it.arr.length > 1 ? `notamment dans le ${arrLabel(it.arr[0])} (et ${arrText(it.arr.slice(1))})` : `dans le ${arrLabel(it.arr[0])}`}.`;
    }
  }

  function next() {
    if (st.done) return;
    st.i++;
    st.answered = false;
    hinted = false;
    if (st.i >= plan.length) return finish();
    const q = plan[st.i];
    updateTop();
    const qEl = $(".q");
    qEl.innerHTML = `<span class="skill">${esc(q.skill)}</span><p>${q.prompt.includes("<strong>") ? q.prompt : esc(q.prompt)}</p>`;
    qEl.classList.remove("enter"); void qEl.offsetWidth; qEl.classList.add("enter");
    $(".feedback").hidden = true;
    $(".opts").innerHTML = "";
    applyView(q.before);
    qStart = Date.now();
    if (q.mode === "mcq") {
      $(".opts").innerHTML = q.options.map((o, k) => `<button class="opt" data-k="${k}" style="--d:${k * 45}ms"><kbd>${k + 1}</kbd>${esc(o.label)}</button>`).join("") + hintButton(q);
      root.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => answerMCQ(q, Number(b.dataset.k), b)));
    } else {
      $(".opts").innerHTML = `<p class="hint">Touchez la carte pour poser votre épingle, puis validez.</p><div class="row"><button class="btn primary validate" disabled>Valider ma réponse</button>${hintButton(q)}</div>`;
      pin = null;
      onMapClick = (e) => {
        if (st.answered) return;
        if (pin) pin.remove();
        pin = mapApi.marker([e.latlng.lat, e.latlng.lng], "pin");
        sound.pin();
        $(".validate").disabled = false;
      };
      mapApi.map.on("click", onMapClick);
      $(".validate").addEventListener("click", () => pin && answerLocate(q, pin.getLatLng()));
    }
    $(".hint-btn")?.addEventListener("click", () => useHint(q));
  }

  /** Points, série et effets. Renvoie l'XP gagnée sur la question. */
  function score(quality, ms, anchor) {
    const correct = quality >= 0.6;
    if (correct) { st.combo++; st.correct++; } else st.combo = 0;
    st.bestCombo = Math.max(st.bestCombo, st.combo);
    st.quality += quality;
    let xp = correct ? 10 * quality + Math.min(st.combo, 10) : 0;
    if (timeLimit && correct) xp += Math.max(0, 6 - ms / 1000);
    if (hinted) xp /= 2;
    st.xp += xp;
    if (correct) {
      quality >= 0.95 && !hinted ? sound.perfect() : sound.good();
      buzz(15);
      floatText(anchor, `+${Math.round(xp)} XP`);
      if ([5, 10, 15, 20, 30].includes(st.combo)) { sound.combo(); floatText($(".combo"), `Série de ${st.combo} !`, "gold"); }
      const c = $(".combo");
      c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
    } else {
      sound.bad();
      buzz([40, 60, 40]);
    }
    return correct;
  }

  function answerMCQ(q, k, btn) {
    if (st.answered) return;
    st.answered = true;
    const ms = Date.now() - qStart;
    const o = q.options[k];
    const correct = score(o.correct ? 1 : 0, ms, btn);
    const chosenId = o.correct ? null : o.id || null;
    store.recordAnswer({ id: q.id, quality: o.correct ? (hinted ? 0.7 : 1) : 0, ms, chosen: chosenId, type: q.type });
    if (!correct) { st.errors.push({ q, chosen: o.label }); shake(btn); }
    root.querySelectorAll(".opt").forEach((b, i) => {
      b.disabled = true;
      if (q.options[i].correct) b.classList.add("good");
      else if (i === k) b.classList.add("bad");
    });
    $(".hint-btn")?.remove();
    const extra = chosenId && item(chosenId) && q.type !== "ringMember" ? [[chosenId, "bad", true]] : [];
    applyView({ ...q.after, fit: q.after.fit ? [...q.after.fit, ...extra.map((e) => e[0])] : q.after.fit }, extra);
    feedback(q, correct, correct ? (hinted ? "Bonne réponse (avec indice)" : "Bonne réponse !") : `Réponse : ${q.options.find((x) => x.correct).label}`);
  }

  function answerLocate(q, ll) {
    if (st.answered) return;
    st.answered = true;
    mapApi.map.off("click", onMapClick);
    const it = item(q.id);
    const latlng = [ll.lat, ll.lng];
    const d = distToItem(latlng, it);
    const quality = precisionScore(d, 60, 500);
    const ms = Date.now() - qStart;
    const correct = score(quality, ms, $(".validate"));
    store.recordAnswer({ id: q.id, quality: hinted ? Math.min(quality, 0.7) : quality, ms, type: q.type });
    if (store.S.bestLocate === null || d < store.S.bestLocate) store.S.bestLocate = Math.round(d);
    if (!correct) st.errors.push({ q, chosen: `à ${fmtDist(d)}` });
    applyView({ show: q.after.show, arrNumbers: true });
    pin = mapApi.marker(latlng, "pin");
    const np = nearestPoint(latlng, it);
    if (d > 0) mapApi.dashed(latlng, np);
    mapApi.fitLatLngs([latlng, np, it.point], { pad: 60, maxZoom: 16 });
    const clickedArr = arrAt(latlng);
    const verdict = d <= 30 ? "Pile dessus !" : d <= 100 ? "Excellent" : d <= 250 ? "Bien" : d <= 600 ? "Pas loin" : "Trop loin";
    const arrNote = clickedArr && !it.arr.includes(clickedArr) ? ` Vous avez touché le ${arrLabel(clickedArr)}.` : "";
    $(".opts").innerHTML = `<div class="meter"><i style="--p:${quality}"></i><span>Précision ${Math.round(quality * 100)} %</span></div>`;
    feedback(q, correct, `${verdict} — ${d === 0 ? "en plein dessus" : fmtDist(d)}`, arrNote);
  }

  function feedback(q, correct, head, extra = "") {
    updateTop();
    const fb = $(".feedback");
    fb.hidden = false;
    fb.className = `feedback ${correct ? "ok" : "ko"}`;
    if (timeLimit) {
      fb.innerHTML = `<strong>${esc(head)}</strong>`;
      setTimeout(next, correct ? 450 : 1100);
      return;
    }
    fb.innerHTML = `<strong>${esc(head)}</strong><p>${esc(q.explain)}${esc(extra)}</p>
      <div class="fb-actions"><a class="link" href="#/carte?item=${q.id}">Voir la fiche</a><button class="btn primary nextq">${st.i + 1 >= plan.length ? "Voir le résultat" : "Question suivante"}</button></div>`;
    fb.querySelector(".nextq").addEventListener("click", next);
    fb.querySelector(".nextq").focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 860px)").matches) fb.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function finish() {
    if (st.done) return;
    st.done = true;
    clearInterval(st.timer);
    const answered = Math.min(st.i, plan.length);
    const total = mode === "examen" ? plan.length : Math.max(answered, 1);
    const pct = st.correct / (timeLimit ? plan.length : total);
    let xp = st.xp;
    if (timeLimit) xp *= 0.5 + 0.5 * pct * pct; // la vitesse ne paie que si la précision suit
    let examMsg = "";
    const celebrations = [];
    if (mode === "examen") {
      const newly = store.recordExam(levelId, pct);
      if (pct >= 0.85) {
        xp += newly ? 100 : 20;
        const idx = DB.levels.findIndex((l) => l.id === levelId);
        const nxt = DB.levels[idx + 1];
        examMsg = `<p class="pass">Niveau validé${newly && nxt ? ` — « ${esc(nxt.title)} » est débloqué` : ""}.</p>`;
        if (newly) celebrations.push({ kicker: "Niveau validé", title: level.title, text: nxt ? `Nouveau niveau débloqué : ${nxt.title}` : "Tous les niveaux sont validés !" });
      } else {
        examMsg = `<p class="fail">Il faut 85 % pour valider. Revoyez les erreurs ci-dessous, puis retentez.</p>`;
      }
    }
    if (mode === "palier") {
      const L = levelById(levelId);
      if (pct >= store.PALIER_PASS) {
        const newly = store.passPalier(levelId, palier);
        xp += newly ? 25 : 5;
        const done = store.allPaliersPassed(L);
        examMsg = `<p class="pass">Palier ${palier + 1} validé${done ? " : tous les paliers sont faits, l'examen du niveau est ouvert." : " : le palier suivant est ouvert."}</p>`;
        if (newly) celebrations.push({ kicker: "Palier validé", title: `${L.title} — palier ${palier + 1}/${store.palierCount(L)}`, text: done ? "Tous les paliers sont validés : place à l'examen du niveau." : "Les 5 éléments suivants vous attendent." });
      } else {
        examMsg = `<p class="fail">Il faut ${Math.round(store.PALIER_PASS * 100)} % pour valider le palier. Relisez les fiches de ce palier, puis refaites le contrôle.</p>`;
      }
    }
    if (mode === "defi") {
      const k = dayKey();
      const first = !store.S.daily[k];
      store.S.daily[k] = { best: Math.max(store.S.daily[k]?.best || 0, st.correct), total: plan.length };
      if (first) { xp += 30; examMsg = `<p class="pass">Défi du jour relevé : +30 XP de bonus. Revenez demain pour un nouveau défi.</p>`; }
      else examMsg = `<p class="muted">Défi déjà relevé aujourd'hui : le bonus n'est compté qu'une fois.</p>`;
    }
    if (timeLimit) {
      const k = `${plan.length}-${timeLimit}`;
      const prev = store.S.chrono[k] || { best: 0, perfect: false };
      if (st.correct > prev.best && prev.best > 0) celebrations.push({ kicker: "Nouveau record chrono", title: `${st.correct} bonnes réponses`, text: `Ancien record : ${prev.best}` });
      store.S.chrono[k] = { best: Math.max(prev.best, st.correct), perfect: prev.perfect || st.correct === plan.length };
    }
    const gained = store.addXP(xp);
    store.S.bestCombo = Math.max(store.S.bestCombo, st.bestCombo);
    const badges = store.checkBadges();
    store.save();
    const g = store.grade();
    if (g.index > gradeBefore) celebrations.unshift({ kicker: "Nouveau grade", title: g.name, text: g.next ? `Prochain grade : ${g.next.name} (${g.next.xp} XP)` : "Grade maximal atteint." });
    for (const b of badges) celebrations.push({ kicker: "Badge obtenu", title: b.name, text: b.desc });

    mapApi.clear();
    const few = new Set(st.errors.map((e) => e.q.id)).size <= 4; // au-delà, les étiquettes se chevauchent
    for (const e of st.errors) mapApi.draw(item(e.q.id), { style: "bad", label: few });
    if (st.errors.length) mapApi.fit(st.errors.map((e) => item(e.q.id)), { pad: 40, maxZoom: 15 });
    else mapApi.fitParis();
    const elapsed = Math.round((Date.now() - st.started) / 1000);
    const stars = pct >= 0.95 ? 3 : pct >= 0.75 ? 2 : pct >= 0.5 ? 1 : 0;
    root.querySelector(".play-panel").innerHTML = `
      <div class="result">
        <p class="play-title">${esc(title)}</p>
        <div class="stars" aria-label="${stars} étoile${stars > 1 ? "s" : ""} sur 3">${[1, 2, 3].map((n) => `<i class="${n <= stars ? "on" : ""}" style="--d:${n * 180}ms"></i>`).join("")}</div>
        <h2 class="count-up" data-to="${Math.round(pct * 100)}">0 %</h2>
        <p class="muted">${st.correct} bonne${st.correct > 1 ? "s" : ""} réponse${st.correct > 1 ? "s" : ""} sur ${timeLimit ? plan.length : total}${timeLimit ? ` · ${answered < plan.length ? "temps écoulé" : `${elapsed} s`}` : ""} · meilleure série ${st.bestCombo}${st.hints ? ` · ${st.hints} indice${st.hints > 1 ? "s" : ""}` : ""}</p>
        ${examMsg}
        <p class="xp-gain">+${gained} XP</p>
        ${st.errors.length ? `<h3>À revoir</h3><ul class="errors">${st.errors.map((e) => `<li><a href="#/carte?item=${e.q.id}">${esc(item(e.q.id).name)}</a><small>${esc(e.q.skill)} · votre réponse : ${esc(e.chosen)}</small></li>`).join("")}</ul>` : `<p class="muted">Aucune erreur. Bravo !</p>`}
        <div class="fb-actions">
          ${back ? `<button class="btn again">Rejouer</button><a class="btn primary" href="${esc(back.href)}">${esc(back.label)}</a>` : `<a class="btn" href="#/jouer">Autres modes</a><button class="btn primary again">Rejouer</button>`}
        </div>
      </div>`;
    root.querySelector(".play-panel").scrollTop = 0;
    const h = root.querySelector(".count-up");
    const to = Number(h.dataset.to), t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 700); h.textContent = `${Math.round(to * k)} %`; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    root.querySelector(".again").addEventListener("click", () => opts.onRestart?.());
    if (stars === 3 && !celebrations.length) sound.fanfare();
    setTimeout(() => celebrations.forEach(celebrate), 500);
  }

  keyHandler = (e) => {
    if (st.done || e.target.matches("input, textarea, select")) return;
    const q = plan[st.i];
    if (!q) return;
    if (!st.answered && q.mode === "mcq" && /^[1-4]$/.test(e.key)) root.querySelectorAll(".opt")[Number(e.key) - 1]?.click();
    else if (!st.answered && (e.key === "h" || e.key === "?")) $(".hint-btn")?.click();
    else if (st.answered && e.key === "Enter" && document.activeElement?.classList.contains("nextq") === false) root.querySelector(".nextq")?.click();
  };
  document.addEventListener("keydown", keyHandler);

  if (timeLimit) {
    const end = Date.now() + timeLimit * 1000;
    let lastLeft = null;
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      const t = root.querySelector(".timer");
      if (t) { t.textContent = `${left} s`; t.classList.toggle("low", left <= 10); }
      if (left !== lastLeft && left <= 5 && left > 0) sound.tick();
      lastLeft = left;
      if (left <= 0) finish();
    };
    st.timer = setInterval(tick, 250);
    tick();
  }
  next();

  return () => {
    clearInterval(st.timer);
    document.removeEventListener("keydown", keyHandler);
    // une séance quittée en cours garde ses réponses et l'XP déjà gagnée
    if (!st.done && st.xp > 0) { store.addXP(st.xp); store.S.bestCombo = Math.max(store.S.bestCombo, st.bestCombo); store.checkBadges(); }
    store.save();
    mapApi.destroy();
  };
}

export { withArticle, cap };
