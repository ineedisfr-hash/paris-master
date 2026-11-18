// Progression du joueur : XP, répétition espacée, niveaux, badges, objectifs quotidiens.
// Tout est stocké localement (hors connexion) ; export/import JSON pour sauvegarder.
import { DB } from "./data.js";
import { clamp, dayKey, daysBetween } from "./util.js";

const KEY = "paris-master.v1";
const DAY = 86400000;

const fresh = () => ({
  v: 1,
  xp: 0,
  days: {}, // { "AAAA-MM-JJ": { xp, answers, correct } }
  cards: {}, // par élément
  levels: {}, // { id: { best, passed, attempts } }
  badges: {}, // { id: date }
  bestCombo: 0,
  chrono: {}, // meilleur score par format
  bestLocate: null, // meilleure précision (m)
  errors: [], // 300 dernières erreurs
  daily: {}, // défis du jour : { "AAAA-MM-JJ": { best, total } }
  paliers: {}, // { niveau: nombre de paliers validés }
  profile: { name: "" },
  settings: { dailyGoal: 60, unlockAll: false, geoloc: false, sound: true, vibrate: true, newPerDay: 10, transit: false, police: true },
});

export let S = fresh();
let storageOk = true;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) S = { ...fresh(), ...JSON.parse(raw) };
    S.settings = { ...fresh().settings, ...S.settings };
    S.profile = { ...fresh().profile, ...S.profile };
    S.paliers ||= {};
  } catch {
    storageOk = false;
  }
  return S;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

export const storageAvailable = () => storageOk;

export function exportJSON() {
  return JSON.stringify(S, null, 1);
}

export function importJSON(txt) {
  const d = JSON.parse(txt);
  if (!d || d.v !== 1 || typeof d.xp !== "number") throw new Error("Fichier de sauvegarde invalide");
  S = { ...fresh(), ...d };
  save();
}

export function reset() {
  S = fresh();
  save();
}

// ------------------------------------------------------------------ journée & XP

function today() {
  const k = dayKey();
  return (S.days[k] ||= { xp: 0, answers: 0, correct: 0, learned: 0 });
}

export function addXP(n) {
  n = Math.round(n);
  if (n <= 0) return 0;
  S.xp += n;
  today().xp += n;
  return n;
}

export const todayStats = () => ({ xp: 0, answers: 0, correct: 0, learned: 0, ...S.days[dayKey()] });

/** Nouveautés encore conseillées aujourd'hui (0 = plafond atteint ; Infinity si illimité). */
export function newLeftToday() {
  const cap = S.settings.newPerDay;
  return cap ? Math.max(0, cap - todayStats().learned) : Infinity;
}

/** Série de jours consécutifs où l'objectif quotidien a été atteint. */
export function streak() {
  const goal = S.settings.dailyGoal;
  const met = (k) => (S.days[k]?.xp || 0) >= goal;
  let n = 0;
  const d = new Date();
  if (!met(dayKey(d))) d.setDate(d.getDate() - 1);
  while (met(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export const GRADES = [
  { name: "Débutant", xp: 0 },
  { name: "Explorateur", xp: 300 },
  { name: "Connaisseur", xp: 1000 },
  { name: "Navigateur", xp: 2500 },
  { name: "Expert parisien", xp: 5000 },
  { name: "Maître de Paris", xp: 10000 },
];

export function grade(xp = S.xp) {
  let i = GRADES.findLastIndex((g) => xp >= g.xp);
  const cur = GRADES[i], next = GRADES[i + 1];
  return {
    ...cur,
    index: i,
    next,
    progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1,
  };
}

/** Niveau d'expérience numérique (courbe douce). */
export const xpLevel = (xp = S.xp) => Math.floor(Math.sqrt(xp / 40)) + 1;

// ------------------------------------------------------------------ répétition espacée

const card = (id) =>
  (S.cards[id] ||= { seen: 0, ok: 0, ko: 0, reps: 0, ease: 2.5, ivl: 0, due: 0, time: 0, learned: false, confused: {}, last: 0 });

export const getCard = (id) => S.cards[id];

export function markLearned(id) {
  const c = card(id);
  if (!c.learned) {
    c.learned = true;
    today().learned = (today().learned || 0) + 1;
    c.due = Math.min(c.due || Infinity, Date.now()); // à réviser dès la prochaine séance
    return true;
  }
  return false;
}

/**
 * Enregistre une réponse.
 * quality : 0 (faux) … 1 (parfait) ; ms : temps de réponse ; chosen : id confondu (le cas échéant).
 */
export function recordAnswer({ id, quality, ms = 0, chosen = null, type = "" }) {
  const c = card(id);
  const now = Date.now();
  const correct = quality >= 0.6;
  c.seen++;
  c.time += ms;
  c.last = now;
  c.learned = true;
  const t = today();
  t.answers++;
  if (correct) {
    c.ok++;
    t.correct++;
    // on n'allonge l'intervalle que si l'élément était dû (évite qu'une même séance
    // ne le propulse à plusieurs semaines)
    if (c.reps === 0 || now >= c.due - DAY / 2) {
      c.reps++;
      c.ivl = c.reps === 1 ? 1 : c.reps === 2 ? 3 : Math.round(c.ivl * c.ease);
      const fast = ms > 0 && ms < 5000;
      c.ease = clamp(c.ease + (quality >= 0.9 ? 0.05 : -0.1) + (fast ? 0.03 : 0), 1.3, 3);
      c.due = now + c.ivl * DAY;
    }
  } else {
    c.ko++;
    c.reps = 0;
    c.ivl = 0;
    c.ease = clamp(c.ease - 0.2, 1.3, 3);
    c.due = now + 5 * 60000;
    if (chosen && chosen !== id) c.confused[chosen] = (c.confused[chosen] || 0) + 1;
    S.errors.unshift({ id, type, chosen, at: now });
    S.errors.length = Math.min(S.errors.length, 300);
  }
  return correct;
}

/** 0 inconnu · 1 découvert · 2 en apprentissage · 3 en consolidation · 4 maîtrisé · 5 ancré */
export function mastery(id) {
  const c = S.cards[id];
  if (!c) return 0;
  if (!c.reps) return c.learned || c.seen ? 1 : 0;
  if (c.ivl >= 21) return 5;
  if (c.ivl >= 7) return 4;
  if (c.ivl >= 3) return 3;
  return 2;
}

export const MASTERY_LABELS = ["Inconnu", "Découvert", "En apprentissage", "En consolidation", "Maîtrisé", "Ancré"];

export const isDue = (id) => {
  const c = S.cards[id];
  return !!c && c.learned && c.due <= Date.now();
};

export function dueIds(pool = DB.items.map((i) => i.id)) {
  return pool.filter(isDue).sort((a, b) => S.cards[a].due - S.cards[b].due);
}

/** Tirage pondéré sans remise : les éléments dus et fragiles reviennent plus souvent. */
export function weightedPick(pool, n) {
  const now = Date.now();
  const keyed = pool.map((id) => {
    const c = S.cards[id];
    let w;
    if (!c || !c.seen) w = c?.learned ? 2.2 : 1.4;
    else {
      const errRate = c.ko / c.seen;
      w = 0.25 + errRate * 3;
      if (c.due <= now) w += 2.5 + Math.min(3, (now - c.due) / DAY / 3);
      else if (c.ivl >= 7) w *= 0.4;
    }
    return { id, k: Math.random() ** (1 / w) };
  });
  return keyed.sort((a, b) => b.k - a.k).slice(0, n).map((x) => x.id);
}

export function itemStats(id) {
  const c = S.cards[id];
  if (!c || !c.seen) return null;
  return { ...c, rate: c.ok / c.seen, avgMs: c.time / c.seen };
}

// ------------------------------------------------------------------ niveaux

export function levelProgress(level) {
  const ids = level.items;
  const sum = ids.reduce((s, id) => s + mastery(id), 0);
  return {
    pct: sum / (ids.length * 5),
    learned: ids.filter((id) => mastery(id) >= 1).length,
    mastered: ids.filter((id) => mastery(id) >= 4).length,
    total: ids.length,
  };
}

export function levelUnlocked(id) {
  const idx = DB.levels.findIndex((l) => l.id === id);
  if (idx < 0) return false;
  // squelette, centre et portes sont ouverts d'emblée ; ensuite, un examen réussi ouvre le suivant
  if (S.settings.unlockAll || DB.levels[idx].open) return true;
  return !!S.levels[DB.levels[idx - 1].id]?.passed;
}

// ------------------------------------------------------------------ paliers
// Chaque niveau est découpé en paliers de 5 éléments. Un palier est validé par un contrôle
// réussi à 80 % ; tant qu'il ne l'est pas, on ne découvre pas d'éléments du palier suivant.
export const PALIER = 5;
export const PALIER_PASS = 0.8;
export const palierCount = (level) => Math.ceil(level.items.length / PALIER);
export const palierItems = (level, k) => level.items.slice(k * PALIER, (k + 1) * PALIER);
export const paliersPassed = (level) => Math.min(S.paliers[level.id] || 0, palierCount(level));
export const allPaliersPassed = (level) => paliersPassed(level) >= palierCount(level);
/** Le palier k est-il entièrement découvert (prêt pour son contrôle) ? */
export const palierLearned = (level, k) => palierItems(level, k).every((id) => S.cards[id]?.learned);

export function passPalier(levelId, k) {
  const before = S.paliers[levelId] || 0;
  if (k === before) S.paliers[levelId] = before + 1;
  return k === before;
}

/** Éléments déjà découverts parmi une liste (les jeux ne portent que sur eux). */
export const learnedOnly = (ids) => ids.filter((id) => S.cards[id]?.learned);

export const levelPassed = (id) => !!S.levels[id]?.passed;

export function recordExam(id, pct) {
  const l = (S.levels[id] ||= { best: 0, passed: false, attempts: 0 });
  l.attempts++;
  l.best = Math.max(l.best, pct);
  const newlyPassed = pct >= 0.85 && !l.passed;
  if (pct >= 0.85) l.passed = true;
  return newlyPassed;
}

/** Statut d'un arrondissement pour la carte de progression. */
export function arrStatus(n) {
  const levels = DB.levels.filter((l) => l.arrondissements.includes(n));
  if (!levels.length) return "hors";
  const ids = DB.items.filter((i) => i.arr.includes(n) && i.levels.length).map((i) => i.id);
  if (levels.some((l) => levelPassed(l.id)) && ids.every((id) => mastery(id) >= 2)) return "valide";
  if (ids.length && ids.filter((id) => mastery(id) >= 4).length / ids.length >= 0.8) return "valide";
  if (ids.some((id) => mastery(id) >= 1)) return "encours";
  return "nouveau";
}

// ------------------------------------------------------------------ badges

const totalCorrect = () => Object.values(S.cards).reduce((s, c) => s + c.ok, 0);

export const BADGES = [
  { id: "premiers-pas", name: "Premiers pas", desc: "Répondre à une première question.", test: () => totalCorrect() + Object.values(S.cards).reduce((s, c) => s + c.ko, 0) >= 1 },
  { id: "cent", name: "Centurion", desc: "100 bonnes réponses.", test: () => totalCorrect() >= 100 },
  { id: "cinq-cents", name: "Infatigable", desc: "500 bonnes réponses.", test: () => totalCorrect() >= 500 },
  { id: "serie-10", name: "Sur la bonne voie", desc: "10 bonnes réponses d'affilée.", test: () => S.bestCombo >= 10 },
  { id: "serie-25", name: "Imperturbable", desc: "25 bonnes réponses d'affilée.", test: () => S.bestCombo >= 25 },
  { id: "precision", name: "Coup d'œil", desc: "Localiser une voie à moins de 25 m.", test: () => S.bestLocate !== null && S.bestLocate <= 25 },
  { id: "chrono", name: "Sans faute au chrono", desc: "Réussir une épreuve chrono sans erreur.", test: () => Object.values(S.chrono).some((c) => c.perfect) },
  { id: "assidu", name: "Assidu", desc: "Atteindre l'objectif du jour 7 jours de suite.", test: () => streak() >= 7 },
  { id: "squelette", name: "Charpentier", desc: "Valider l'examen du squelette de Paris.", test: () => levelPassed(0) },
  { id: "premier-niveau", name: "Le centre n'a plus de secret", desc: "Valider l'examen du centre de Paris.", test: () => levelPassed(1) },
  { id: "trois-niveaux", name: "Rayonnement", desc: "Valider 3 niveaux.", test: () => DB.levels.filter((l) => levelPassed(l.id)).length >= 3 },
  { id: "tous-niveaux", name: "Maître de Paris", desc: "Valider tous les niveaux.", test: () => DB.levels.every((l) => levelPassed(l.id)) },
  { id: "monuments", name: "Guide", desc: "Maîtriser tous les monuments.", test: () => DB.items.filter((i) => i.cat === "monument").every((i) => mastery(i.id) >= 4) },
  { id: "defi-7", name: "Rendez-vous quotidien", desc: "Relever le défi du jour 7 jours de suite.", test: () => dailyStreak() >= 7 },
  { id: "ancre", name: "Mémoire d'éléphant", desc: "Ancrer 25 éléments (révision espacée de 3 semaines).", test: () => DB.items.filter((i) => mastery(i.id) >= 5).length >= 25 },
];

export function checkBadges() {
  const earned = [];
  for (const b of BADGES) {
    if (!S.badges[b.id] && b.test()) {
      S.badges[b.id] = dayKey();
      earned.push(b);
    }
  }
  return earned;
}

/** Jours consécutifs où le défi du jour a été relevé. */
export function dailyStreak() {
  let n = 0;
  const d = new Date();
  if (!S.daily[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (S.daily[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export const daysSinceStart = () => {
  const keys = Object.keys(S.days).sort();
  return keys.length ? daysBetween(keys[0], dayKey()) + 1 : 0;
};
