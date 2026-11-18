"""Construit data/paris.json à partir de sources vérifiables.

Sources :
  - Ville de Paris, « arrondissements » : limites administratives officielles.
  - Ville de Paris, « voie » : tracé central (filaire) de chaque voie.
  - Ville de Paris, « denominations-emprises-voies-actuelles » : nomenclature officielle
    (arrondissements, quartiers, tenants/aboutissants, longueur, origine du nom, emprise).
  - OpenStreetMap via Nominatim : monuments, gares, parcs, plans d'eau.

Aucune coordonnée n'est saisie à la main. Tout ce qui est dérivé (orientation, connexions,
repères proches) est calculé à partir des géométries. Le rapport tools/validation_report.md
liste chaque incohérence détectée.

Usage : python tools/build_data.py [--refresh]
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
CATALOG = ROOT / "tools" / "catalog.json"
OUT = ROOT / "data" / "paris.json"
REPORT = ROOT / "tools" / "validation_report.md"
UA = "ParisMasterDataPrep/1.0 (personal educational project; python-urllib)"
OD = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
REFRESH = "--refresh" in sys.argv

# ---------------------------------------------------------------- téléchargement

def fetch(url: str, *, sleep: float = 0.0) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(url.encode()).hexdigest()[:20]
    path = CACHE / key
    if path.exists() and not REFRESH:
        return path.read_bytes()
    last = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr"})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
            path.write_bytes(data)
            if sleep:
                time.sleep(sleep)
            return data
        except Exception as e:  # noqa: BLE001
            last = e
            if "CERTIFICATE_VERIFY_FAILED" in str(e):
                # le magasin de certificats de Python peut différer de celui du système : repli sur curl
                import subprocess
                r = subprocess.run(["curl", "-sfL", "-m", "300", "-A", UA, "-o", str(path), url])
                if r.returncode == 0 and path.exists():
                    return path.read_bytes()
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Téléchargement impossible : {url} ({last})")


def fetch_json(url: str, **kw):
    return json.loads(fetch(url, **kw))

# ---------------------------------------------------------------- texte

def norm(s: str) -> str:
    s = s.lower().replace("œ", "oe").replace("æ", "ae")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[-'’ʼ.]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")


def cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s

# ---------------------------------------------------------------- géométrie (mètres locaux)

LAT0 = 48.8566
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110574


def P(lon, lat):
    return ((lon - 2.3488) * KX, (lat - LAT0) * KY)


def seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def dp(points, tol):
    """Douglas-Peucker sur des points projetés (liste de (x, y, payload))."""
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    idx, dmax = 0, -1
    for i in range(1, len(points) - 1):
        d = seg_dist(points[i][:2], a[:2], b[:2])
        if d > dmax:
            idx, dmax = i, d
    if dmax <= tol:
        return [a, b]
    return dp(points[: idx + 1], tol)[:-1] + dp(points[idx:], tol)


def simplify_lonlat(coords, tol):
    pts = [(*P(lon, lat), (lon, lat)) for lon, lat in coords]
    return [p[2] for p in dp(pts, tol)]


def line_len(xy):
    return sum(math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]) for i in range(len(xy) - 1))


def sample(xy, step):
    out = [xy[0]]
    for i in range(len(xy) - 1):
        (x1, y1), (x2, y2) = xy[i], xy[i + 1]
        L = math.hypot(x2 - x1, y2 - y1)
        n = max(1, int(L // step))
        for k in range(1, n + 1):
            out.append((x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n))
    return out


def in_ring(p, ring):
    x, y = p
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]; xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_poly(p, rings):
    """rings = [outer, *holes]"""
    return in_ring(p, rings[0]) and not any(in_ring(p, h) for h in rings[1:])


def bbox(xy):
    xs = [p[0] for p in xy]; ys = [p[1] for p in xy]
    return (min(xs), min(ys), max(xs), max(ys))


def bbox_near(a, b, m):
    return not (a[2] + m < b[0] or b[2] + m < a[0] or a[3] + m < b[1] or b[3] + m < a[1])


class Shape:
    """Géométrie projetée d'un élément : lignes (parts) et/ou polygones (rings)."""

    def __init__(self, lines=None, polys=None, point=None):
        self.lines = [l for l in (lines or []) if len(l) >= 2]
        self.polys = polys or []  # liste de [outer, *holes]
        self.point = point
        segs_src = list(self.lines) + [r for poly in self.polys for r in poly]
        self.segs = [(l[i], l[i + 1]) for l in segs_src for i in range(len(l) - 1)]
        allpts = [p for l in segs_src for p in l] + ([point] if point else [])
        self.bb = bbox(allpts)
        self.samples = [p for l in segs_src for p in sample(l, 10)] + ([point] if point else [])

    def dist_point(self, p):
        if any(in_poly(p, poly) for poly in self.polys):
            return 0.0
        d = min((seg_dist(p, a, b) for a, b in self.segs), default=math.inf)
        if self.point:
            d = min(d, math.hypot(p[0] - self.point[0], p[1] - self.point[1]))
        return d

    def dist(self, other):
        if not bbox_near(self.bb, other.bb, 800):
            return math.inf
        best = math.inf
        for p in self.samples:
            d = other.dist_point(p)
            if d < best:
                best = d
                if best == 0:
                    break
        return best

# ---------------------------------------------------------------- chargement des sources

def load_arrondissements():
    gj = fetch_json(f"{OD}/arrondissements/exports/geojson")
    arrs = []
    for f in gj["features"]:
        pr = f["properties"]; g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        # garder le plus grand polygone extérieur
        rings_ll = max(polys, key=lambda pl: len(pl[0]))
        rings_xy = [[P(*c) for c in r] for r in rings_ll]
        simple = [simplify_lonlat(r, 6) for r in rings_ll]
        arrs.append({
            "n": int(pr["c_ar"]),
            "name": pr["l_aroff"],
            "rings_ll": simple,
            "rings_xy": [[P(*c) for c in r] for r in simple],
            "rings_full": rings_xy,
        })
    arrs.sort(key=lambda a: a["n"])
    assert [a["n"] for a in arrs] == list(range(1, 21)), "Les 20 arrondissements sont attendus"
    return arrs


def arr_label(n: int) -> str:
    return "1er" if n == 1 else f"{n}e"


def load_denominations():
    sel = "typo_min,typvoie,arrdt,quartier,debut,fin,longueur,largeur,orig,ouverture,statut"
    rows = fetch_json(f"{OD}/denominations-emprises-voies-actuelles/exports/json?select={sel}")
    idx = {}
    for r in rows:
        if r.get("typo_min"):
            idx.setdefault(norm(r["typo_min"]), []).append(r)
    return idx


def load_filaire():
    rows = fetch_json(f"{OD}/voie/exports/json?select=l_longmin,c_desi,geom")
    idx = {}
    for r in rows:
        if r.get("l_longmin") and r.get("geom"):
            idx.setdefault(norm(r["l_longmin"]), []).append(r)
    return idx


def overpass(q: str):
    return fetch_json("https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(q))


def load_junctions():
    """Échangeurs du périphérique nommés « Porte … » (OSM)."""
    els = overpass('[out:json][timeout:90];node["highway"="motorway_junction"]["name"~"^Porte"](48.80,2.20,48.91,2.48);out;')["elements"]
    out = {}
    for e in els:
        out.setdefault(norm(e["tags"]["name"]), []).append((e["lon"], e["lat"], e["id"]))
    return out


def nearest_arr(p, arrs):
    a = arr_of_point(p, arrs)
    if a:
        return a["n"]
    return min(arrs, key=lambda a: min(seg_dist(p, r[i], r[i + 1]) for r in a["rings_xy"] for i in range(len(r) - 1)))["n"]


def emprise(official: str):
    q = urllib.parse.quote(f'typo_min="{official}"')
    data = fetch_json(f"{OD}/denominations-emprises-voies-actuelles/records?where={q}&select=geo_shape&limit=5")
    for r in data.get("results", []):
        g = (r.get("geo_shape") or {}).get("geometry")
        if g:
            return g
    return None


def nominatim(q: str, osm: str | None):
    if osm:
        t, i = osm.split("/")
        url = "https://nominatim.openstreetmap.org/lookup?" + urllib.parse.urlencode({
            "osm_ids": t[0].upper() + i, "format": "jsonv2", "polygon_geojson": 1,
            "polygon_threshold": 0.00003, "accept-language": "fr"})
    else:
        url = NOMINATIM + "?" + urllib.parse.urlencode({
            "q": q, "format": "jsonv2", "polygon_geojson": 1, "polygon_threshold": 0.00003,
            "viewbox": "2.22,48.92,2.48,48.80", "bounded": 1, "limit": 5, "accept-language": "fr"})
    path = CACHE / hashlib.sha1(url.encode()).hexdigest()[:20]
    res = fetch_json(url, sleep=0 if path.exists() and not REFRESH else 1.2)
    res = [r for r in res if r.get("category", r.get("class")) not in ("highway",)]
    return res[0] if res else None

# ---------------------------------------------------------------- analyse

def geom_parts(g):
    """GeoJSON -> (lines_ll, polys_ll)"""
    t, c = g["type"], g["coordinates"]
    if t == "LineString":
        return [c], []
    if t == "MultiLineString":
        return c, []
    if t == "Polygon":
        return [], [c]
    if t == "MultiPolygon":
        return [], c
    if t == "Point":
        return [], []
    raise ValueError(t)


def in_paris(lonlat, arrs):
    p = P(*lonlat)
    return any(in_poly(p, a["rings_xy"]) for a in arrs)


def arr_of_point(p, arrs):
    for a in arrs:
        if in_poly(p, a["rings_xy"]):
            return a
    return None


def geo_arrondissements(shape: Shape, arrs, deep=25.0):
    """Arrondissements où l'élément pénètre de plus de `deep` mètres (et ceux qu'il longe à < deep)."""
    inside, near = set(), set()
    pts = shape.samples
    for p in pts:
        for a in arrs:
            if in_poly(p, a["rings_xy"]):
                d = min(seg_dist(p, r[i], r[i + 1]) for r in a["rings_xy"] for i in range(len(r) - 1))
                (inside if d > deep else near).add(a["n"])
                if d <= deep:
                    # point sur une limite : l'arrondissement voisin est aussi bordé
                    for b in arrs:
                        if b is not a and any(seg_dist(p, r[i], r[i + 1]) <= deep for r in b["rings_xy"] for i in range(len(r) - 1)):
                            near.add(b["n"])
                break
    return inside, near


def orientation(shape: Shape):
    pts = [p for l in shape.lines for p in sample(l, 20)]
    if len(pts) < 5:
        return None
    mx = sum(p[0] for p in pts) / len(pts); my = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts); syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    tr, det = sxx + syy, sxx * syy - sxy * sxy
    l1 = tr / 2 + math.sqrt(max(0, tr * tr / 4 - det)); l2 = tr - l1
    if l2 > 0 and l1 / l2 < 6:
        return None  # tracé trop courbe pour une orientation unique
    ang = math.degrees(0.5 * math.atan2(2 * sxy, sxx - syy))  # depuis l'est, sens trigo
    a = abs(ang)
    if a < 22.5:
        return "est – ouest"
    if a > 67.5:
        return "nord – sud"
    return "sud-ouest – nord-est" if ang > 0 else "nord-ouest – sud-est"


def arrs_from_text(arrdt):
    out = []
    for s in arrdt or []:
        m = re.match(r"(\d+)", s)
        if m:
            out.append(int(m.group(1)))
    return sorted(set(out))


CAT_BY_TYPVOIE = {"avenue": "avenue", "boulevard": "boulevard", "rue": "rue", "quai": "quai",
                  "pont": "pont", "place": "place", "rond-point": "place", "port": "quai"}

# ---------------------------------------------------------------- construction

def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    print("Chargement des arrondissements…"); arrs = load_arrondissements()
    print("Chargement de la nomenclature des voies…"); denom = load_denominations()
    print("Chargement du filaire des voies…"); fil = load_filaire()

    warnings, errors = [], []
    items: dict[str, dict] = {}
    junctions = load_junctions()
    shapes: dict[str, Shape] = {}

    unique = {}
    for lv in catalog["levels"]:
        for it in lv["items"]:
            unique.setdefault(it["name"], it)

    for name, it in unique.items():
        iid = slug(name)
        rec = {"id": iid, "name": name, "kind": it["kind"], "complement": bool(it.get("complement")),
               "alias": it.get("alias", []), "note": it.get("note")}
        if it["kind"] == "porte":
            # 1) place officielle « place de la Porte de … » ; 2) échangeur OSM du périphérique ; 3) Nominatim
            lines_ll, polys_ll = [], []
            rows = denom.get(norm("place de la " + name)) or denom.get(norm("place " + name))
            if rows:
                d = rows[0]
                g = emprise(d["typo_min"])
                if g:
                    _, polys_ll = geom_parts(g)
                rec["official"] = d["typo_min"]
                rec["arr"] = arrs_from_text(d.get("arrdt"))
                rec["source"] = "Ville de Paris (nomenclature des voies)"
            nodes = junctions.get(norm(name), [])
            if nodes:
                lon = sum(n[0] for n in nodes) / len(nodes); lat = sum(n[1] for n in nodes) / len(nodes)
                if not polys_ll:  # sinon, l'épingle reste sur la place officielle dessinée
                    rec["point"] = [lat, lon]
                rec["osm"] = f"node/{nodes[0][2]}"
                if not rows:
                    rec["source"] = f"OpenStreetMap, échangeur du périphérique (node/{nodes[0][2]})"
            if not rows and not nodes:
                r = nominatim(name + ", Paris", None)
                if r and norm(r.get("name") or r.get("display_name", "").split(",")[0]) == norm(name):
                    rec["point"] = [float(r["lat"]), float(r["lon"])]
                    rec["osm"] = f"{r['osm_type']}/{r['osm_id']}"
                    rec["source"] = f"OpenStreetMap ({rec['osm']})"
            if not polys_ll and not rec.get("point"):
                errors.append(f"**{name}** : aucune source vérifiable (ni place officielle, ni échangeur OSM, ni objet OSM du même nom)")
                continue
            if not rec.get("point"):
                ring = polys_ll[0][0]
                rec["point"] = [sum(c[1] for c in ring) / len(ring), sum(c[0] for c in ring) / len(ring)]
            pxy = P(rec["point"][1], rec["point"][0])
            mar = shapes.get("boulevards-des-marechaux")
            dm = mar.dist_point(pxy) if mar else 0
            if dm > 800:
                errors.append(f"**{name}** : objet trouvé à {round(dm)} m des boulevards des Maréchaux — pas une porte du périphérique, exclu")
                continue
            if "arr" not in rec:
                rec["arr"] = [nearest_arr(pxy, arrs)]
            rec["cat"] = "porte"
        elif it["kind"] == "anneau":
            # suite ordonnée de voies officielles ; chaque membre est vérifié, puis les raccords
            members, lines_ll, line_member, polys_ll = [], [], [], []
            for k, mname in enumerate(it["members"]):
                rows = denom.get(norm(mname))
                if not rows:
                    errors.append(f"**{name}** : membre « {mname} » introuvable dans la nomenclature officielle")
                    continue
                d = rows[0]
                mlines = [l for fr in fil.get(norm(d["typo_min"]), []) for l in geom_parts(fr["geom"]["geometry"])[0]]
                if not mlines:
                    errors.append(f"**{name}** : membre « {mname} » sans tracé")
                    continue
                members.append({"name": cap(d["typo_min"]), "arr": arrs_from_text(d.get("arrdt")),
                                "_xy": [[P(*c) for c in l] for l in mlines]})
                for l in mlines:
                    lines_ll.append(l); line_member.append(len(members) - 1)
            for a, b in zip(members, members[1:]):
                da = Shape(lines=a["_xy"]).dist(Shape(lines=b["_xy"]))
                if da > 60:
                    warnings.append(f"{name} : « {a['name']} » et « {b['name']} » ne se raccordent pas ({'plus de 800' if da == math.inf else round(da)} m) — coupure attendue ou ordre à vérifier")
            for mm in members:
                mm.pop("_xy")
            rec["cat"] = "anneau"
            rec["_seqDir"] = it.get("seqDir", "dans l'ordre du tracé")
            rec["members"] = members
            rec["_lineMember"] = line_member
            rec["arr"] = sorted({n for mm in members for n in mm["arr"]})
            rec["source"] = "Ville de Paris (nomenclature des voies, filaire de voirie)"
        elif it["kind"] == "voie":
            official = it.get("official", name)
            rows = denom.get(norm(official))
            if not rows:
                cands = [k for k in denom if norm(official).split()[-1] in k][:8]
                errors.append(f"**{name}** : introuvable dans la nomenclature officielle (candidats : {cands})")
                continue
            d = rows[0]
            rec["official"] = d["typo_min"]
            rec["cat"] = CAT_BY_TYPVOIE.get((d.get("typvoie") or "").lower(), "voie")
            rec["arr"] = arrs_from_text(d.get("arrdt"))
            rec["quartiers"] = d.get("quartier") or []
            for k in ("debut", "fin", "orig", "ouverture"):
                if d.get(k):
                    rec[k] = d[k].strip().rstrip(".") + "."
            if d.get("longueur"):
                rec["longueurOfficielle"] = d["longueur"]
            lines_ll, polys_ll = [], []
            frows = fil.get(norm(d["typo_min"]), [])
            for fr in frows:
                ls, _ = geom_parts(fr["geom"]["geometry"])
                lines_ll += ls
            if rec["cat"] == "place" or not lines_ll:
                g = emprise(d["typo_min"])
                if g:
                    _, polys_ll = geom_parts(g)
            if not lines_ll and not polys_ll:
                errors.append(f"**{name}** : aucune géométrie officielle")
                continue
            rec["source"] = "Ville de Paris (nomenclature des voies, filaire de voirie)"
        else:
            r = nominatim(it["q"], it.get("osm"))
            if not r:
                errors.append(f"**{name}** : introuvable sur OpenStreetMap (requête « {it['q']} »)")
                continue
            rec["cat"] = it["category"]
            rec["osm"] = f"{r['osm_type']}/{r['osm_id']}"
            rec["osmName"] = r.get("display_name", "")
            rec["source"] = f"OpenStreetMap ({rec['osm']})"
            g = r.get("geojson") or {"type": "Point", "coordinates": [float(r["lon"]), float(r["lat"])]}
            lines_ll, polys_ll = geom_parts(g)
            # découper ce qui sort de Paris (canal de l'Ourcq, bois…)
            if lines_ll:
                clipped = []
                for l in lines_ll:
                    cur = []
                    for c in l:
                        if in_paris(c, arrs):
                            cur.append(c)
                        elif cur:
                            clipped.append(cur); cur = []
                    if cur:
                        clipped.append(cur)
                lines_ll = [l for l in clipped if len(l) >= 2]
            rec["point"] = [float(r["lat"]), float(r["lon"])]
            m = re.search(r"Paris (\d+)(?:er|e) Arrondissement", rec["osmName"])
            rec["_osmArr"] = int(m.group(1)) if m else None

        # simplification et projection
        tol = 3
        lines_ll = [simplify_lonlat(l, tol) for l in lines_ll]
        polys_ll = [[simplify_lonlat(r, tol) for r in poly] for poly in polys_ll]
        pt = rec.get("point")
        shape = Shape(lines=[[P(*c) for c in l] for l in lines_ll],
                      polys=[[[P(*c) for c in r] for r in poly] for poly in polys_ll],
                      point=P(pt[1], pt[0]) if pt else None)
        shapes[iid] = shape

        rnd = lambda c: [round(c[1], 5), round(c[0], 5)]
        if "_lineMember" in rec:
            rec["lineMember"] = rec.pop("_lineMember")
        rec["geom"] = {"lines": [[rnd(c) for c in l] for l in lines_ll],
                       "polys": [[[rnd(c) for c in r] for r in poly] for poly in polys_ll]}
        if not pt:
            xs = shape.samples
            cx = sum(p[0] for p in xs) / len(xs); cy = sum(p[1] for p in xs) / len(xs)
            # point de la géométrie le plus proche du barycentre
            best = min(xs, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
            rec["point"] = [round(best[1] / KY + LAT0, 5), round(best[0] / KX + 2.3488, 5)]
        if shape.lines:
            rec["longueurCalculee"] = round(sum(line_len(l) for l in shape.lines))
            o = orientation(shape)
            if o and rec["cat"] not in ("place", "pont", "anneau"):
                rec["orientation"] = o

        # arrondissements : officiels pour les voies, calculés pour les lieux ; contrôle croisé
        inside, near = geo_arrondissements(shape, arrs)
        if it["kind"] in ("anneau", "porte"):
            pass
        elif it["kind"] == "voie":
            off = set(rec["arr"])
            missing = off - inside - near
            extra = inside - off
            if missing:
                warnings.append(f"{name} : arrondissement(s) officiel(s) {sorted(missing)} non retrouvé(s) par la géométrie")
            if extra:
                warnings.append(f"{name} : la géométrie pénètre dans {sorted(extra)} absent(s) de la liste officielle {sorted(off)}")
        else:
            a = arr_of_point(P(rec["point"][1], rec["point"][0]), arrs)
            bb = shape.bb
            small = max(bb[2] - bb[0], bb[3] - bb[1]) < 200
            # un petit monument posé sur une limite (ex. Arc de Triomphe) appartient
            # à tous les arrondissements qu'il touche ; un grand espace, à ceux où il pénètre.
            geo = sorted((inside | near) if small else (inside or ({a["n"]} if a else set())))
            if not geo and a:
                geo = [a["n"]]
            rec["arr"] = geo
            if rec["_osmArr"] and rec["_osmArr"] not in geo:
                warnings.append(f"{name} : OSM indique le {rec['_osmArr']}e, la géométrie donne {geo}")
            if not geo:
                errors.append(f"**{name}** : hors des limites de Paris")
        rec.pop("_osmArr", None)
        items[iid] = rec
        print(f"  ✓ {name:42s} {rec['cat']:10s} arr {rec['arr']}")

    # ------------------------------------------------ relations calculées
    print("Calcul des connexions…")
    ids = list(items)
    for i in ids:
        items[i]["links"] = []; items[i]["near"] = []
    ways = {"avenue", "boulevard", "rue", "quai", "pont", "voie", "place", "anneau"}
    for x in range(len(ids)):
        for y in range(x + 1, len(ids)):
            a, b = ids[x], ids[y]
            A, B = items[a], items[b]
            d = shapes[a].dist(shapes[b])
            if d == math.inf:
                continue
            both_ways = A["cat"] in ways and B["cat"] in ways
            if both_ways and d <= 15:
                A["links"].append(b); B["links"].append(a)
            elif not both_ways and d <= 400:
                A["near"].append([b, round(d)]); B["near"].append([a, round(d)])
    for r in items.values():
        r["near"].sort(key=lambda t: t[1])

    # ------------------------------------------------ croisements dans l'ordre
    print("Calcul des croisements dans l'ordre…")
    # repères candidats : éléments du programme (rues et places comprises) + grands axes du filaire
    by_norm = {norm(r.get("official", r["name"])): r for r in items.values() if r["cat"] != "anneau"}
    cands = []
    for cid, r in items.items():
        if r["cat"] in ("anneau",) or r["cat"] in ("monument", "gare", "parc", "eau"):
            continue
        cands.append((norm(r.get("official", r["name"])), r["name"], cid, shapes[cid].dist_point, shapes[cid].bb))
    for nname, rows in fil.items():
        if nname in by_norm:
            continue
        for r in rows:
            if r.get("c_desi") in MAJOR:
                for l in geom_parts(r["geom"]["geometry"])[0]:
                    xy = [P(*c) for c in l]
                    if len(xy) >= 2:
                        segs = list(zip(xy, xy[1:]))
                        cands.append((nname, r["l_longmin"], None, (lambda segs: lambda p: min(seg_dist(p, a, b) for a, b in segs))(segs), bbox(xy)))
    for iid, r in items.items():
        if r["cat"] == "anneau":
            r["sequence"] = [{"name": mm["name"]} for mm in r["members"]]
            r["seqDir"] = r.pop("_seqDir")
            continue
        if r["cat"] not in ("avenue", "boulevard", "rue", "quai") or r.get("longueurCalculee", 0) < 400:
            continue
        sh = shapes[iid]
        pts = [p for l in sh.lines for p in sample(l, 8)]
        mx = sum(p[0] for p in pts) / len(pts); my = sum(p[1] for p in pts) / len(pts)
        sxx = sum((p[0] - mx) ** 2 for p in pts); syy = sum((p[1] - my) ** 2 for p in pts)
        sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
        th = 0.5 * math.atan2(2 * sxy, sxx - syy)
        ux, uy = math.cos(th), math.sin(th)
        if abs(ux) >= abs(uy):
            if ux < 0: ux, uy = -ux, -uy           # d'ouest en est
            sdir = "d'ouest en est"
        else:
            if uy > 0: ux, uy = -ux, -uy           # du nord au sud
            sdir = "du nord au sud"
        proj = lambda p: p[0] * ux + p[1] * uy
        tmin, tmax = min(map(proj, pts)), max(map(proj, pts))
        own = norm(r.get("official", r["name"]))
        hits = {}
        for nname, label, cid, dfun, bb in cands:
            if nname == own or cid == iid or not bbox_near(sh.bb, bb, 25):
                continue
            close = [p for p in pts if bbox_near((p[0], p[1], p[0], p[1]), bb, 20) and dfun(p) <= 20]
            if close:
                t = sum(map(proj, close)) / len(close)
                hits.setdefault(nname, (t, label, close[len(close) // 2], cid))
        seq = []
        for nname, (t, label, p, cid) in sorted(hits.items(), key=lambda kv: kv[1][0]):
            seq.append({"name": label, "id": cid,
                        "t": round((t - tmin) / (tmax - tmin), 3) if tmax > tmin else 0,
                        "at": [round(p[1] / KY + LAT0, 5), round(p[0] / KX + 2.3488, 5)]})
        if len(seq) >= 2:
            r["sequence"] = seq[:18]
            r["seqDir"] = sdir

    # ------------------------------------------------ niveaux
    levels = []
    for lv in catalog["levels"]:
        lids = [slug(it["name"]) for it in lv["items"] if slug(it["name"]) in items]
        for it in lv["items"]:
            if slug(it["name"]) not in items:
                errors.append(f"Niveau {lv['id']} : « {it['name']} » non intégré")
        levels.append({k: lv[k] for k in ("id", "title", "subtitle", "arrondissements")} | {"items": lids, "open": bool(lv.get("open"))})
        for iid in lids:
            if lv["arrondissements"] and not set(items[iid]["arr"]) & set(lv["arrondissements"]):
                warnings.append(f"Niveau {lv['id']} : {items[iid]['name']} ({items[iid]['arr']}) n'est dans aucun des arrondissements du niveau {lv['arrondissements']}")

    # portes : ordre calculé (sens des aiguilles d'une montre, depuis le nord) autour du centre de Paris
    for lv in levels:
        portes = [iid for iid in lv["items"] if items[iid]["cat"] == "porte"]
        if len(portes) >= 3:
            c0 = P(2.3488, LAT0)
            def bearing(iid):
                x, y = P(items[iid]["point"][1], items[iid]["point"][0])
                return math.atan2(x - c0[0], y - c0[1]) % (2 * math.pi)
            ordered = sorted(portes, key=bearing)
            lv["ring"] = ordered
            for k, iid in enumerate(ordered):
                items[iid]["ringIndex"] = k
            lv["items"] = ordered

    # photos des grands lieux (Wikidata → Wikimedia Commons), téléchargées pour le hors connexion
    photos(items, warnings)

    out = {
        "meta": {
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "sources": [
                "Ville de Paris — Arrondissements (opendata.paris.fr, licence ODbL)",
                "Ville de Paris — Voie, filaire de voirie (opendata.paris.fr, licence ODbL)",
                "Ville de Paris — Dénominations des emprises des voies actuelles (opendata.paris.fr, licence ODbL)",
                "© contributeurs OpenStreetMap (Nominatim, Overpass, licence ODbL)",
                "Photos : Wikimedia Commons (auteur et licence indiqués sur chaque photo)",
            ],
        },
        "arrondissements": [{"n": a["n"], "label": arr_label(a["n"]), "name": a["name"], "rings": [[[round(c[1], 5), round(c[0], 5)] for c in r] for r in a["rings_ll"]]} for a in arrs],
        "items": items,
        "levels": levels,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    lines = [f"# Rapport de validation — {out['meta']['generated']}", "",
             f"- Éléments intégrés : **{len(items)}**", f"- Erreurs : **{len(errors)}**", f"- Avertissements : **{len(warnings)}**", ""]
    lines += ["## Erreurs (élément exclu)", ""] + [f"- {e}" for e in errors] + ["", "## Avertissements (à vérifier)", ""] + [f"- {w}" for w in warnings]
    lines += ["", "## Lieux OpenStreetMap retenus", ""] + [f"- {r['name']} → `{r['osm']}` — {r.get('osmName', r.get('source', ''))}" for r in items.values() if r.get("osm")]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{len(items)} éléments, {len(errors)} erreurs, {len(warnings)} avertissements → {OUT.name}, {REPORT.name}")
    for e in errors:
        print("ERREUR", e)
    for w in warnings:
        print("AVERT ", w)


POLICE = ROOT / "data" / "police.json"
PHOTOS = ROOT / "data" / "photos"
WM = "https://www.wikidata.org/w/api.php"
CM = "https://commons.wikimedia.org/w/api.php"


def strip_html(x):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", x or "")).strip()


def photos(items, warnings):
    """Photo principale (Wikidata P18) des monuments, gares, parcs et plans d'eau."""
    PHOTOS.mkdir(parents=True, exist_ok=True)
    for iid, r in items.items():
        if r["cat"] not in ("monument", "gare", "parc", "eau") or not r.get("osm"):
            continue
        try:
            photo_for(iid, r, warnings)
        except Exception as e:  # noqa: BLE001 — une photo manquante ne doit pas bloquer la génération
            warnings.append(f"Photo : téléchargement impossible pour {r['name']} ({str(e)[:80]}) — relancer plus tard")


def shrink(path, width=560, quality=72):
    """Photo allégée pour le téléphone (≈ 60 Ko)."""
    from PIL import Image
    im = Image.open(path).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(path, "JPEG", quality=quality, optimize=True, progressive=True)


def photo_for(iid, r, warnings):
    if True:
        t, i = r["osm"].split("/")
        look = fetch_json("https://nominatim.openstreetmap.org/lookup?" + urllib.parse.urlencode(
            {"osm_ids": t[0].upper() + i, "format": "jsonv2", "extratags": 1}), sleep=1.2)
        qid = (look[0].get("extratags") or {}).get("wikidata") if look else None
        if not qid:
            warnings.append(f"Photo : pas d'identifiant Wikidata pour {r['name']}")
            return
        ent = fetch_json(WM + "?" + urllib.parse.urlencode({"action": "wbgetentities", "ids": qid, "props": "claims", "format": "json"}))
        claims = ent["entities"][qid].get("claims", {}).get("P18")
        if not claims:
            warnings.append(f"Photo : aucune image principale sur Wikidata ({qid}) pour {r['name']}")
            return
        fname = claims[0]["mainsnak"]["datavalue"]["value"]
        info = fetch_json(CM + "?" + urllib.parse.urlencode({"action": "query", "titles": "File:" + fname, "prop": "imageinfo",
                                                              "iiprop": "url|extmetadata", "iiurlwidth": 640, "format": "json"}), sleep=2)
        page = next(iter(info["query"]["pages"].values()))
        ii = page["imageinfo"][0]
        meta = ii.get("extmetadata", {})
        dest = PHOTOS / f"{iid}.jpg"
        dest.write_bytes(fetch(ii["thumburl"], sleep=2))
        shrink(dest)
        r["photo"] = {"src": f"data/photos/{iid}.jpg", "author": strip_html(meta.get("Artist", {}).get("value")) or "Auteur inconnu",
                      "license": strip_html(meta.get("LicenseShortName", {}).get("value")), "page": ii.get("descriptionurl"), "wikidata": qid}
        print(f"  photo ✓ {r['name']} ({qid})")


def build_police():
    """Police nationale à Paris (OSM) : commissariats nommés, autres sites de la police nationale."""
    arrs = load_arrondissements()
    els = overpass('[out:json][timeout:90];nwr["amenity"="police"](48.815,2.224,48.903,2.470);out center tags;')["elements"]
    out = []
    for e in els:
        t = e.get("tags", {})
        name = t.get("name", "")
        low = name.lower()
        kind = t.get("police:FR", "")
        if not name or kind in ("police_municipale", "gendarmerie") or "municipale" in low or "gendarmerie" in low:
            continue
        if not (kind == "police" or "commissariat" in low or "police nationale" in low or "préfecture de police" in low):
            continue
        lat, lon = (e["lat"], e["lon"]) if "lat" in e else (e["center"]["lat"], e["center"]["lon"])
        a = arr_of_point(P(lon, lat), arrs)
        if not a:
            continue
        addr = " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x)
        out.append({"name": name, "type": "commissariat" if "commissariat" in low else "prefecture" if "préfecture" in low else "police",
                    "addr": addr, "arr": a["n"], "at": [round(lat, 5), round(lon, 5)], "osm": f"{e['type']}/{e['id']}"})
    out.sort(key=lambda x: (x["type"] != "commissariat", x["arr"]))
    POLICE.write_text(json.dumps({"source": "© contributeurs OpenStreetMap (amenity=police), données communautaires à vérifier", "items": out},
                                 ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Police : {len(out)} sites dont {sum(x['type'] == 'commissariat' for x in out)} commissariats nommés → {POLICE.name}")


MAJOR = {"AV", "BD", "QU", "PONT", "CRS", "AUT", "PRT", "RPT"}
MINOR = {"RUE", "PL", "VOIE", "RTE", "PARV", "ESPL", "CHAU", "CAR", "RLE"}
CONTEXT = ROOT / "data" / "context.json"


def assemble_rings(ways):
    """Assemble des segments (listes de [lon, lat]) en anneaux fermés."""
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(cur) >= 4:
            rings.append(cur)
    return rings


def build_context():
    """Fond de carte vectoriel sans aucun nom : toutes les voies (filaire officiel) et l'eau (OSM)."""
    rows = fetch_json(f"{OD}/voie/exports/json?select=l_longmin,c_desi,geom")
    streets, names, name_idx = [], [], {}
    for r in rows:
        code = r.get("c_desi")
        cls = 0 if code in MAJOR else 1 if code in MINOR else None
        if cls is None or not r.get("geom"):
            continue
        name = r.get("l_longmin") or ""
        if name not in name_idx:
            name_idx[name] = len(names); names.append(name)
        for line in geom_parts(r["geom"]["geometry"])[0]:
            s = simplify_lonlat(line, 4)
            if len(s) >= 2:
                streets.append([cls, name_idx[name]] + [v for lon, lat in s for v in (round(lat, 5), round(lon, 5))])
    q = ('[out:json][timeout:120];(relation["natural"="water"](48.81,2.22,48.91,2.47);'
         'way["natural"="water"](48.81,2.22,48.91,2.47););out geom;')
    osm = fetch_json("https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(q))
    water = []
    flat = lambda ring: [v for lon, lat in simplify_lonlat(ring, 4) for v in (round(lat, 5), round(lon, 5))]
    area = lambda ring: abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip([P(*c) for c in ring], [P(*c) for c in ring[1:]]))) / 2
    for e in osm["elements"]:
        if e["type"] == "way":
            outers, inners = [[[p["lon"], p["lat"]] for p in e["geometry"]]], []
        else:
            mem = lambda role: [[[p["lon"], p["lat"]] for p in m["geometry"]] for m in e["members"] if m.get("role") == role and m.get("geometry")]
            outers, inners = assemble_rings(mem("outer")), assemble_rings(mem("inner"))
        for o in outers:
            if len(o) < 4 or area(o) < 3000:
                continue  # trop petit (fontaines, bassins décoratifs)
            oxy = [P(*c) for c in o]
            holes = [h for h in inners if len(h) >= 4 and in_ring(P(*h[0]), oxy)]
            water.append([flat(o)] + [flat(h) for h in holes])
    CONTEXT.write_text(json.dumps({"names": names, "streets": streets, "water": water}, separators=(",", ":")), encoding="utf-8")
    print(f"Contexte : {len(streets)} tronçons de voies, {len(water)} surfaces d'eau → {CONTEXT.name} ({CONTEXT.stat().st_size // 1024} Ko)")


if __name__ == "__main__":
    main()
    build_context()
    build_police()
