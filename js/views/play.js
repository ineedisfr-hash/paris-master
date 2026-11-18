import { DB, levelById } from "../data.js";
import { MODES } from "../questions.js";
import { runSession, poolFor } from "../session.js";
import * as store from "../store.js";
import { esc, dayKey } from "../util.js";

const CHRONO = [
  { n: 10, t: 60 },
  { n: 20, t: 120 },
  { n: 30, t: 180 },
];

export function menu(root) {
  const unlocked = DB.levels.filter((l) => store.levelUnlocked(l.id));
  const due = store.dueIds().length;
  const order = ["defi", "revision", "axes", "portes", "quiz", "retrouve", "identifie", "chrono", "monuments", "parcours"];
  root.innerHTML = `
  <section class="page">
    <h1>Jouer</h1>
    <p class="lead">Les questions portent sur les niveaux débloqués. Les éléments que vous ratez reviennent plus souvent.</p>
    <label class="field">Niveau
      <select class="lvl"><option value="">Tous les niveaux débloqués</option>${unlocked.map((l) => `<option value="${l.id}">${l.id}. ${esc(l.title)}</option>`).join("")}</select>
    </label>
    <ul class="modes">
      ${order.map((k) => {
        const m = MODES[k];
        const today = store.S.daily[dayKey()];
        const extra = k === "revision" ? `<span class="pill">${due} dû${due > 1 ? "s" : ""}</span>` : k === "defi" ? `<span class="pill">${today ? `fait ${today.best}/${today.total}` : "à relever"}</span>` : "";
        const chrono = k === "chrono" ? `<div class="chrono-fmt">${CHRONO.map((c) => `<a class="btn small" data-mode="chrono" data-fmt="${c.n}-${c.t}" href="#">${c.n} questions · ${c.t} s</a>`).join("")}</div>` : "";
        return `<li class="mode${k === "defi" ? " featured" : ""}">
          <a class="mode-main" data-mode="${k}" href="#"><strong>${esc(m.title)} ${extra}</strong><small>${esc(m.desc)}</small></a>${chrono}</li>`;
      }).join("")}
    </ul>
    <h2>Examens</h2>
    <ul class="exams">${DB.levels.map((l) => {
      const open = store.levelUnlocked(l.id);
      const rec = store.S.levels[l.id];
      return `<li class="${open ? "" : "locked"}">${open ? `<a href="#/jouer/examen?niveau=${l.id}">` : "<span>"}${l.id}. ${esc(l.title)} <small>${rec ? `meilleur ${Math.round(rec.best * 100)} %${rec.passed ? " · validé" : ""}` : open ? "non tenté" : "verrouillé"}</small>${open ? "</a>" : "</span>"}</li>`;
    }).join("")}</ul>
  </section>`;
  root.querySelectorAll("[data-mode]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const lvl = root.querySelector(".lvl").value;
    const q = new URLSearchParams();
    if (lvl) q.set("niveau", lvl);
    if (a.dataset.fmt) q.set("format", a.dataset.fmt);
    else if (a.dataset.mode === "chrono") q.set("format", "10-60");
    location.hash = `#/jouer/${a.dataset.mode}${q.toString() ? "?" + q : ""}`;
  }));
}

export function session(root, params, [mode]) {
  if (!MODES[mode]) { location.hash = "#/jouer"; return; }
  const levelId = params.get("niveau") !== null && params.get("niveau") !== "" ? Number(params.get("niveau")) : null;
  const palier = params.get("palier") !== null && levelId !== null ? Number(params.get("palier")) : null;
  const items = palier !== null ? store.palierItems(levelById(levelId), palier) : params.get("items") ? params.get("items").split(",") : null;
  const back = params.get("retour") ? { href: "#" + params.get("retour"), label: "Continuer l'apprentissage" } : null;
  if (levelId !== null && (!levelById(levelId) || !store.levelUnlocked(levelId))) { location.hash = "#/niveaux"; return; }
  if (mode === "examen" && levelId === null) { location.hash = "#/jouer"; return; }
  // l'examen d'un niveau s'ouvre quand tous ses paliers sont validés
  if (mode === "examen" && !store.allPaliersPassed(levelById(levelId)) && !store.S.settings.unlockAll) { location.hash = `#/apprendre/${levelId}`; return; }
  let count, timeLimit = null;
  if (mode === "chrono") {
    const [n, t] = (params.get("format") || "10-60").split("-").map(Number);
    const f = CHRONO.find((c) => c.n === n && c.t === t) || CHRONO[0];
    count = f.n; timeLimit = f.t;
  }
  let cleanup = null;
  const start = () => {
    cleanup?.();
    cleanup = runSession(root, { mode, levelId, count, timeLimit, items, back, palier, onRestart: start });
  };
  start();
  return () => cleanup?.();
}

export { poolFor };
