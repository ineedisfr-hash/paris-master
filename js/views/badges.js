import * as store from "../store.js";
import { esc } from "../util.js";

export default function badges(root) {
  const S = store.S;
  root.innerHTML = `
  <section class="page">
    <h1>Badges</h1>
    <p class="lead">${store.BADGES.filter((b) => S.badges[b.id]).length} sur ${store.BADGES.length} obtenus.</p>
    <ul class="badges">${store.BADGES.map((b) => `
      <li class="${S.badges[b.id] ? "on" : ""}">
        <span class="medal"></span>
        <div><strong>${esc(b.name)}</strong><small>${esc(b.desc)}</small>
        ${S.badges[b.id] ? `<small class="date">Obtenu le ${new Date(S.badges[b.id] + "T12:00").toLocaleDateString("fr-FR")}</small>` : ""}</div>
      </li>`).join("")}</ul>
    <h2>Grades</h2>
    <ol class="grades">${store.GRADES.map((g, i) => `<li class="${store.grade().index >= i ? "on" : ""}"><strong>${esc(g.name)}</strong><small>${g.xp} XP</small></li>`).join("")}</ol>
  </section>`;
}
