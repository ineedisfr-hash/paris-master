"""Vérification de bout en bout dans Chromium (Playwright).

Prérequis : un serveur statique sur la racine du projet, ex.
    python -m http.server 8765 --bind 127.0.0.1
Usage :
    python tools/e2e_check.py [URL] [--shots DOSSIER]
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = next((a for a in sys.argv[1:] if a.startswith("http")), "http://127.0.0.1:8765/")
SHOTS = Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
VIEWPORTS = [("iphone-375", 375, 812), ("iphone-390", 390, 844), ("iphone-414", 414, 896), ("tablet-768", 768, 1024), ("desktop-1440", 1440, 900)]
ROUTES = ["#/", "#/carte", "#/niveaux", "#/jouer", "#/stats", "#/badges", "#/reglages", "#/apprendre/1"]

problems = []


def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"))


def check_overflow(page, label):
    w = page.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")
    if w[0] > w[1] + 1:
        problems.append(f"{label} : débordement horizontal ({w[0]} > {w[1]})")


def dismiss(page):
    """Ferme les fenêtres de célébration (grade, badge, niveau) comme le ferait l'utilisateur."""
    for _ in range(6):
        page.wait_for_timeout(150)
        btn = page.locator(".celebrate:not(.out) button")
        if not btn.count():
            return
        btn.first.click()
        page.wait_for_timeout(300)


def play_mcq_session(page, label, max_q=40):
    """Répond à toutes les questions d'une séance (choix multiples ou carte)."""
    answered = 0
    for _ in range(max_q):
        try:
            page.wait_for_selector(".result, .opt:not([disabled]), .validate", timeout=2500)
        except Exception:
            pass
        dismiss(page)
        if page.locator(".result").count():
            page.wait_for_timeout(700)
            dismiss(page)
            return answered
        if page.locator(".opt:not([disabled])").count():
            page.locator(".opt:not([disabled])").first.click()
        elif page.locator(".validate").count():
            box = page.locator("#pmap").bounding_box()
            page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
            page.locator(".validate:not([disabled])").click()
        else:
            problems.append(f"{label} : ni options ni carte à la question {answered + 1}")
            return answered
        answered += 1
        dismiss(page)
        nxt = page.locator(".nextq")
        if nxt.count():
            nxt.click()
    return answered


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    for name, w, h in VIEWPORTS:
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 800 else 1, has_touch=w < 800, is_mobile=w < 800, locale="fr-FR")
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(f"pageerror: {e} @ {page.url} | {(getattr(e, 'stack', '') or '')[:500]}"))
        page.on("console", lambda m: m.type == "error" and errs.append(f"console: {m.text}"))
        page.goto(URL)
        page.wait_for_selector(".dash", timeout=15000)
        for r in ROUTES:
            page.goto(URL + r)
            page.wait_for_timeout(700)
            check_overflow(page, f"{name} {r}")
            shot(page, f"{name}_{r.strip('#/').replace('/', '-') or 'accueil'}")
        if name == "iphone-390":
            # Apprendre : parcourir 5 fiches
            page.goto(URL + "#/apprendre/1")
            page.wait_for_selector(".fiche")
            for _ in range(5):
                page.locator(".ok").click()
                page.wait_for_timeout(150)
            shot(page, f"{name}_apprendre-fiche")
            # Apprendre le squelette : tracé animé, puis contrôle obligatoire du palier 1
            page.goto(URL + "#/apprendre/0")
            page.wait_for_selector(".fiche")
            page.wait_for_timeout(2600)
            if page.locator(".seqm").count() < 5:
                problems.append("squelette : pastilles des boulevards absentes")
            shot(page, f"{name}_apprendre-squelette")
            for _ in range(8):
                if page.locator(".pause").count():
                    break
                page.locator(".ok").click()
                page.wait_for_timeout(200)
            if not page.locator("a[href*='jouer/palier']").count():
                problems.append("pas de contrôle de palier après 5 nouveautés")
            else:
                shot(page, f"{name}_apprendre-controle")
                if page.locator(".learn-nav:visible").count():
                    problems.append("boutons Précédent/J'ai compris visibles sous le contrôle")
                page.locator("a[href*='jouer/palier']").click()
                page.wait_for_timeout(600)
                play_mcq_session(page, f"{name} palier")
                back = page.locator(".result a[href*='apprendre']")
                if not back.count():
                    problems.append("contrôle express : pas de retour vers l'apprentissage")
                else:
                    back.click()
                    # retour : fiche suivante, ou écran « plafond du jour » (10 nouveautés déjà découvertes ici)
                    page.wait_for_selector(".fiche, .pause", timeout=15000)
                    if page.locator(".pause").count():
                        shot(page, f"{name}_apprendre-plafond")
            # Préparation des jeux : tous les éléments des niveaux 0, 1 et des portes découverts, paliers validés
            page.evaluate("""async () => {
              const st = await import('./js/store.js'); const d = await import('./js/data.js');
              for (const l of d.DB.levels.filter((l) => [0, 1, 10].includes(l.id))) { for (const id of l.items) st.markLearned(id); st.S.paliers[l.id] = 99; }
              st.S.settings.newPerDay = 0; st.save();
            }""")
            # Profil : page complète, réinitialisation proposée
            page.goto(URL + "#/profil")
            page.wait_for_selector(".danger-zone .reset")
            shot(page, f"{name}_profil")
            # Portes : apprendre (portes noires) et carte des commissariats
            page.goto(URL + "#/apprendre/10?item=porte-maillot")
            page.wait_for_selector(".fiche")
            page.wait_for_timeout(1500)
            shot(page, f"{name}_apprendre-porte")
            page.goto(URL + "#/carte?item=tour-eiffel")
            # délai large : la 3D est rendue sans carte graphique dans le navigateur de test
            page.wait_for_selector(".sheet:not([hidden]) figure.photo img", timeout=15000)
            shot(page, f"{name}_carte-photo")
            if not page.locator(".ppin").count():
                problems.append("commissariats absents de la carte")
            # Carte : clic sur un élément via la recherche, puis mode mémorisation
            page.goto(URL + "#/carte")
            page.wait_for_timeout(500)
            page.fill(".search", "Boulevard Voltaire")
            page.press(".search", "Enter")
            page.wait_for_selector(".sheet:not([hidden]) .fiche", timeout=15000)
            shot(page, f"{name}_carte-fiche")
            page.locator(".sheet .close").click()
            # « Quelle est cette rue ? » en mode mémorisation : nom masqué puis révélé
            page.locator(".seg button[data-learn='0']").click()
            page.wait_for_timeout(300)
            box = page.locator("#emap").bounding_box()
            page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.55)
            page.wait_for_selector(".gpop", timeout=15000)
            if page.locator(".gp-reveal").count():
                if not page.locator(".gp-name.masked").count():
                    problems.append("nom de rue non masqué en mémorisation")
                page.locator(".gp-reveal").click()
                if page.locator(".gp-name.masked").count():
                    problems.append("« Révéler » ne dévoile pas le nom")
            shot(page, f"{name}_carte-quelle-rue")
            page.locator(".seg button[data-learn='1']").click()
            # Vue 3D : bascule, vol vers un monument, survol, retour en 2D
            page.locator(".d3-btn").click()
            page.wait_for_selector("#emap3d .maplibregl-canvas", timeout=15000)
            page.wait_for_timeout(2500)
            if page.locator(".mpin3d").count() < 30:
                problems.append("3D : épingles manquantes")
            page.fill(".search", "Panthéon")
            page.press(".search", "Enter")
            page.wait_for_selector(".sheet:not([hidden]) .orbit", timeout=15000)
            page.locator(".sheet .orbit").click()
            page.wait_for_timeout(3000)
            shot(page, f"{name}_carte-3d-survol")
            page.locator(".d3-btn").click()
            page.wait_for_timeout(500)
            if not page.locator("#emap3d").get_attribute("hidden") is not None:
                problems.append("3D : retour en 2D impossible")
            page.locator(".seg button[data-learn='0']").click()
            page.locator(".filters-btn").click()
            page.select_option(".arr-select", "11")
            page.wait_for_timeout(600)
            shot(page, f"{name}_carte-memorisation-11e")
            # Tous les modes
            for mode in ["portes", "axes", "defi", "quiz", "retrouve", "identifie", "monuments", "parcours", "revision"]:
                page.goto(URL + f"#/jouer/{mode}")
                page.wait_for_timeout(600)
                if mode == "retrouve":
                    shot(page, f"{name}_jeu-{mode}-question")
                n = play_mcq_session(page, f"{name} {mode}")
                if not page.locator(".result").count():
                    problems.append(f"{name} {mode} : pas d'écran de résultat après {n} réponses")
                shot(page, f"{name}_jeu-{mode}-resultat")
            # Une question de quiz avec correction affichée
            page.goto(URL + "#/jouer/quiz?niveau=1")
            page.wait_for_selector(".opt")
            shot(page, f"{name}_quiz-question")
            page.locator(".hint-btn").click()
            if page.locator(".opt.gone").count() != 2:
                problems.append("l'indice 50/50 n'a pas retiré 2 réponses")
            page.locator(".opt:not(.gone)").first.click()
            page.wait_for_selector(".feedback:not([hidden])")
            shot(page, f"{name}_quiz-correction")
            # Chrono 10/60
            page.goto(URL + "#/jouer/chrono?format=10-60")
            n = play_mcq_session(page, f"{name} chrono")
            page.wait_for_timeout(1500)
            if not page.locator(".result").count():
                problems.append(f"{name} chrono : pas de résultat")
            # Examens des niveaux 0 et 1
            for lv in (0, 1):
                page.goto(URL + f"#/jouer/examen?niveau={lv}")
                page.wait_for_timeout(500)
                n = play_mcq_session(page, f"{name} examen {lv}")
                if n != 20:
                    problems.append(f"{name} examen niveau {lv} : {n} questions au lieu de 20")
            shot(page, f"{name}_examen-resultat")
            # La progression est bien persistée
            st = page.evaluate("() => JSON.parse(localStorage.getItem('paris-master.v1'))")
            if not st or st["xp"] <= 0 or not st["cards"]:
                problems.append("progression non enregistrée")
            else:
                print(f"  progression : {st['xp']} XP, {len(st['cards'])} fiches, {len(st['errors'])} erreurs, examens {st['levels']}")
            page.goto(URL + "#/")
            page.wait_for_timeout(600)
            shot(page, f"{name}_accueil-apres")
            page.goto(URL + "#/stats")
            page.wait_for_timeout(400)
            shot(page, f"{name}_stats-apres")
        for e in errs:
            if "tile.openstreetmap.org" in e:
                continue
            problems.append(f"{name} : {e}")
        ctx.close()
    browser.close()

print("\n".join(problems) if problems else "AUCUN PROBLÈME")
sys.exit(1 if problems else 0)
