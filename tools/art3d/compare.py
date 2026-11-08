"""Lines the 3D test body up against a current body's art and measures how their proportions differ.

Usage: uv run --with pillow --with numpy python3 tools/art3d/compare.py [base-id] [out.png]
  (default base: spiky; default picture: .character-cache/art3d/compare.png)

Both idle frames are scaled to court pixels and lined up at the feet. Each body is split into parts:
the current art by its regions.png, the test body by its palette slots. For each part it prints
where it starts and ends (court px above the feet) and how wide it gets, side by side, and draws
the current art faded with the test body's outline over it, plus the landmark lines of each.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASE = sys.argv[1] if len(sys.argv) > 1 else "spiky"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, ".character-cache", "art3d", "compare.png")
SCALE = 1.0  # picture size: court px x this


def current():
    d = os.path.join(ROOT, "assets", "characters", "bases", BASE)
    meta = json.load(open(os.path.join(d, "sprites.json")))
    x, y, w, h, ox, oy = meta["frames"]["idle"][0]
    img = Image.open(os.path.join(d, "sprites.webp")).convert("RGBA").crop((x, y, x + w, y + h))
    reg = np.asarray(Image.open(os.path.join(d, "regions.png")))[y:y + h, x:x + w, 0]
    alpha = np.asarray(img)[..., 3] > 127
    names = {1: "skin", 2: "hair", 3: "jersey", 4: "team", 5: "shoes"}
    part = np.full(reg.shape, "", dtype=object)
    part[alpha] = "other"
    for k, n in names.items():
        part[alpha & (reg == k)] = n
    return img, part, meta["res"], ox, oy


def test_body():
    d = os.path.join(ROOT, "assets", "characters", "lab", "rookie")
    meta = json.load(open(os.path.join(d, "sprites.json")))
    x, y, w, h, ox, oy = meta["frames"]["idle"][0]
    slot_part = {}
    for name, slots in meta["palette"].items():
        for s in slots:
            slot_part[s] = name
    layers = []
    for f in ("sprites.png", "hair.png"):
        layers.append(np.asarray(Image.open(os.path.join(d, f)))[y:y + h, x:x + w])
    idx = np.where(layers[1] > 0, layers[1], layers[0])
    part = np.full(idx.shape, "", dtype=object)
    for s, n in slot_part.items():
        part[idx == s] = {"line": "other", "ball": "other", "eyes": "skin", "sole": "shoes", "socks": "other"}.get(n, n)
    img = Image.open(os.path.join(d, "sprites.png")).convert("RGBA").crop((x, y, x + w, y + h))
    hair = Image.open(os.path.join(d, "hair.png")).convert("RGBA").crop((x, y, x + w, y + h))
    img.alpha_composite(hair)
    return img, part, meta["res"], ox, oy


def landmarks(part, res, ox, oy):
    """For each part: top, bottom (court px above the feet, so bigger is higher) and widest span."""
    out = {}
    rows = lambda m: np.nonzero(m.any(1))[0]
    to_court = lambda r: -(r + oy) / res
    for name in ("hair", "skin", "jersey", "team", "shoes"):
        m = part == name
        r = rows(m)
        if not len(r):
            continue
        widths = m.sum(1) / res
        out[name] = (round(to_court(r[0])), round(to_court(r[-1] + 1)), round(widths.max()))
    # The head: skin rows above the top of the jersey.
    jt = rows(part == "jersey")[0]
    head = (part == "skin").copy()
    head[jt:] = False
    r = rows(head)
    if len(r):
        out["face"] = (round(to_court(r[0])), round(to_court(r[-1] + 1)), round((head.sum(1) / res).max()))
    allm = part != ""
    r = rows(allm)
    out["whole"] = (round(to_court(r[0])), round(to_court(r[-1] + 1)), round((allm.sum(1) / res).max()))
    return out


a_img, a_part, a_res, a_ox, a_oy = current()
b_img, b_part, b_res, b_ox, b_oy = test_body()
A, B = landmarks(a_part, a_res, a_ox, a_oy), landmarks(b_part, b_res, b_ox, b_oy)
print(f"{'part':8} {'current top/bottom/width':>26} {'3D top/bottom/width':>24}   height ratio (3D/current)")
for k in ("whole", "hair", "face", "skin", "jersey", "team", "shoes"):
    if k in A and k in B:
        ha, hb = A[k][0] - A[k][1], B[k][0] - B[k][1]
        print(f"{k:8} {str(A[k]):>26} {str(B[k]):>24}   {hb / max(1, ha):.2f}")
json.dump({"current": A, "test": B}, open(os.path.splitext(OUT)[0] + ".json", "w"))

# The picture: both in court px x SCALE, feet at the same point.
def placed(img, res, ox, oy):
    k = SCALE / res
    im = img.resize((round(img.width * k), round(img.height * k)), Image.NEAREST)
    return im, round(ox * k), round(oy * k)


W, H, FX, FY = 560, 520, 280, 490
canvas = Image.new("RGBA", (W * 2, H), (245, 240, 232, 255))
ai, ax, ay = placed(a_img, a_res, a_ox, a_oy)
faded = ai.copy()
faded.putalpha(Image.eval(ai.getchannel("A"), lambda v: v * 0.45))
canvas.alpha_composite(faded, (FX + ax, FY + ay))
bi, bx, by = placed(b_img, b_res, b_ox, b_oy)
mask = np.asarray(bi)[..., 3] > 127
edge = mask & ~(np.roll(mask, 1, 0) & np.roll(mask, -1, 0) & np.roll(mask, 1, 1) & np.roll(mask, -1, 1))
outline = np.zeros((*mask.shape, 4), np.uint8)
outline[edge] = (20, 120, 220, 255)
canvas.alpha_composite(Image.fromarray(outline), (FX + bx, FY + by))
g = ImageDraw.Draw(canvas)
for marks, colour, x0, x1 in ((A, (200, 60, 60, 255), 0, 60), (B, (20, 120, 220, 255), W - 60, W)):
    for k in ("hair", "face", "jersey", "team", "shoes"):
        if k in marks:
            for v in marks[k][:2]:
                y = FY - v * SCALE
                g.line((x0, y, x1, y), fill=colour)
            g.text((x0 + 2, FY - marks[k][0] * SCALE + 1), k, fill=colour)
# Right half: the two side by side, same scale and feet line.
canvas.alpha_composite(ai, (W + 150 + ax, FY + ay))
canvas.alpha_composite(bi, (W + 400 + bx, FY + by))
g.line((W, FY, 2 * W, FY), fill=(120, 120, 120, 255))
canvas.save(OUT)
print("picture:", OUT)
