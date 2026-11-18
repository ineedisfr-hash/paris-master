import { DB, item } from "../data.js";
import * as store from "../store.js";
import { esc, fmtPct, dayKey, arrLabel } from "../util.js";

const TYPE_LABEL = {
  arrOf: "Arrondissement", arrRecog: "Reconnaissance", linkAxis: "Liaisons", route: "Parcours", crosses: "Intersections",
  nearAxis: "Repères", nearLandmark: "Repères", identify: "Identification", locate: "Localisation",
};

export default function stats(root) {
  const S = store.S;
  const cards = Object.entries(S.cards);
  const answers = cards.reduce((s, [, c]) => s + c.seen, 0);
  const ok = cards.reduce((s, [, c]) => s + c.ok, 0);
  const time = cards.reduce((s, [, c]) => s + c.time, 0);
  const dist = [0, 0, 0, 0, 0, 0];
  for (const it of DB.items) dist[store.mastery(it.id)]++;

  // 14 derniers jours
  const days = [];
  for (let k = 13; k >= 0; k--) {
    const d = new Date(); d.setDate(d.getDate() - k);
    const key = dayKey(d);
    days.push({ key, label: d.toLocaleDateString("fr-FR", { weekday: "narrow" }), xp: S.days[key]?.xp || 0 });
  }
  const maxXp = Math.max(S.settings.dailyGoal, ...days.map((d) => d.xp));

  const byArr = DB.arrs.map((a) => {
    const ids = DB.items.filter((i) => i.arr.includes(a.n) && i.levels.length).map((i) => i.id);
    const seen = ids.reduce((s, id) => s + (S.cards[id]?.seen || 0), 0);
    const good = ids.reduce((s, id) => s + (S.cards[id]?.ok || 0), 0);
    return { a, n: ids.length, mastered: ids.filter((id) => store.mastery(id) >= 4).length, rate: seen ? good / seen : null, status: store.arrStatus(a.n) };
  }).filter((x) => x.n);

  const hard = cards.filter(([, c]) => c.ko > 0).sort((a, b) => b[1].ko / b[1].seen - a[1].ko / a[1].seen || b[1].ko - a[1].ko).slice(0, 10);

  const errTypes = {};
  for (const e of S.errors) errTypes[TYPE_LABEL[e.type] || e.type] = (errTypes[TYPE_LABEL[e.type] || e.type] || 0) + 1;

  root.innerHTML = `
  <section class="page">
    <h1>Statistiques</h1>
    <dl class="stats-mini wide">
      <div><dt>Réponses</dt><dd>${answers}</dd></div>
      <div><dt>Taux de réussite</dt><dd>${answers ? fmtPct(ok / answers) : "—"}</dd></div>
      <div><dt>Temps moyen</dt><dd>${answers ? `${(time / answers / 1000).toFixed(1).replace(".", ",")} s` : "—"}</dd></div>
      <div><dt>Série du jour</dt><dd>${store.streak()} j</dd></div>
      <div><dt>Meilleure série</dt><dd>${S.bestCombo}</dd></div>
      <div><dt>Meilleure précision</dt><dd>${S.bestLocate === null ? "—" : `${S.bestLocate} m`}</dd></div>
    </dl>

    <section class="panel">
      <h2>XP sur 14 jours</h2>
      <div class="bars">${days.map((d) => `<div title="${d.key} : ${d.xp} XP"><i style="height:${(d.xp / maxXp) * 100}%" class="${d.xp >= S.settings.dailyGoal ? "met" : ""}"></i><span>${d.label}</span></div>`).join("")}</div>
      <p class="small muted">Objectif quotidien : ${S.settings.dailyGoal} XP (barres vertes = objectif atteint).</p>
    </section>

    <section class="panel">
      <h2>Niveau de maîtrise</h2>
      <ul class="mastery-dist">${store.MASTERY_LABELS.map((l, k) => `<li><i class="m${k}"></i>${l}<strong>${dist[k]}</strong></li>`).join("")}</ul>
      <p class="small muted">Un élément est « maîtrisé » quand il revient à 7 jours d'intervalle sans erreur, « ancré » à 21 jours.</p>
    </section>

    <section class="panel">
      <h2>Par arrondissement</h2>
      <table class="tbl"><thead><tr><th>Arr.</th><th>Éléments</th><th>Maîtrisés</th><th>Réussite</th></tr></thead>
      <tbody>${byArr.map((x) => `<tr class="st-${x.status}"><td>${arrLabel(x.a.n)} <small>${esc(x.a.name)}</small></td><td>${x.n}</td><td>${x.mastered}</td><td>${x.rate === null ? "—" : fmtPct(x.rate)}</td></tr>`).join("")}</tbody></table>
    </section>

    <section class="panel">
      <h2>Points faibles</h2>
      ${hard.length ? `<ul class="errors">${hard.map(([id, c]) => {
        const conf = Object.entries(c.confused).sort((a, b) => b[1] - a[1])[0];
        return `<li><a href="#/carte?item=${id}">${esc(item(id)?.name || id)}</a><small>${c.ko} erreur${c.ko > 1 ? "s" : ""} sur ${c.seen}${conf && item(conf[0]) ? ` · souvent confondu avec ${esc(item(conf[0]).name)}` : ""}</small></li>`;
      }).join("")}</ul>
      <a class="btn primary" href="#/jouer/revision">Réviser maintenant</a>` : `<p class="muted">Pas encore d'erreur enregistrée.</p>`}
    </section>

    ${S.errors.length ? `<section class="panel"><h2>Historique des erreurs</h2>
      <p class="small muted">${Object.entries(errTypes).map(([k, v]) => `${esc(k)} : ${v}`).join(" · ")}</p>
      <ul class="errors">${S.errors.slice(0, 20).map((e) => `<li><a href="#/carte?item=${e.id}">${esc(item(e.id)?.name || e.id)}</a><small>${esc(TYPE_LABEL[e.type] || e.type)} · ${new Date(e.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}${e.chosen && item(e.chosen) ? ` · répondu : ${esc(item(e.chosen).name)}` : ""}</small></li>`).join("")}</ul></section>` : ""}
  </section>`;
}
