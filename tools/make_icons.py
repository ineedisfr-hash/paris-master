"""Génère les icônes PNG (iPhone, Android) à partir du même dessin que icons/icon.svg."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"

def draw(size, rounded=True):
    s = 4  # suréchantillonnage pour l'anticrénelage
    W = size * s
    k = W / 512
    im = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(112 * k), fill="#0b0f14")
    else:
        d.rectangle([0, 0, W, W], fill="#0b0f14")
    d.ellipse([(256 - 168) * k, (256 - 168) * k, (256 + 168) * k, (256 + 168) * k], outline="#263142", width=int(20 * k))
    # Seine : courbe de Bézier échantillonnée
    def bez(p0, p1, p2, p3, n=60):
        return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * e for a, b, c, e in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n + 1))]
    pts = bez((70, 300), (150, 230), (210, 330), (280, 250)) + bez((280, 250), (350, 170), (400, 190), (450, 230))
    pts = [(x * k, y * k) for x, y in pts]
    d.line(pts, fill="#4aa3ff", width=int(30 * k), joint="curve")
    for x, y in (pts[0], pts[-1]):
        r = 15 * k
        d.ellipse([x - r, y - r, x + r, y + r], fill="#4aa3ff")
    d.ellipse([(256 - 46) * k, (226 - 46) * k, (256 + 46) * k, (226 + 46) * k], fill="#f2b33d")
    d.ellipse([(256 - 18) * k, (226 - 18) * k, (256 + 18) * k, (226 + 18) * k], fill="#0b0f14")
    return im.resize((size, size), Image.LANCZOS)

draw(192).save(OUT / "icon-192.png")
draw(512).save(OUT / "icon-512.png")
draw(180, rounded=False).save(OUT / "apple-touch-icon.png")  # iOS arrondit lui-même
print("ok")
