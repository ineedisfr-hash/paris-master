// Barre d'orientation de la vue 3D : rotation, nord, inclinaison, boussole.
// Partagée par la carte (Explorer) et le mode Apprendre.
import { toast } from "./util.js";

/** HTML de la barre ; `compass: false` la retire (inutile pendant l'apprentissage). */
export function orientHTML({ compass = true } = {}) {
  return `<div class="orient" hidden role="toolbar" aria-label="Orientation de la carte">
      <button class="o-btn rot-l" title="Tourner vers la gauche" aria-label="Tourner vers la gauche">⟲</button>
      <button class="o-btn north" title="Nord en haut" aria-label="Nord en haut"><span class="needle">▲</span>N</button>
      <button class="o-btn rot-r" title="Tourner vers la droite" aria-label="Tourner vers la droite">⟳</button>
      <button class="o-btn tilt-up" title="Incliner davantage la carte" aria-label="Incliner davantage la carte">Incliner</button>
      <button class="o-btn tilt-down" title="Redresser la carte (jusqu'à la vue à plat)" aria-label="Redresser la carte">Redresser</button>
      ${compass ? `<button class="o-btn compass" title="Orienter selon le téléphone">Boussole</button>` : ""}
    </div>`;
}

/**
 * Branche la barre. `get3d()` renvoie la vue 3D active (ou null).
 * Renvoie une fonction de nettoyage.
 */
export function wireOrient(scope, get3d) {
  const q = (s) => scope.querySelector(s);
  const sync = () => {
    const m3 = get3d();
    if (!m3) return;
    const n = q(".orient .needle");
    if (n) n.style.transform = `rotate(${-m3.bearing}deg)`;
    const up = q(".tilt-up"), down = q(".tilt-down");
    if (up) up.disabled = m3.pitch >= m3.maxTilt - 1;
    if (down) down.disabled = m3.pitch <= 1;
  };
  const later = (ms) => setTimeout(sync, ms);
  q(".rot-l")?.addEventListener("click", () => { get3d()?.rotate(-45); later(450); });
  q(".rot-r")?.addEventListener("click", () => { get3d()?.rotate(45); later(450); });
  q(".north")?.addEventListener("click", () => { get3d()?.north(); later(550); });
  q(".tilt-up")?.addEventListener("click", () => { get3d()?.tilt(15); later(450); });
  q(".tilt-down")?.addEventListener("click", () => { get3d()?.tilt(-15); later(450); });
  q(".compass")?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    const m3 = get3d();
    if (!m3) return;
    try {
      const on = await m3.setCompass(!m3.compass);
      b.classList.toggle("on", !!on);
      toast(on ? "La carte suit maintenant l'orientation du téléphone" : "Boussole désactivée");
    } catch (err) { toast(err.message); }
  });
  const timer = setInterval(sync, 700);
  return () => clearInterval(timer);
}
