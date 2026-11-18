// Profil : identité, progression résumée, réglages de la carte et du jeu, sauvegarde, réinitialisation.
import { DB } from "../data.js";
import * as store from "../store.js";
import { esc, toast, dayKey, fmtPct } from "../util.js";

export default function profile(root) {
  const S = store.S;
  const s = S.settings;
  const g = store.grade();
  const answers = Object.values(S.cards).reduce((n, c) => n + c.seen, 0);
  const ok = Object.values(S.cards).reduce((n, c) => n + c.ok, 0);
  const paliers = DB.levels.reduce((n, l) => n + store.paliersPassed(l), 0);
  const totalPaliers = DB.levels.reduce((n, l) => n + store.palierCount(l), 0);
  const sw = (cls, on, title, sub) => `<label class="switch"><input type="checkbox" class="${cls}" ${on ? "checked" : ""}><span>${title}<small>${sub}</small></span></label>`;

  root.innerHTML = `
  <section class="page narrow">
    <h1>Profil</h1>
    <section class="panel profile-head">
      <span class="avatar" aria-hidden="true">${esc((S.profile.name || "?").charAt(0).toUpperCase())}</span>
      <div>
        <label class="field">Prénom ou pseudo (facultatif, reste sur cet appareil)
          <input class="pname" type="text" maxlength="30" value="${esc(S.profile.name)}" placeholder="Votre prénom" autocomplete="given-name">
        </label>
        <p class="muted small">${esc(g.name)} · niveau ${store.xpLevel()} · ${S.xp} XP · ${answers} réponses${answers ? ` (${fmtPct(ok / answers)} de réussite)` : ""} · ${paliers}/${totalPaliers} paliers</p>
        <p class="small"><a class="link" href="#/stats">Statistiques</a> · <a class="link" href="#/badges">Badges</a></p>
      </div>
    </section>

    <section class="panel">
      <h2>Carte</h2>
      ${sw("transit", s.transit, "Arrêts de bus et de transport", "Affiche les arrêts et leurs noms sur le fond de carte. Désactivé par défaut pour ne pas confondre un arrêt « Tour Eiffel » avec le monument.")}
      ${sw("police", s.police, "Commissariats et sites de police", "Pastilles bleu police sur la carte (source OpenStreetMap, à vérifier).")}
      ${sw("geoloc", s.geoloc, "Géolocalisation", "Ajoute « Me localiser » sur la carte ; la position n'est ni stockée ni transmise.")}
    </section>

    <section class="panel">
      <h2>Rythme et jeu</h2>
      <label class="field">Objectif quotidien
        <select class="goal">${[30, 60, 100, 150, 250].map((v) => `<option value="${v}" ${s.dailyGoal === v ? "selected" : ""}>${v} XP par jour</option>`).join("")}</select>
      </label>
      <label class="field">Nouveautés par jour
        <select class="newcap">${[[5, "5 (rythme doux)"], [10, "10 (conseillé)"], [15, "15"], [20, "20"], [0, "Sans limite"]].map(([v, l]) => `<option value="${v}" ${s.newPerDay === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      ${sw("sound", s.sound, "Effets sonores", "Sons de bonne et mauvaise réponse, séries, célébrations.")}
      ${sw("vibrate", s.vibrate, "Vibrations", "Sur les appareils qui le permettent (Android ; non disponible sur iPhone).")}
      ${sw("unlock", s.unlockAll, "Mode libre", "Débloque tous les niveaux, paliers et examens, et permet de jouer sur des éléments pas encore découverts.")}
    </section>

    <section class="panel">
      <h2>Sauvegarde</h2>
      <p class="small muted">La progression est enregistrée sur cet appareil${store.storageAvailable() ? "" : " — <strong>stockage indisponible : la progression sera perdue à la fermeture</strong>"}. Exportez-la pour la conserver ou la transférer.</p>
      <div class="fb-actions">
        <button class="btn export">Exporter</button>
        <label class="btn">Importer<input type="file" accept="application/json" class="import" hidden></label>
      </div>
    </section>

    <section class="panel danger-zone">
      <h2>Réinitialiser le jeu</h2>
      <p class="small muted">Efface toute la progression : XP, paliers, examens, révisions, badges, statistiques. Les réglages et le prénom sont conservés. Pensez à exporter avant si vous voulez pouvoir revenir en arrière.</p>
      <button class="btn danger reset">Réinitialiser le jeu</button>
    </section>

    <section class="panel">
      <h2>Données</h2>
      <p class="small">${DB.items.length} éléments géographiques, générés le ${esc(DB.meta.generated)} à partir de :</p>
      <ul class="small">${DB.meta.sources.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="small muted">Arrondissements, tenants et aboutissants proviennent de la nomenclature officielle de la Ville de Paris. Connexions, orientations, ordres de croisement et ordre des portes sont calculés à partir des tracés réels. Fond de carte : OpenFreeMap, © OpenMapTiles, © contributeurs OpenStreetMap.</p>
    </section>
  </section>`;

  const $ = (q) => root.querySelector(q);
  const bind = (cls, key, msg) => $(`.${cls}`).addEventListener("change", (e) => { s[key] = e.target.checked; store.save(); if (msg) toast(msg); });
  $(".pname").addEventListener("change", (e) => { S.profile.name = e.target.value.trim(); store.save(); toast("Profil enregistré"); profile(root); });
  bind("transit", "transit", "Réglage appliqué aux cartes");
  bind("police", "police");
  bind("geoloc", "geoloc");
  bind("sound", "sound");
  bind("vibrate", "vibrate");
  bind("unlock", "unlockAll");
  $(".goal").addEventListener("change", (e) => { s.dailyGoal = Number(e.target.value); store.save(); toast("Objectif mis à jour"); });
  $(".newcap").addEventListener("change", (e) => { s.newPerDay = Number(e.target.value); store.save(); toast("Rythme mis à jour"); });
  $(".export").addEventListener("click", () => {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `paris-master-${dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $(".import").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { store.importJSON(await f.text()); toast("Progression importée"); profile(root); }
    catch (err) { toast(err.message, "bad"); }
  });
  $(".reset").addEventListener("click", () => {
    if (!confirm("Réinitialiser le jeu ? Toute la progression (XP, paliers, examens, révisions, badges) sera effacée définitivement.")) return;
    const keep = { settings: { ...S.settings }, profile: { ...S.profile } };
    store.reset();
    Object.assign(store.S.settings, keep.settings);
    Object.assign(store.S.profile, keep.profile);
    store.save();
    toast("Jeu réinitialisé");
    location.hash = "#/";
  });
}
