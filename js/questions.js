// Générateurs de questions. Chaque générateur reçoit un élément et renvoie une question,
// ou null si l'élément ne s'y prête pas (ex. une voie sans place reliée pour « quel axe relie… »).
// Les bonnes réponses viennent exclusivement des données (officielles ou calculées).
import { DB, CATS, item, withArticle, inArr, catLabel, deNm, aNm } from "./data.js";
import { distItems } from "./geo.js";
import { shuffle, pick, arrLabel, arrText, fmtDist, esc } from "./util.js";
import { memoTip, linkedItems, nearItems } from "./fiche.js";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nm = (it) => withArticle(it);

const distCache = new Map();
function dist(a, b) {
  const k = a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id;
  if (!distCache.has(k)) distCache.set(k, distItems(a, b));
  return distCache.get(k);
}

/** Choisit n distracteurs plausibles (même famille), éventuellement proches pour rester exigeant. */
function distractors(answer, n, { filter = () => true, near = false, exclude = [] } = {}) {
  const ex = new Set([answer.id, ...exclude]);
  let pool = DB.items.filter((x) => !ex.has(x.id) && filter(x) && x.name !== answer.name);
  if (near && pool.length > n) {
    pool = pool.map((x) => ({ x, d: dist(answer, x) })).sort((a, b) => a.d - b.d);
    // parmi les 8 plus proches, mais pas collés à la réponse (sinon ambigu)
    pool = pool.filter((p) => p.d > 150).slice(0, 8).map((p) => p.x);
  }
  return shuffle(pool).slice(0, n);
}

/** Deux éléments reliés à l'axe, assez éloignés pour qu'il les « relie » vraiment (places privilégiées). */
function endpoints(it) {
  if (!it.isWay || it.cat === "pont") return null;
  const linked = linkedItems(it).filter((l) => l.isWay || l.isPlace);
  const pairs = [];
  for (let i = 0; i < linked.length; i++)
    for (let j = i + 1; j < linked.length; j++) {
      const d = dist(linked[i], linked[j]);
      if (d >= 600) pairs.push({ p: [linked[i], linked[j]], w: (linked[i].isPlace ? 2 : 1) + (linked[j].isPlace ? 2 : 1) });
    }
  if (!pairs.length) return null;
  const best = Math.max(...pairs.map((x) => x.w));
  return shuffle(pick(pairs.filter((x) => x.w === best)).p);
}

const sameFamily = (it) => (x) => (it.isPorte ? x.isPorte : it.isWay ? x.isWay : it.isPlace ? x.isPlace : x.isLandmark);

/** Les portes dans l'ordre (sens des aiguilles d'une montre depuis le nord). */
export function porteRing() {
  return DB.levels.find((l) => l.ring?.length)?.ring.map(item) || [];
}
const opt = (it, correct) => ({ label: it.name, id: it.id, correct });

function mcq(base, answer, others) {
  return { ...base, mode: "mcq", options: shuffle([opt(answer, true), ...others.map((o) => opt(o, false))]) };
}

function arrOptions(it) {
  const correct = pick(it.arr);
  const pt = it.point;
  const cand = DB.arrs
    .filter((a) => !it.arr.includes(a.n))
    .map((a) => ({ n: a.n, d: Math.hypot(a.center[0] - pt[0], (a.center[1] - pt[1]) * 0.66) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  const others = shuffle(cand).slice(0, 3).map((a) => a.n);
  return {
    correct,
    options: shuffle([{ label: arrLabel(correct), arr: correct, correct: true }, ...others.map((n) => ({ label: arrLabel(n), arr: n, correct: false }))]),
  };
}

// ------------------------------------------------------------------ générateurs

export const GEN = {
  /** Dans quel arrondissement… (nom donné, carte sans l'élément) */
  arrOf(it) {
    const { correct, options } = arrOptions(it);
    const prompt =
      it.arr.length > 1
        ? `${cap(nm(it))} concerne plusieurs arrondissements. Lequel en fait partie ?`
        : `Dans quel arrondissement se trouve ${nm(it)} ?`;
    return {
      type: "arrOf", id: it.id, skill: "Arrondissement", prompt, mode: "mcq", options,
      before: { fit: "paris", arrNumbers: false },
      after: { show: [[it.id, "good", true]], fit: [it.id], arrNumbers: true, highlightArr: correct },
      explain: `${cap(nm(it))} se trouve ${inArr(it)}. ${memoTip(it)}`,
    };
  },

  /** Reconnaissance : l'élément est montré sans nom, quel arrondissement ? */
  arrRecog(it) {
    const q = GEN.arrOf(it);
    return {
      ...q, type: "arrRecog",
      prompt: it.arr.length > 1 ? `Cet élément concerne plusieurs arrondissements. Lequel en fait partie ?` : `Dans quel arrondissement se trouve l'élément en surbrillance ?`,
      before: { show: [[it.id, "focus", false]], fit: [it.id], fitPad: 120, arrNumbers: false },
      explain: `C'était ${nm(it)}, ${inArr(it)}. ${memoTip(it)}`,
    };
  },

  /** Quel axe relie A à B ? (A et B : places ou voies réellement reliées à l'axe, à ≥ 600 m l'une de l'autre) */
  linkAxis(it) {
    const pair = endpoints(it);
    if (!pair) return null;
    const [a, b] = pair;
    const others = distractors(it, 3, {
      filter: (x) => x.isWay && !(x.links.includes(a.id) && x.links.includes(b.id)) && (x.cat === it.cat || Math.random() < 0.4),
    });
    if (others.length < 3) return null;
    return mcq({
      type: "linkAxis", id: it.id, skill: "Liaisons",
      prompt: `Quel axe relie ${nm(a)} ${aNm(b)} ?`,
      before: { show: [[a.id, "hint", true], [b.id, "hint", true]], fit: [a.id, b.id], fitPad: 60 },
      after: { show: [[it.id, "good", true], [a.id, "hint", true], [b.id, "hint", true]], fit: [it.id, a.id, b.id] },
      explain: `${cap(nm(it))} relie ${nm(a)} ${aNm(b)}${it.orientation ? `, selon un axe ${it.orientation}` : ""}.`,
    }, it, others);
  },

  /** Parcours : depuis A, en suivant tel axe, que rencontre-t-on ? */
  route(it) {
    const pair = endpoints(it);
    if (!pair) return null;
    const [a, b] = Math.random() < 0.5 ? pair : [pair[1], pair[0]];
    const others = distractors(b, 3, { filter: (x) => (b.isPlace ? x.isPlace : x.isWay) && !it.links.includes(x.id) && x.id !== it.id && x.id !== a.id });
    if (others.length < 3) return null;
    return {
      ...mcq({
        type: "route", id: it.id, skill: "Parcours",
        prompt: `Depuis ${nm(a)}, vous suivez ${nm(it)}. ${b.isPlace ? "Quelle place" : "Quelle voie"} atteignez-vous ou croisez-vous plus loin ?`,
        before: { show: [[a.id, "hint", true]], fit: [a.id, it.id], fitPad: 40 },
        after: { show: [[it.id, "good", true], [a.id, "hint", true], [b.id, "good", true]], fit: [it.id, a.id, b.id] },
        explain: `En suivant ${nm(it)} depuis ${nm(a)}, on rencontre ${nm(b)} (${fmtDist(dist(a, b))} plus loin).`,
      }, b, others),
      answerItem: b.id,
    };
  },

  /** Quelle voie croise ou rejoint X ? */
  crosses(it) {
    if (!it.isWay) return null;
    const ways = linkedItems(it).filter((l) => l.isWay);
    if (!ways.length) return null;
    const ans = pick(ways);
    const others = distractors(ans, 3, { filter: (x) => x.isWay && !it.links.includes(x.id) && x.id !== it.id && dist(it, x) > 400 });
    if (others.length < 3) return null;
    return {
      ...mcq({
        type: "crosses", id: it.id, skill: "Intersections",
        prompt: `Quelle voie croise ou rejoint ${nm(it)} ?`,
        before: { show: [[it.id, "focus", true]], fit: [it.id], fitPad: 30 },
        after: { show: [[it.id, "focus", true], [ans.id, "good", true]], fit: [it.id, ans.id] },
        explain: `${cap(nm(ans))} croise ou rejoint ${nm(it)}. ${cap(nm(it))} est aussi reliée à : ${linkedItems(it).map((x) => x.name).join(", ")}.`,
      }, ans, others),
      answerItem: ans.id,
    };
  },

  /** Quel axe passe près de tel repère ? */
  nearAxis(it) {
    if (!it.isLandmark) return null;
    const near = nearItems(it, 300).filter((x) => x.it.isWay);
    if (!near.length) return null;
    const ans = near[0].it;
    const others = distractors(ans, 3, { filter: (x) => x.isWay && dist(it, x) > 1000 });
    if (others.length < 3) return null;
    return {
      ...mcq({
        type: "nearAxis", id: it.id, skill: "Repères",
        prompt: `Quel axe passe à proximité ${deNm(it)} ?`,
        before: { show: [[it.id, "hint", true]], fit: [it.id], fitPad: 160 },
        after: { show: [[it.id, "hint", true], [ans.id, "good", true]], fit: [it.id, ans.id] },
        explain: near[0].d < 20 ? `${cap(nm(ans))} passe au contact ${deNm(it)}.` : `${cap(nm(ans))} passe à ${fmtDist(near[0].d)} ${deNm(it)}.`,
      }, ans, others),
      answerItem: ans.id,
    };
  },

  /** Quel repère se trouve près de tel axe / quel monument voisin ? */
  nearLandmark(it) {
    const near = nearItems(it, 400).filter((x) => x.it.isLandmark && x.it.id !== it.id);
    if (!near.length) return null;
    const ans = near[0].it;
    const others = distractors(ans, 3, { filter: (x) => x.isLandmark && dist(it, x) > 1200 });
    if (others.length < 3) return null;
    return {
      ...mcq({
        type: "nearLandmark", id: it.id, skill: "Repères",
        prompt: `Quel repère se trouve à proximité ${deNm(it)} ?`,
        before: { show: [[it.id, "focus", true]], fit: [it.id], fitPad: 80 },
        after: { show: [[it.id, "focus", true], [ans.id, "good", true]], fit: [it.id, ans.id] },
        explain: near[0].d < 20 ? `${cap(nm(ans))} est au contact ${deNm(it)}.` : `${cap(nm(ans))} est à ${fmtDist(near[0].d)} ${deNm(it)}.`,
      }, ans, others),
      answerItem: ans.id,
    };
  },

  /** Identifier l'élément en surbrillance (carte sans noms). */
  identify(it) {
    const others = distractors(it, 3, { filter: (x) => sameFamily(it)(x), near: true });
    if (others.length < 3) return null;
    const what = it.isWay ? "Quelle est cette voie ?" : it.isPlace ? "Quelle est cette place ?" : "Quel est ce lieu ?";
    return mcq({
      type: "identify", id: it.id, skill: "Reconnaissance",
      prompt: what,
      before: { show: [[it.id, "focus", false]], fit: [it.id], fitPad: it.isWay ? 30 : 140 },
      after: { show: [[it.id, "good", true]], fit: [it.id], arrNumbers: true },
      explain: `C'était ${nm(it)} (${catLabel(it).toLowerCase()}), ${inArr(it)}. ${memoTip(it)}`,
    }, it, others);
  },

  /** Localiser sur la carte. */
  locate(it) {
    return {
      type: "locate", id: it.id, skill: "Localisation", mode: "locate",
      prompt: `Où se trouve <strong>${esc(it.name)}</strong> ? Touchez son emplacement sur la carte.`,
      before: { fit: "paris", arrNumbers: true },
      after: { show: [[it.id, "good", true]] },
      explain: `${cap(nm(it))} se trouve ${inArr(it)}. ${memoTip(it)}`,
    };
  },
};

// ------------------------------------------------------------------ grands axes : suites et anneaux

/** Morceau d'anneau (un seul boulevard), dessinable comme un élément. */
export function memberItem(ring, k) {
  const lines = ring.geom.lines.filter((_, i) => ring.lineMember[i] === k);
  const flat = lines.flat();
  return {
    id: `${ring.id}#${k}`, name: ring.members[k].name, cat: "anneau", isWay: true, arr: ring.members[k].arr,
    geom: { lines, polys: [] }, point: flat[Math.floor(flat.length / 2)] || ring.point, links: [], near: [],
  };
}

/** Repères d'une suite, prêts à afficher sur la carte : { at, label }. */
export function seqMarks(it) {
  if (it.cat === "anneau") return it.members.map((m, k) => ({ at: memberItem(it, k).point, label: m.name }));
  return (it.sequence || []).map((x) => ({ at: x.at, label: x.name }));
}

const RINGS = () => DB.items.filter((x) => x.cat === "anneau");
const ringMemberNames = () => new Set(RINGS().flatMap((r) => r.members.map((m) => m.name.toLowerCase())));

Object.assign(GEN, {
  /** Remettre trois croisements dans l'ordre du trajet. */
  order(it) {
    const seq = seqMarks(it);
    if (seq.length < 3) return null;
    const idx = shuffle(seq.map((_, i) => i)).slice(0, 3).sort((a, b) => a - b);
    const names = idx.map((i) => seq[i].label);
    if (new Set(names).size < 3) return null;
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const label = (p) => p.map((k) => names[k]).join(" → ");
    const wrong = shuffle(perms.slice(1)).slice(0, 3);
    const ring = it.cat === "anneau";
    const all = seq.map((m, i) => ({ ...m, n: i + 1, style: idx.includes(i) ? "good" : "muted" }));
    return {
      type: "order", id: it.id, skill: "Dans l'ordre", mode: "mcq",
      prompt: ring ? `Sur ${nm(it)}, ${it.seqDir}, dans quel ordre se succèdent ces boulevards ?` : `En suivant ${nm(it)} ${it.seqDir}, dans quel ordre croise-t-on ces voies ?`,
      options: shuffle([{ label: label([0, 1, 2]), correct: true }, ...wrong.map((p) => ({ label: label(p), correct: false }))]),
      before: { show: [[it.id, "focus", false]], fit: [it.id], fitPad: 30 },
      after: { show: [[it.id, "focus", true]], fit: [it.id], marks: all },
      explain: `${cap(nm(it))}, ${it.seqDir} : ${seq.map((m) => m.label).join(" → ")}.`,
    };
  },

  /** Quelle voie croise-t-on entre A et C ? */
  between(it) {
    if (it.cat === "anneau") return null;
    const seq = seqMarks(it);
    if (seq.length < 3) return null;
    const i = 1 + Math.floor(Math.random() * (seq.length - 2));
    const [a, b, c] = [seq[i - 1], seq[i], seq[i + 1]];
    const inSeq = new Set(seq.map((m) => m.label));
    const pool = [...new Set(DB.items.flatMap((x) => (x.sequence || []).map((m) => m.name)))].filter((n) => !inSeq.has(n));
    const others = shuffle(pool).slice(0, 3);
    if (others.length < 3) return null;
    return {
      type: "between", id: it.id, skill: "Entre les deux", mode: "mcq",
      prompt: `Sur ${nm(it)}, quelle voie croise-t-on entre « ${a.label} » et « ${c.label} » ?`,
      options: shuffle([{ label: b.label, correct: true }, ...others.map((o) => ({ label: o, correct: false }))]),
      before: { show: [[it.id, "focus", false]], fit: [it.id], fitPad: 30, marks: [{ ...a, style: "hint" }, { ...c, style: "hint" }] },
      after: { show: [[it.id, "focus", true]], fit: [it.id], marks: seq.map((m, k) => ({ ...m, n: k + 1, style: k === i ? "good" : k === i - 1 || k === i + 1 ? "hint" : "muted" })) },
      explain: `${cap(nm(it))}, ${it.seqDir} : ${seq.map((m) => m.label).join(" → ")}.`,
    };
  },

  /** Quelle porte vient après (ou avant) celle-ci sur le périphérique ? */
  porteNext(it) {
    if (!it.isPorte) return null;
    const ring = porteRing();
    const k = ring.findIndex((x) => x.id === it.id);
    if (k < 0 || ring.length < 6) return null;
    const cw = Math.random() < 0.6;
    const ans = ring[(k + (cw ? 1 : -1) + ring.length) % ring.length];
    const away = (x) => Math.min(Math.abs(ring.indexOf(x) - k), ring.length - Math.abs(ring.indexOf(x) - k));
    // pièges : la porte de l'autre côté, et d'autres portes proches
    const others = shuffle(ring.filter((x) => x.id !== it.id && x.id !== ans.id && away(x) <= 4)).slice(0, 3);
    if (others.length < 3) return null;
    return {
      ...mcq({
        type: "porteNext", id: it.id, skill: "Portes", mode: "mcq",
        prompt: `Sur le périphérique, en tournant ${cw ? "dans le sens des aiguilles d'une montre" : "dans le sens inverse des aiguilles d'une montre"}, quelle porte vient juste après ${nm(it)} ?`,
        before: { show: [[it.id, "focus", true]], fit: [it.id], fitPad: 160, arrNumbers: true },
        after: { show: [[it.id, "focus", true], [ans.id, "good", true]], fit: [it.id, ans.id], fitPad: 60, arrNumbers: true },
        explain: `${cap(nm(ans))} suit ${nm(it)} ${cw ? "dans le sens des aiguilles d'une montre" : "dans le sens inverse"}. Dans l'ordre : ${ring.slice(Math.max(0, k - 2), k + 3).map((x) => x.name.replace(/^Porte /, "")).join(" → ")}.`,
      }, ans, others),
      answerItem: ans.id,
    };
  },

  /** À quel anneau appartient ce boulevard ? */
  ringMember(it) {
    if (it.cat !== "anneau") return null;
    const rings = RINGS();
    if (rings.length < 3) return null;
    const none = "Aucun des trois anneaux";
    const opts = (ans) => shuffle([...rings.map((r) => ({ label: r.name, id: r.id, correct: r.id === ans })), { label: none, correct: !ans }]);
    if (Math.random() < 0.25) {
      // piège : un grand boulevard du programme qui n'appartient à aucun anneau
      const members = ringMemberNames();
      const outsiders = DB.items.filter((x) => x.cat === "boulevard" && !members.has(x.name.toLowerCase()) && !members.has((x.official || "").toLowerCase()));
      if (outsiders.length) {
        const o = pick(outsiders);
        return {
          type: "ringMember", id: it.id, skill: "Anneaux", mode: "mcq",
          prompt: `${cap(nm(o))} fait-il partie d'un anneau de boulevards ?`,
          options: opts(null),
          before: { show: [[o.id, "focus", false]], fit: [o.id], fitPad: 40 },
          after: { show: [...rings.map((r) => [r.id, "muted", false]), [o.id, "focus", true]], fit: rings.map((r) => r.id) },
          explain: `${cap(nm(o))} n'appartient à aucun des trois anneaux : c'est un axe ${o.orientation ? `orienté ${o.orientation}` : "transversal"}, ${inArr(o)}.`,
        };
      }
    }
    const k = Math.floor(Math.random() * it.members.length);
    const m = memberItem(it, k);
    return {
      type: "ringMember", id: it.id, skill: "Anneaux", mode: "mcq",
      prompt: `Le tronçon en surbrillance (${m.name}) appartient à quel anneau ?`,
      options: opts(it.id),
      before: { show: [[m, "focus", false]], fit: [m], fitPad: 60 },
      after: { show: [[it.id, "good", false], [m, "focus", true]], fit: [it.id] },
      explain: `${m.name} fait partie ${deNm(it)} (${it.seqDir}) : ${it.members.map((x) => x.name.replace(/^Boulevard /, "")).join(", ")}.`,
    };
  },
});

export const MODES = {
  portes: { title: "Les portes", desc: "Les portes du périphérique : leur place, leur ordre, leur arrondissement.", gens: ["porteNext", "identify", "locate", "arrOf", "porteNext"], count: 10, filter: (it) => it.isPorte },
  palier: { title: "Contrôle de palier", desc: "Validez le palier (80 %) pour passer au suivant.", gens: ["identify", "locate", "arrOf", "order", "between", "ringMember", "linkAxis", "porteNext"], count: 6 },
  quiz: { title: "Quiz", desc: "Questions à choix multiples avec correction expliquée.", gens: ["arrOf", "linkAxis", "crosses", "nearAxis", "route", "nearLandmark", "order", "between", "ringMember", "porteNext"], count: 12 },
  axes: { title: "Grands axes", desc: "Chaque axe comme une suite de croisements, et les trois anneaux de boulevards.", gens: ["order", "between", "ringMember", "linkAxis", "order", "between"], count: 10, filter: (it) => it.cat === "anneau" || (it.sequence?.length >= 3) },
  controle: { title: "Contrôle express", desc: "Quelques questions sur ce que vous venez d'apprendre.", gens: ["identify", "locate", "arrOf", "order", "between", "ringMember", "linkAxis"], count: 6 },
  retrouve: { title: "Retrouve la rue", desc: "Touchez l'emplacement exact sur la carte. Précision mesurée en mètres.", gens: ["locate"], count: 10 },
  identifie: { title: "Identifie la voie", desc: "Carte sans noms : reconnaissez la voie et son arrondissement.", gens: ["identify", "arrRecog"], count: 12 },
  chrono: { title: "Chrono", desc: "Un maximum de bonnes réponses avant la fin du temps.", gens: ["arrOf", "identify", "linkAxis", "crosses"], count: 10, timed: true },
  monuments: { title: "Défi des monuments", desc: "Nom, arrondissement, axes et repères voisins des grands lieux.", gens: ["identify", "arrOf", "nearAxis", "nearLandmark"], count: 10, filter: (it) => it.isLandmark },
  parcours: { title: "Parcours géographique", desc: "Liaisons entre places, axes et intersections.", gens: ["linkAxis", "route", "crosses", "order", "between", "ringMember"], count: 10, filter: (it) => it.isWay },
  revision: { title: "Révisions du jour", desc: "Les éléments à revoir, choisis par la répétition espacée.", gens: ["identify", "arrOf", "locate", "linkAxis", "crosses", "nearAxis", "route", "order", "between", "ringMember", "porteNext"], count: 15 },
  defi: { title: "Défi du jour", desc: "10 questions variées, les mêmes toute la journée. +30 XP au premier essai.", gens: ["locate", "identify", "arrOf", "linkAxis", "route", "crosses", "nearAxis", "nearLandmark", "order", "between", "ringMember", "porteNext"], count: 10 },
  examen: { title: "Examen", desc: "20 questions mélangées. Validation à 85 %.", gens: ["locate", "identify", "arrOf", "linkAxis", "route", "crosses", "nearAxis", "arrRecog", "order", "between", "ringMember", "porteNext"], count: 20 },
};

/** Fabrique une question pour un élément, en essayant les générateurs du mode dans le désordre. */
export function makeQuestion(it, gens) {
  for (const g of shuffle(gens)) {
    const q = GEN[g](it);
    if (q) return q;
  }
  return null;
}

export { arrText };
