"""Tests de la logique (répétition espacée, examens, déblocage, génération de questions).
Prérequis : serveur statique sur la racine (python -m http.server 8765 --bind 127.0.0.1)."""
import json, sys
from playwright.sync_api import sync_playwright

JS = r"""
async () => {
  const out = [];
  const ok = (cond, msg) => out.push((cond ? "OK   " : "FAIL ") + msg);
  const data = await import("./js/data.js");
  await data.loadData();
  const store = await import("./js/store.js");
  const Q = await import("./js/questions.js");
  const geo = await import("./js/geo.js");
  const { DB, item } = data;
  store.reset();
  const S = store.S;

  // --- répétition espacée
  const id = "boulevard-voltaire";
  store.recordAnswer({ id, quality: 1, ms: 2000 });
  ok(S.cards[id].reps === 1 && S.cards[id].ivl === 1, "1re bonne réponse → intervalle 1 j");
  store.recordAnswer({ id, quality: 1, ms: 2000 });
  ok(S.cards[id].reps === 1, "2e bonne réponse le même jour : pas d'emballement de l'intervalle");
  S.cards[id].due = Date.now() - 1000;
  store.recordAnswer({ id, quality: 1, ms: 2000 });
  ok(S.cards[id].ivl === 3, "révision échue réussie → 3 j");
  S.cards[id].due = Date.now() - 1000;
  store.recordAnswer({ id, quality: 1, ms: 2000 });
  ok(S.cards[id].ivl >= 7 && store.mastery(id) === 4, `3e révision → ${S.cards[id].ivl} j, maîtrisé`);
  store.recordAnswer({ id, quality: 0, ms: 2000, chosen: "rue-de-charonne" });
  ok(S.cards[id].ivl === 0 && S.cards[id].confused["rue-de-charonne"] === 1 && store.mastery(id) === 1, "erreur → retour en apprentissage + confusion mémorisée");
  ok(S.errors[0].id === id, "erreur ajoutée à l'historique");

  // --- examens et déblocage
  ok(store.levelUnlocked(1) && !store.levelUnlocked(2), "seul le niveau 1 est ouvert au départ");
  ok(store.recordExam(1, 0.8) === false && !store.levelPassed(1), "80 % : examen non validé");
  ok(store.recordExam(1, 0.85) === true && store.levelPassed(1) && store.levelUnlocked(2), "85 % : validé, niveau 2 débloqué");
  ok(!store.levelUnlocked(3), "niveau 3 toujours verrouillé");

  // --- grades
  ok(store.grade(0).name === "Débutant" && store.grade(1000).name === "Connaisseur" && store.grade(99999).name === "Maître de Paris", "grades");

  // --- géométrie : distance d'un point du tracé = 0, arrondissement d'un point connu
  const v = item(id);
  ok(geo.distToItem(v.geom.lines[0][v.geom.lines[0].length - 1], v) < 1, "distance nulle sur le tracé");
  ok(geo.arrAt(item("tour-eiffel").point) === 7, "la tour Eiffel est dans le 7e (point-dans-polygone)");
  ok(geo.arrAt([48.8566, 2.3522]) === 4, "Hôtel de Ville (48.8566, 2.3522) dans le 4e");

  // --- chaque élément peut produire au moins une question, chaque générateur donne des réponses justes
  let noQ = [];
  for (const it of DB.items) if (!Q.makeQuestion(it, Object.keys(Q.GEN))) noQ.push(it.name);
  ok(!noQ.length, "chaque élément a au moins une question (" + noQ.join(", ") + ")");
  let bad = [];
  for (let k = 0; k < 3; k++) for (const it of DB.items) for (const g of Object.keys(Q.GEN)) {
    const q = Q.GEN[g](it);
    if (!q || q.mode !== "mcq") continue;
    const good = q.options.filter((o) => o.correct);
    const labels = new Set(q.options.map((o) => o.label));
    if (good.length !== 1 || labels.size !== q.options.length || q.options.length !== 4) bad.push(`${g}:${it.name}`);
    if (g === "arrOf" || g === "arrRecog") { if (!it.arr.includes(good[0].arr) || q.options.some((o) => !o.correct && it.arr.includes(o.arr))) bad.push(`${g}-arr:${it.name}`); }
    if (g === "linkAxis" && good[0].id !== it.id) bad.push(`linkAxis:${it.name}`);
  }
  ok(!bad.length, "toutes les questions ont 4 options distinctes et une seule bonne réponse" + (bad.length ? " : " + [...new Set(bad)].slice(0, 8).join(", ") : ""));

  // --- grands axes : suites, anneaux, rythme
  const rings = DB.items.filter((x) => x.cat === "anneau");
  ok(rings.length === 3 && rings.every((r) => r.members.length >= 10 && r.lineMember.length === r.geom.lines.length), "3 anneaux complets, chaque tracé rattaché à son boulevard");
  const vol = item("boulevard-voltaire");
  ok(vol.sequence[0].name.includes("République") && vol.sequence.at(-1).name.includes("Nation"), "Voltaire, d'ouest en est : de République à Nation");
  let badOrder = 0;
  for (const it of DB.items.filter((x) => x.sequence?.length >= 3)) for (let k = 0; k < 5; k++) {
    const q = Q.GEN.order(it);
    if (!q) continue;
    const names = q.options.find((o) => o.correct).label.split(" → ");
    const pos = names.map((n) => Q.seqMarks(it).findIndex((m) => m.label === n));
    if (!(pos[0] < pos[1] && pos[1] < pos[2])) badOrder++;
    const bq = Q.GEN.between(it);
    if (bq) {
      const mk = Q.seqMarks(it).map((m) => m.label);
      const [, A, C] = bq.prompt.match(/« (.+) » et « (.+) »/) || [];
      const B = bq.options.find((o) => o.correct).label;
      if (mk.indexOf(B) !== mk.indexOf(A) + 1 || mk.indexOf(C) !== mk.indexOf(B) + 1) badOrder++;
    }
  }
  ok(badOrder === 0, `« Dans l'ordre » et « Entre les deux » conformes au tracé (${badOrder} écart)`);
  let badRing = 0;
  for (let k = 0; k < 40; k++) {
    const r = rings[k % 3], q = Q.GEN.ringMember(r);
    const good = q.options.find((o) => o.correct);
    const inRing = q.prompt.startsWith("Le tronçon");
    if (inRing ? good.id !== r.id : good.label !== "Aucun des trois anneaux") badRing++;
  }
  ok(badRing === 0, "« Quel anneau ? » : bonne réponse toujours juste");
  store.reset();
  ok(store.levelUnlocked(0) && store.levelUnlocked(1) && !store.levelUnlocked(2), "squelette et centre ouverts d'emblée, niveau 2 verrouillé");
  store.S.settings.newPerDay = 3;
  for (const id of ["rue-de-rivoli", "place-vendome", "tour-eiffel"]) store.markLearned(id);
  ok(store.newLeftToday() === 0, "plafond de nouveautés du jour atteint après 3 découvertes (plafond 3)");
  store.reset();

  // --- paliers, portes, police, photos
  store.reset();
  const L1 = data.levelById(1);
  ok(store.palierCount(L1) === Math.ceil(L1.items.length / 5) && store.paliersPassed(L1) === 0, `niveau 1 : ${store.palierCount(L1)} paliers de 5`);
  ok(!store.palierLearned(L1, 0), "palier 1 non découvert au départ");
  for (const id of store.palierItems(L1, 0)) store.markLearned(id);
  ok(store.palierLearned(L1, 0), "palier 1 découvert après ses 5 fiches");
  ok(store.passPalier(1, 1) === false && store.paliersPassed(L1) === 0, "impossible de valider le palier 2 avant le 1");
  ok(store.passPalier(1, 0) === true && store.paliersPassed(L1) === 1, "palier 1 validé");
  ok(store.learnedOnly(L1.items).length === 5, "les jeux ne portent que sur les 5 éléments découverts");
  store.reset();
  const ring = Q.porteRing();
  ok(ring.length >= 30 && ring.every((p) => p.isPorte), `${ring.length} portes dans l'ordre`);
  let badPorte = 0;
  for (let k = 0; k < 60; k++) {
    const p = ring[k % ring.length], q = Q.GEN.porteNext(p);
    if (!q) { badPorte++; continue; }
    const cw = q.prompt.includes("dans le sens des aiguilles");
    const j = ring.indexOf(p);
    const expect = ring[(j + (cw && !q.prompt.includes("inverse") ? 1 : -1) + ring.length) % ring.length];
    if (q.answerItem !== expect.id || q.options.filter((o) => o.correct).length !== 1) badPorte++;
  }
  ok(badPorte === 0, "« quelle porte vient après ? » : réponse = voisine réelle dans le sens indiqué");
  const pol = DB.police?.items || [];
  ok(pol.filter((x) => x.type === "commissariat").length >= 10 && pol.every((x) => x.arr >= 1 && x.arr <= 20), `${pol.length} sites de police, dont ${pol.filter((x) => x.type === "commissariat").length} commissariats, tous dans Paris`);
  const withPhoto = DB.items.filter((x) => x.photo);
  const heads = await Promise.all(withPhoto.map((x) => fetch(x.photo.src, { method: "HEAD" }).then((r) => r.ok)));
  ok(withPhoto.length >= 15 && heads.every(Boolean) && withPhoto.every((x) => x.photo.author && x.photo.page), `${withPhoto.length} photos présentes, avec auteur et lien`);

  // --- volume de questions par niveau et par mode
  S.settings.unlockAll = true;
  const S2 = await import("./js/session.js");
  const counts = [];
  for (const l of DB.levels) {
    const n = {};
    for (const g of ["order", "between", "ringMember", "porteNext", "linkAxis", "identify", "locate"]) n[g] = l.items.filter((i) => Q.GEN[g](item(i))).length;
    counts.push(`N${l.id}: ` + Object.entries(n).map(([k, v]) => `${k}=${v}`).join(" "));
    ok(n.locate === l.items.length && n.identify >= l.items.length * 0.8, `niveau ${l.id} : localisation et identification disponibles`);
  }
  store.reset();
  return { out, counts };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8765/"); pg.wait_for_selector(".dash")
    r = pg.evaluate(JS)
    b.close()
print("\n".join(r["out"])); print("\n".join(r["counts"]))
fails = [l for l in r["out"] if l.startswith("FAIL")] + errs
print(f"\n{len(r['out']) - len(fails)}/{len(r['out'])} OK" + (f" — erreurs : {errs}" if errs else ""))
sys.exit(1 if fails else 0)
