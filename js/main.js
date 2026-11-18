// Point d'entrée : chargement des données, routeur par hash, service worker.
import { loadData } from "./data.js";
import * as store from "./store.js";
import dashboard from "./views/dashboard.js";
import explore from "./views/explore.js";
import levels from "./views/levels.js";
import learn from "./views/learn.js";
import { menu, session } from "./views/play.js";
import stats from "./views/stats.js";
import badges from "./views/badges.js";
import profile from "./views/settings.js";

const ROUTES = [
  [/^$/, dashboard, "accueil"],
  [/^carte$/, explore, "carte"],
  [/^niveaux$/, levels, "niveaux"],
  [/^apprendre\/(\d+)$/, learn, "niveaux"],
  [/^jouer$/, menu, "jouer"],
  [/^jouer\/([a-z]+)$/, session, "jouer"],
  [/^stats$/, stats, "stats"],
  [/^badges$/, badges, "accueil"],
  [/^(?:profil|reglages)$/, profile, "profil"],
];

const view = document.getElementById("view");
let cleanup = null;

function route() {
  const raw = location.hash.replace(/^#\/?/, "").split("#")[0];
  const [path, qs = ""] = raw.split("?");
  const params = new URLSearchParams(qs);
  const hit = ROUTES.find(([re]) => re.test(path)) || ROUTES[0];
  const args = path.match(hit[0])?.slice(1) || [];
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  view.innerHTML = "";
  view.className = `view-${hit[2]}`;
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === hit[2]));
  window.scrollTo(0, 0);
  try {
    cleanup = hit[1](view, params, args) || null;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<section class="page"><h1>Oups</h1><p>Une erreur est survenue : ${String(e.message)}</p><a class="btn" href="#/">Accueil</a></section>`;
  }
}

async function boot() {
  store.load();
  try {
    await loadData();
  } catch (e) {
    view.innerHTML = `<section class="page narrow"><h1>Données indisponibles</h1><p class="lead">Les données géographiques n'ont pas pu être chargées (${String(e.message)}). Vérifiez la connexion puis rechargez la page.</p><button class="btn primary" onclick="location.reload()">Réessayer</button></section>`;
    return;
  }
  document.body.classList.remove("loading");
  window.addEventListener("hashchange", route);
  route();
  window.addEventListener("pagehide", store.save);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && store.save());
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

boot();
