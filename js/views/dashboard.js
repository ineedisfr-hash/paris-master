import { DB, item } from "../data.js";
import { createMap, arrColor } from "../map.js";
import * as store from "../store.js";
import { esc, fmtPct, dayKey } from "../util.js";
import { MODES } from "../questions.js";

const STATUS = {
  valide: { label: "Maîtrisé", color: "#4ade80", op: 0.5 },
  encours: { label: "En cours", color: "#f2b33d", op: 0.42 },
  nouveau: { label: "Non commencé", color: "#7c8ba1", op: 0.22 },
  hors: { label: "Hors programme", color: "#0b0f14", op: 0.7 },
};

/** Prochaine action recommandée, déduite de l'état réel de la progression. */
export function nextAction() {
  const due = store.dueIds().length;
  if (due) return { href: "#/jouer/revision", label: `Réviser ${due} élément${due > 1 ? "s" : ""}`, sub: "Révisions dues aujourd'hui (répétition espacée)" };
  const lv = DB.levels.find((l) => store.levelUnlocked(l.id) && !store.levelPassed(l.id));
  if (!lv) return { href: "#/jouer/chrono", label: "Défi chrono", sub: "Tous les niveaux sont validés : entretenez vos réflexes" };
  const k = store.paliersPassed(lv), n = store.palierCount(lv);
  if (k < n) {
    const ready = store.palierLearned(lv, k);
    return { href: `#/apprendre/${lv.id}`, label: `${lv.title} — palier ${k + 1}/${n}`, sub: ready ? "Palier découvert : contrôle à passer (80 %)" : "5 éléments à découvrir, puis un contrôle" };
  }
  return { href: `#/jouer/examen?niveau=${lv.id}`, label: `Passer l'examen : ${lv.title}`, sub: "Tous les paliers sont validés · examen à 85 %" };
}

export default function dashboard(root) {
  const S = store.S;
  const g = store.grade();
  const t = store.todayStats();
  const goal = S.settings.dailyGoal;
  const streak = store.streak();
  const na = nextAction();
  const totalItems = DB.items.length;
  const mastered = DB.items.filter((i) => store.mastery(i.id) >= 4).length;
  const answers = Object.values(S.cards).reduce((s, c) => s + c.seen, 0);
  const ok = Object.values(S.cards).reduce((s, c) => s + c.ok, 0);
  const earned = store.BADGES.filter((b) => S.badges[b.id]);

  root.innerHTML = `
  <section class="page dash">
    <header class="hello">
      <div>
        <p class="eyebrow">${S.profile.name ? `${esc(S.profile.name)} · ` : ""}Niveau ${store.xpLevel()} · ${S.xp} XP</p>
        <h1>${esc(g.name)}</h1>
        <div class="xpbar" title="${g.next ? `${g.next.xp - S.xp} XP avant ${g.next.name}` : "Grade maximal"}"><i style="width:${g.progress * 100}%"></i></div>
        <p class="muted small">${g.next ? `${g.next.xp - S.xp} XP avant « ${esc(g.next.name)} »` : "Grade maximal atteint"}</p>
      </div>
      <a class="icon-btn" href="#/profil" aria-label="Profil et réglages">⚙</a>
    </header>

    <a class="continue" href="${na.href}">
      <span class="eyebrow">Continuer mon apprentissage</span>
      <strong>${esc(na.label)}</strong>
      <span class="muted small">${esc(na.sub)}</span>
      <span class="arrow">→</span>
    </a>

    ${(() => {
      const d = S.daily[dayKey()];
      const ds = store.dailyStreak();
      return `<a class="daily ${d ? "done" : ""}" href="#/jouer/defi">
        <span class="daily-ic" aria-hidden="true"></span>
        <span><strong>Défi du jour</strong><small>${d ? `Relevé : ${d.best}/${d.total} · rejouable sans bonus` : "10 questions · +30 XP au premier essai"}${ds > 1 ? ` · ${ds} jours d'affilée` : ""}</small></span>
        <span class="arrow">${d ? "✓" : "→"}</span></a>`;
    })()}

    <div class="today">
      <div><span class="big">${t.xp}<small>/${goal}</small></span><span class="muted small">XP aujourd'hui</span>
        <div class="xpbar thin"><i style="width:${Math.min(1, t.xp / goal) * 100}%"></i></div></div>
      <div><span class="big">${streak}</span><span class="muted small">jour${streak > 1 ? "s" : ""} de série</span></div>
      <div><span class="big">${store.dueIds().length}</span><span class="muted small">à réviser</span></div>
    </div>

    <div class="grid2">
      <section class="panel">
        <h2>Ma carte de Paris</h2>
        <div class="mini-map" id="dmap"></div>
        <ul class="legend">${Object.entries(STATUS).map(([k, s]) => `<li><i style="background:${s.color}"></i>${s.label}</li>`).join("")}</ul>
      </section>

      <section class="panel">
        <h2>Mes arrondissements</h2>
        <ul class="levels-mini">
          ${DB.levels.map((l) => {
            const p = store.levelProgress(l);
            const open = store.levelUnlocked(l.id);
            const passed = store.levelPassed(l.id);
            return `<li class="${open ? "" : "locked"}">
              <a href="${open ? `#/niveaux#n${l.id}` : "#/niveaux"}">
                <span class="lv-num">${l.id}</span>
                <span class="lv-t">${esc(l.title)}<small>${passed ? "Validé" : open ? `${fmtPct(p.pct)} · ${p.learned}/${p.total} découverts` : "Verrouillé"}</small></span>
                <span class="ring" style="--p:${p.pct}"></span>
              </a></li>`;
          }).join("")}
        </ul>
      </section>
    </div>

    <section class="panel">
      <h2>Mes défis</h2>
      <div class="modes-mini">
        ${["quiz", "retrouve", "identifie", "chrono", "monuments", "parcours"].map((k) => `<a href="#/jouer/${k}"><strong>${esc(MODES[k].title)}</strong><small>${esc(MODES[k].desc)}</small></a>`).join("")}
      </div>
    </section>

    <div class="grid2">
      <section class="panel">
        <h2>Mes statistiques</h2>
        <dl class="stats-mini">
          <div><dt>Réponses</dt><dd>${answers}</dd></div>
          <div><dt>Réussite</dt><dd>${answers ? fmtPct(ok / answers) : "—"}</dd></div>
          <div><dt>Éléments maîtrisés</dt><dd>${mastered}/${totalItems}</dd></div>
          <div><dt>Meilleure série</dt><dd>${S.bestCombo}</dd></div>
        </dl>
        <a class="link" href="#/stats">Toutes les statistiques →</a>
      </section>
      <section class="panel">
        <h2>Mes badges <small class="muted">${earned.length}/${store.BADGES.length}</small></h2>
        <ul class="badges-mini">${store.BADGES.slice(0, 6).map((b) => `<li class="${S.badges[b.id] ? "on" : ""}" title="${esc(b.desc)}"><span class="medal"></span>${esc(b.name)}</li>`).join("")}</ul>
        <a class="link" href="#/badges">Tous les badges →</a>
      </section>
    </div>
  </section>`;

  const m = createMap(root.querySelector("#dmap"), { labels: false, arrNumbers: true, arrFill: false });
  const L = window.L;
  for (const a of DB.arrs) {
    const s = STATUS[store.arrStatus(a.n)];
    L.polygon(a.rings, { color: arrColor(a.n), weight: 1, opacity: 0.6, fillColor: s.color, fillOpacity: s.op, interactive: false }).addTo(m.map);
  }
  m.map.dragging.disable();
  m.map.scrollWheelZoom.disable();
  m.map.touchZoom.disable();
  m.map.doubleClickZoom.disable();
  m.refresh();
  const fitTimer = setTimeout(() => m.fitParis(), 50);
  return () => { clearTimeout(fitTimer); m.destroy(); };
}
