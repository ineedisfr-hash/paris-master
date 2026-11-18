// Effets ludiques : sons (synthétisés, aucun fichier), vibrations, XP flottante, célébrations.
import { S } from "./store.js";
import { esc } from "./util.js";

let ctx = null;
function audio() {
  if (!S.settings.sound) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq, start, dur, { type = "sine", vol = 0.18 } = {}) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = a.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sound = {
  good() { tone(660, 0, 0.12); tone(990, 0.08, 0.2); },
  perfect() { tone(784, 0, 0.1); tone(988, 0.07, 0.1); tone(1319, 0.14, 0.25); },
  bad() { tone(220, 0, 0.25, { type: "triangle", vol: 0.16 }); tone(180, 0.1, 0.3, { type: "triangle", vol: 0.12 }); },
  combo() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.06, 0.15, { vol: 0.14 })); },
  tick() { tone(1200, 0, 0.05, { type: "square", vol: 0.05 }); },
  fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.22, { type: "triangle", vol: 0.16 })); },
  pin() { tone(880, 0, 0.06, { vol: 0.08 }); },
};

export function buzz(pattern) {
  if (S.settings.vibrate && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* non supporté */ }
  }
}

/** Petit texte qui s'envole depuis un élément (« +12 XP »). */
export function floatText(anchor, text, kind = "good") {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = `float-xp ${kind}`;
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top + r.height / 2}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

export function shake(el) {
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

function confetti(host, n = 46) {
  const colors = ["#f2b33d", "#1a73e8", "#34a853", "#ea4335", "#ffffff", "#c3a6ff"];
  for (let i = 0; i < n; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 0.4}s`;
    c.style.animationDuration = `${1.4 + Math.random() * 1.2}s`;
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    host.appendChild(c);
  }
}

/** Écran de célébration (grade, niveau validé, badge). Les célébrations s'enchaînent. */
const queue = [];
let showing = false;
export function celebrate({ kicker, title, text = "", medal = true }) {
  queue.push({ kicker, title, text, medal });
  if (!showing) nextCelebration();
}
function nextCelebration() {
  const c = queue.shift();
  if (!c) { showing = false; return; }
  showing = true;
  const el = document.createElement("div");
  el.className = "celebrate";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML = `<div class="cel-card">
      ${c.medal ? `<span class="cel-medal"></span>` : ""}
      <p class="eyebrow">${esc(c.kicker)}</p>
      <h2>${esc(c.title)}</h2>
      ${c.text ? `<p class="muted">${esc(c.text)}</p>` : ""}
      <button class="btn primary">Continuer</button>
    </div>`;
  document.body.appendChild(el);
  confetti(el);
  sound.fanfare();
  buzz([30, 40, 60]);
  const close = () => { el.classList.add("out"); setTimeout(() => { el.remove(); nextCelebration(); }, 200); };
  el.querySelector("button").addEventListener("click", close);
  el.querySelector("button").focus();
}
