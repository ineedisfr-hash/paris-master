import { DB, item, CATS } from "../data.js";
import * as store from "../store.js";
import { esc, fmtPct, arrText } from "../util.js";

export default function levels(root) {
  root.innerHTML = `
  <section class="page">
    <h1>Parcours</h1>
    <p class="lead">Chaque niveau se fait par paliers de 5 éléments : un contrôle réussi à 80 % ouvre le palier suivant, et l'examen du niveau s'ouvre quand tous les paliers sont validés. Le squelette, le centre et les portes sont ouverts d'emblée ; ensuite, un examen réussi à 85 % ouvre le niveau suivant.</p>
    <ol class="levels">
      ${DB.levels.map((l) => {
        const p = store.levelProgress(l);
        const open = store.levelUnlocked(l.id);
        const rec = store.S.levels[l.id];
        const passed = store.levelPassed(l.id);
        const prev = DB.levels[DB.levels.indexOf(l) - 1];
        const cats = {};
        for (const id of l.items) { const c = item(id).cat; cats[c] = (cats[c] || 0) + 1; }
        return `
        <li id="n${l.id}" class="level ${open ? "" : "locked"} ${passed ? "passed" : ""}">
          <div class="lv-head">
            <span class="lv-num">${l.id}</span>
            <div>
              <h2>${esc(l.title)}</h2>
              <p class="muted small">${esc(l.subtitle)}${!l.arrondissements.length ? "" : ` · ${l.arrondissements.length > 1 ? `${arrText(l.arrondissements)} arrondissements` : `${arrText(l.arrondissements)} arrondissement`}`}</p>
            </div>
            <span class="lv-state">${passed ? "Validé" : open ? fmtPct(p.pct) : "Verrouillé"}</span>
          </div>
          <div class="xpbar thin"><i style="width:${p.pct * 100}%"></i></div>
          <p class="small muted">${p.total} éléments · ${Object.entries(cats).map(([c, n]) => `${n} ${(CATS[c] || CATS.voie)[n > 1 ? "plural" : "label"].toLowerCase()}`).join(", ")}
            · ${p.learned} découverts · ${p.mastered} maîtrisés${rec ? ` · meilleur examen ${fmtPct(rec.best)}` : ""}</p>
          ${open ? `<p class="paliers small">${Array.from({ length: store.palierCount(l) }, (_, k) => `<span class="pal ${k < store.paliersPassed(l) ? "done" : k === store.paliersPassed(l) ? "now" : "locked"}">${k + 1}</span>`).join("")}<span class="muted">${store.paliersPassed(l)}/${store.palierCount(l)} paliers validés</span></p>` : ""}
          ${open ? `
          <div class="lv-actions">
            <a class="btn ${!store.allPaliersPassed(l) ? "primary" : ""}" href="#/apprendre/${l.id}">${store.allPaliersPassed(l) ? "Revoir les fiches" : `Palier ${store.paliersPassed(l) + 1}`}</a>
            <a class="btn" href="#/jouer/${l.ring ? "portes" : "axes"}?niveau=${l.id}">${l.ring ? "Les portes" : "Grands axes"}</a>
            <a class="btn" href="#/jouer/quiz?niveau=${l.id}">Quiz</a>
            <a class="btn" href="#/jouer/retrouve?niveau=${l.id}">Localiser</a>
            <a class="btn" href="#/jouer/identifie?niveau=${l.id}">Identifier</a>
            ${store.allPaliersPassed(l) || store.S.settings.unlockAll ? `<a class="btn ${!passed ? "primary" : ""}" href="#/jouer/examen?niveau=${l.id}">Examen</a>` : `<span class="btn disabled" title="Validez d'abord tous les paliers">Examen 🔒</span>`}
          </div>
          <details><summary>Contenu du niveau</summary>
            <ul class="lv-items">${l.items.map((id) => { const it = item(id); const mm = store.mastery(id); return `<li><a href="#/carte?item=${id}"><i class="m${mm}"></i>${esc(it.name)}</a><small>${arrText(it.arr)}</small></li>`; }).join("")}</ul>
          </details>` : `<p class="small muted">Réussissez l'examen « ${esc(prev?.title || "")} » pour débloquer ce niveau.</p>`}
        </li>`;
      }).join("")}
    </ol>
  </section>`;
  const target = location.hash.split("#")[2];
  if (target) root.querySelector(`#${target}`)?.scrollIntoView({ block: "start" });
}
