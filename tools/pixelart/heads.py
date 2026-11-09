"""Heads for layered players, from art/heads/head-<style>.png.

  python tools/pixelart/heads.py [style ...]      (no styles: every head-*.png in art/heads)

Each image is five square views in a row (front, front-right, right, back-right, back; see
art/heads/README.md). For each view this keys out the green, shrinks it to the game's pixel size
(the square the rig gives that facing, tools/pixelart/rig.py), and gives every pixel a slot of the
rig's palette: hair and skin get their five tones (so the game recolours them), dark lines the
outline colour, anything else (eyes, a hair tie, glasses) the nearest fixed colour. Writes:

  assets/characters/heads/<style>.png    the five views side by side, in the rig's palette
  assets/characters/heads/index.json     each style's views (where they are in its image) and the
                                         cache versions of the heads and the body
  art/heads/preview-<style>.png          the head on the body in every facing, big, to check
"""
import hashlib, json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from rig import fold_into_parts  # noqa: E402

RIG = Path("assets/characters/rig")
OUT = Path("assets/characters/heads")
ART = Path("art/heads")
DRAWN = ["f", "fr", "r", "br", "b"]
SKIN = list(range(1, 6))
HAIR = list(range(6, 11))
PARTS = set(range(1, 26))  # recoloured slots: skin, hair, jersey, team, shoes


def key_green(rgb):
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    green = (g > r + 30) & (g > b + 30)
    return ~green


def lum(c):
    c = np.asarray(c, float)
    return c[..., 0] * 0.299 + c[..., 1] * 0.587 + c[..., 2] * 0.114


def chroma(c):
    c = np.asarray(c, float) + 1
    return c / c.sum(-1, keepdims=True)


def convert(style, rig):
    src = Image.open(ART / f"head-{style}.png").convert("RGB")
    n = len(DRAWN)
    side = src.width // n
    rgb = np.array(rig["rgb"])
    fixed = [i for i in range(1, len(rgb)) if i not in PARTS]
    dark = [i for i in fixed if lum(rgb[i]) < 60]
    light_fixed = [i for i in fixed if i not in dark]
    cells = rig["heads"]["cells"]

    views = {}
    for k, d in enumerate(DRAWN):
        sq = np.array(src.crop((k * side, 0, (k + 1) * side, min(side, src.height))))
        keep = key_green(sq)
        rgba = np.dstack([sq, keep * 255]).astype(np.uint8)
        size = cells[d]["w"]
        # shrink: average the colour of what's kept, keep a pixel if most of its block was kept
        im = Image.fromarray(rgba, "RGBA")
        pre = np.array(im).astype(float)
        pre[..., :3] *= pre[..., 3:4] / 255
        small = np.array(Image.fromarray(pre.astype(np.uint8), "RGBA").resize((size, size), Image.BOX)).astype(float)
        a = small[..., 3]
        col = np.where(a[..., None] > 0, small[..., :3] * 255 / np.maximum(a[..., None], 1), 0)
        views[d] = (col, a > 110)

    # what's hair and what's skin: from where they surely are (the middle of the face from the front,
    # the crown from behind)
    def sample(d, y0, y1, x0, x1):
        col, m = views[d]
        s = col.shape[0]
        ys, xs = slice(int(s * y0), int(s * y1)), slice(int(s * x0), int(s * x1))
        pick = col[ys, xs][m[ys, xs]]
        pick = pick[lum(pick) > 70]
        return np.median(pick, 0)

    skin_ref = sample("f", 0.5, 0.68, 0.38, 0.62)
    hair_ref = sample("b", 0.2, 0.45, 0.35, 0.65)

    def part_of(c):
        L = lum(c)
        if L < 55:
            return "dark"
        ds = np.abs(chroma(c) - chroma(skin_ref)).sum() * 6 + abs(L - lum(skin_ref)) / 160
        dh = np.abs(chroma(c) - chroma(hair_ref)).sum() * 6 + abs(L - lum(hair_ref)) / 160
        # not hair or skin: far from both, or grey/white/blue (eyes, glasses, a hair tie)
        c = np.asarray(c, float)
        greyish = c.max() - c.min() < 30 or c[2] > c[0] + 10
        if min(ds, dh) > 1.0 or (greyish and L > 120):
            return min(light_fixed, key=lambda i: ((rgb[i] - c) ** 2).sum())
        return "skin" if ds <= dh else "hair"

    # tones within hair and skin: by brightness, across all five views
    labels = {}
    lums = {"skin": [], "hair": []}
    for d, (col, m) in views.items():
        lab = np.empty(m.shape, object)
        for y, x in zip(*np.where(m)):
            p = part_of(col[y, x])
            lab[y, x] = p
            if p in lums:
                lums[p].append(lum(col[y, x]))
        labels[d] = lab
    slots = {"skin": SKIN, "hair": HAIR}
    # Tones like his: in each view, the same share of each tone (darkest to lightest) as his own head
    # had there, given out by brightness, so a new head is shaded the way the body around it is.
    target = his_tones(rig)
    tone_of = {}
    for d in DRAWN:
        col, m = views[d]
        tone_of[d] = {}
        for p, ss in slots.items():
            here = sorted(lum(col[y, x]) for y, x in zip(*np.where(m)) if labels[d][y, x] == p)
            share = np.cumsum(target[d][p]) / max(1, sum(target[d][p]))
            cuts = [here[min(len(here) - 1, int(s * len(here)))] for s in share[:-1]] if here else []
            tone_of[d][p] = lambda L, cuts=cuts, ss=ss: ss[int(np.searchsorted(cuts, L, side="right"))] if cuts else ss[3]

    xs = 0
    index = {}
    sheet = np.zeros((max(c["h"] for c in cells.values()), sum(cells[d]["w"] for d in DRAWN)), np.uint8)
    for d in DRAWN:
        col, m = views[d]
        lab = labels[d]
        c = cells[d]
        out = np.zeros(m.shape, np.uint8)
        for y, x in zip(*np.where(m)):
            p = lab[y, x]
            if p == "dark":
                out[y, x] = min(dark, key=lambda i: ((rgb[i] - col[y, x]) ** 2).sum())
            elif p in slots:
                out[y, x] = tone_of[d][p](lum(col[y, x]))
            else:
                out[y, x] = p
        out = fold_into_parts(out, rig["rgb"])
        # only down to his collar: the body's shoulders cover the rest
        out[min(out.shape[0], c["neck"] + 3):] = 0
        sheet[: out.shape[0], xs: xs + out.shape[1]] = out
        index[d] = [xs, 0, out.shape[1], out.shape[0]]
        xs += out.shape[1]
    OUT.mkdir(parents=True, exist_ok=True)
    o = Image.fromarray(sheet, "P")
    flat = [v for c in rig["rgb"] for v in c]
    o.putpalette(flat + [0] * (768 - len(flat)))
    o.save(OUT / f"{style}.png", transparency=0, optimize=True)
    return index, sheet


def his_tones(rig):
    """How many of each skin and hair tone (darkest first) Orson's own head uses in each drawn view,
    over all frames facing that way: what was taken off the body (tools/pixelart/rig.py)."""
    pix = np.array(Image.open("assets/characters/orson-pixel/sprites.png"))
    body = np.array(Image.open(RIG / "body.png"))
    removed = (body == 0) & (pix > 0)
    out = {d: {"skin": np.zeros(5), "hair": np.zeros(5)} for d in DRAWN}
    for key, (d, _, _) in rig["heads"]["frames"].items():
        base = rig["heads"]["mirror"].get(d, d)
        x, y = map(int, key.split(","))
        f = next(f for lst in rig["frames"].values() for f in lst if f[0] == x and f[1] == y)
        w, h = f[2], f[3]
        got = pix[y:y + h, x:x + w][removed[y:y + h, x:x + w]]
        for p, ss in (("skin", SKIN), ("hair", HAIR)):
            for t, s in enumerate(ss):
                out[base][p][t] += (got == s).sum()
    return out


def place(rig, key, head_sheet, view):
    """Where a head view goes in a frame: (x, y, flipped)."""
    d, cx, cy = rig["heads"]["frames"][key]
    base = rig["heads"]["mirror"].get(d, d)
    c = rig["heads"]["cells"][base]
    w = view[2]
    flip = d != base
    x = cx - c["ox"] - w if flip else cx + c["ox"]
    return int(round(x)), int(round(cy + c["oy"])), base, flip


def preview(style, rig, index, sheet):
    body = np.array(Image.open(RIG / "body.png"))
    rgb = np.array(rig["rgb"], np.uint8)
    shots = []
    for d in ["f", "fr", "r", "br", "b", "bl", "l", "fl"]:
        for anim in ("dribble", "run", "jump"):
            name = f"{anim}-{d}"
            if name not in rig["frames"]:
                continue
            for i in ([0] if anim != "jump" else [0, 3]):
                f = rig["frames"][name][min(i, len(rig["frames"][name]) - 1)]
                shots.append((name, f))
    P = 14
    S = 4
    tiles = []
    for name, f in shots:
        x, y, w, h = f[:4]
        key = f"{x},{y}"
        canvas = np.zeros((h + 2 * P, w + 2 * P), np.uint8)
        if key in rig["heads"]["frames"]:
            hx, hy, base, flip = place(rig, key, sheet, index[rig["heads"]["mirror"].get(rig["heads"]["frames"][key][0], rig["heads"]["frames"][key][0])])
            vx, vy, vw, vh = index[base]
            v = sheet[vy:vy + vh, vx:vx + vw]
            if flip:
                v = v[:, ::-1]
            for yy in range(vh):
                for xx in range(vw):
                    if v[yy, xx]:
                        ty, tx = hy + yy + P, hx + xx + P
                        if 0 <= ty < canvas.shape[0] and 0 <= tx < canvas.shape[1]:
                            canvas[ty, tx] = v[yy, xx]
        b = body[y:y + h, x:x + w]
        sub = canvas[P:P + h, P:P + w]
        sub[b > 0] = b[b > 0]
        im = np.zeros(canvas.shape + (3,), np.uint8)
        im[:] = (40, 160, 70)
        im[canvas > 0] = rgb[canvas[canvas > 0]]
        tiles.append((name, Image.fromarray(im).resize((canvas.shape[1] * S, canvas.shape[0] * S), Image.NEAREST)))
    cw = max(t.width for _, t in tiles)
    ch = max(t.height for _, t in tiles) + 14
    cols = 9
    out = Image.new("RGB", (cols * cw, ((len(tiles) + cols - 1) // cols) * ch), (40, 160, 70))
    g = ImageDraw.Draw(out)
    for k, (name, t) in enumerate(tiles):
        out.paste(t, ((k % cols) * cw, (k // cols) * ch + 14))
        g.text(((k % cols) * cw + 2, (k // cols) * ch), name, fill=(255, 255, 255))
    out.save(ART / f"preview-{style}.png")


def main():
    rig = json.load(open(RIG / "rig.json"))
    styles = sys.argv[1:] or sorted(p.stem[5:] for p in ART.glob("head-*.png"))
    path = OUT / "index.json"
    index = json.load(open(path)) if path.exists() else {}
    if "styles" not in index:
        index = {"styles": {}}
    stamp = lambda *files: hashlib.sha1(b"".join(Path(f).read_bytes() for f in files)).hexdigest()[:8]
    index["rig"] = stamp(RIG / "body.png", RIG / "rig.json")  # cache version of the shared body
    for style in styles:
        views, sheet = convert(style, rig)
        index["styles"][style] = {"views": views, "v": stamp(OUT / f"{style}.png")}
        preview(style, rig, views, sheet)
        print(style, "->", OUT / f"{style}.png", "and", ART / f"preview-{style}.png")
    json.dump(index, open(path, "w"), indent=1)


if __name__ == "__main__":
    main()
