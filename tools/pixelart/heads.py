"""Heads for layered players, from art/heads/head-<style>.png.

  python tools/pixelart/heads.py [style ...]      (no styles: every head-*.png in art/heads)

Each image is 16:9 with two rows of five squares, laid out like art/heads/template-orson.png: front,
front-right, right, back-right, back; normal, then looking up (for shots). Any 16:9 size works. (An
older five-in-a-row image gives the normal views only, and shots use them too.) For each view this
keys out the green, shrinks it to the game's pixel size (the square the rig gives that view,
tools/pixelart/rig.py), lines it up by the neck with Orson's head in the same view, and gives every
pixel a slot of the rig's palette: hair and skin get their five tones, shaded like his (so the game
recolours them), dark lines the outline colour, anything else (eyes, a hair tie, glasses) the nearest
fixed colour. Writes:

  assets/characters/heads/<style>.png    the views side by side, in the rig's palette
  assets/characters/heads/index.json     each style's views (where they are in its image) and the
                                         cache versions of the heads and the body
  art/heads/preview-<style>.png          the head on the body in every facing, big, to check
"""
import hashlib, json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from rig import LAYOUT, VIEWS, fold_into_parts, view_box, view_key  # noqa: E402

RIG = Path("assets/characters/rig")
OUT = Path("assets/characters/heads")
ART = Path("art/heads")
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


def read_views(path, rig):
    """Each view of a head image, shrunk to the game's size: {view: (colours, kept)}."""
    src = Image.open(path).convert("RGB")
    W, H = src.size
    cells = rig["heads"]["cells"]
    if abs(W / H - 16 / 9) < 0.08:
        scale = W / LAYOUT["w"]
        boxes = {vk: view_box(r, c, scale) for r, keys in enumerate(VIEWS) for c, vk in enumerate(keys)}
    else:  # five in a row: the normal views
        side = W / len(VIEWS[0])
        boxes = {vk: (int(c * side), 0, int((c + 1) * side), int(min(side, H))) for c, vk in enumerate(VIEWS[0])}
    views = {}
    for vk, box in boxes.items():
        sq = np.array(src.crop(box))
        keep = key_green(sq)
        rgba = np.dstack([sq, keep * 255]).astype(np.uint8)
        size = cells[vk]["w"]
        # shrink: average the colour of what's kept, keep a pixel if most of its block was kept
        pre = rgba.astype(float)
        pre[..., :3] *= pre[..., 3:4] / 255
        small = np.array(Image.fromarray(pre.astype(np.uint8), "RGBA").resize((size, size), Image.BOX)).astype(float)
        a = small[..., 3]
        col = np.where(a[..., None] > 0, small[..., :3] * 255 / np.maximum(a[..., None], 1), 0)
        views[vk] = (col, a > 110)
    return views


def label(views, rig):
    """Each kept pixel's part: "skin", "hair", "dark" (a line) or a fixed palette slot.

    Hair in shadow can be as dark and warm as skin, so one sample colour of each can't tell them apart.
    Instead the head's colours are grouped (a dozen groups), and each group is hair or skin by where it
    mostly turns up: the crown and the back of the head are hair, the middle of the face from the front
    and the cheek from the side are skin."""
    rgb = np.array(rig["rgb"])
    fixed = [i for i in range(1, len(rgb)) if i not in PARTS]
    dark = [i for i in fixed if lum(rgb[i]) < 60]
    light_fixed = [i for i in fixed if i not in dark]

    def zone(vk, y0, y1, x0, x1):
        """A box in a view, as shares of its head's height and width."""
        m = views[vk][1]
        ys, xs = np.where(m)
        z = np.zeros(m.shape, bool)
        if not len(ys):
            return z
        t, b, l, r = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        z[int(t + (b - t) * y0):int(t + (b - t) * y1), int(l + (r - l) * x0):int(l + (r - l) * x1)] = True
        return z & m

    hair_ev = {vk: np.zeros(views[vk][1].shape, bool) for vk in views}
    skin_ev = {vk: np.zeros(views[vk][1].shape, bool) for vk in views}
    for vk in views:
        hair_ev[vk] |= zone(vk, 0, 0.22, 0.2, 0.8)  # the crown, every view
    for vk in ("b", "up-b"):
        if vk in views:
            hair_ev[vk] |= zone(vk, 0, 0.62, 0.1, 0.9)  # the back of the head
    if "f" in views:
        skin_ev["f"] |= zone("f", 0.55, 0.85, 0.32, 0.68)  # nose, mouth, chin
    if "r" in views:
        skin_ev["r"] |= zone("r", 0.55, 0.85, 0.55, 0.9)  # cheek and jaw, side on

    # the colours that might be hair or skin: not lines, not grey, white or blue
    pts, where = [], []
    for vk, (col, m) in views.items():
        for y, x in zip(*np.where(m)):
            c = col[y, x]
            if lum(c) < 55 or c.max() - c.min() < 30 or c[2] > c[0] + 10:
                continue
            pts.append(c)
            where.append((vk, y, x))
    pts = np.array(pts, float)
    # group them (k-means in a lightness-and-colour space, a few rounds)
    feat = np.column_stack([lum(pts) / 2, (chroma(pts) * 400)])
    k = min(12, len(pts))
    rng = np.random.default_rng(0)
    centres = feat[rng.choice(len(feat), k, replace=False)]
    for _ in range(25):
        group = ((feat[:, None] - centres[None]) ** 2).sum(2).argmin(1)
        centres = np.array([feat[group == g].mean(0) if (group == g).any() else centres[g] for g in range(k)])
    h_in = np.zeros(k)
    s_in = np.zeros(k)
    for (vk, y, x), g in zip(where, group):
        h_in[g] += hair_ev[vk][y, x]
        s_in[g] += skin_ev[vk][y, x]
    h_share = h_in / max(1, h_in.sum())
    s_share = s_in / max(1, s_in.sum())
    decided = [g for g in range(k) if h_in[g] + s_in[g] >= 3]
    part_of_group = {}
    for g in range(k):
        if g in decided:
            part_of_group[g] = "hair" if h_share[g] >= s_share[g] else "skin"
    for g in range(k):
        if g not in part_of_group:  # seen in neither place: like the nearest group that was
            near = min(decided, key=lambda d: ((centres[g] - centres[d]) ** 2).sum()) if decided else None
            part_of_group[g] = part_of_group.get(near, "skin")

    labels = {}
    for vk, (col, m) in views.items():
        lab = np.empty(m.shape, object)
        for y, x in zip(*np.where(m)):
            c = col[y, x]
            if lum(c) < 55:
                lab[y, x] = "dark"
            else:
                lab[y, x] = min(light_fixed, key=lambda i: ((rgb[i] - c) ** 2).sum())  # eyes, glasses, a tie
        labels[vk] = lab
    for (vk, y, x), g in zip(where, group):
        labels[vk][y, x] = part_of_group[g]
    return labels, dark


def neck_point(lab, m):
    """The bottom middle of the neck: the lowest rows of skin, their middle. None if little skin shows."""
    skin = np.zeros(m.shape, bool)
    for y, x in zip(*np.where(m)):
        skin[y, x] = lab[y, x] == "skin"
    ys, xs = np.where(skin)
    if len(ys) < 10:
        return None
    bottom = ys.max()
    low = ys >= bottom - 2
    return float(xs[low].mean()), float(bottom)


def shift(a, dy, dx):
    out = np.zeros_like(a)
    h, w = a.shape[:2]
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = a[ys, xs]
    return out


def convert(style, rig):
    views = read_views(ART / f"head-{style}.png", rig)
    labels, dark = label(views, rig)
    rgb = np.array(rig["rgb"])
    cells = rig["heads"]["cells"]
    slots = {"skin": SKIN, "hair": HAIR}

    # lined up by the neck with Orson's head in the same view (a generated picture may sit a little off)
    moves = {}
    if style != "orson":
        rv = read_views(ART / "head-orson.png", rig)
        rl, _ = label(rv, rig)
        for vk in views:
            here = neck_point(labels[vk], views[vk][1])
            there = neck_point(rl[vk], rv[vk][1]) if vk in rv else None
            if here and there:
                dx, dy = int(round(there[0] - here[0])), int(round(there[1] - here[1]))
                limit = cells[vk]["w"] // 4
                if abs(dx) <= limit and abs(dy) <= limit:
                    moves[vk] = (dy, dx)

    # Tones like his: in each view, the same share of each tone (darkest to lightest) as his own head
    # had there, given out by brightness, so a new head is shaded the way the body around it is.
    target = his_tones(rig)
    outs = {}
    for vk, (col, m) in views.items():
        lab = labels[vk]
        tone_of = {}
        for p, ss in slots.items():
            here = sorted(lum(col[y, x]) for y, x in zip(*np.where(m)) if lab[y, x] == p)
            t = target[vk][p] if target[vk][p].sum() else target[vk.replace("up-", "")][p]
            share = np.cumsum(t) / max(1, t.sum())
            cuts = [here[min(len(here) - 1, int(q * len(here)))] for q in share[:-1]] if here else []
            tone_of[p] = lambda L, cuts=cuts, ss=ss: ss[int(np.searchsorted(cuts, L, side="right"))] if cuts else ss[3]
        out = np.zeros(m.shape, np.uint8)
        for y, x in zip(*np.where(m)):
            p = lab[y, x]
            if p == "dark":
                out[y, x] = min(dark, key=lambda i: ((rgb[i] - col[y, x]) ** 2).sum())
            elif p in slots:
                out[y, x] = tone_of[p](lum(col[y, x]))
            else:
                out[y, x] = p
        out = fold_into_parts(out, rig["rgb"])
        if vk in moves:
            out = shift(out, *moves[vk])
        # only down to his collar: the body's shoulders cover the rest
        out[min(out.shape[0], cells[vk]["neck"] + 3):] = 0
        outs[vk] = out
    sheet = np.zeros((max(o.shape[0] for o in outs.values()), sum(o.shape[1] for o in outs.values())), np.uint8)
    index = {}
    xs = 0
    for vk, out in outs.items():
        sheet[: out.shape[0], xs: xs + out.shape[1]] = out
        index[vk] = [xs, 0, out.shape[1], out.shape[0]]
        xs += out.shape[1]
    OUT.mkdir(parents=True, exist_ok=True)
    o = Image.fromarray(sheet, "P")
    flat = [v for c in rig["rgb"] for v in c]
    o.putpalette(flat + [0] * (768 - len(flat)))
    o.save(OUT / f"{style}.png", transparency=0, optimize=True)
    return index, sheet


def his_tones(rig):
    """How many of each skin and hair tone (darkest first) Orson's own head uses in each view, over
    all frames shown with it: what was taken off the body (tools/pixelart/rig.py)."""
    pix = np.array(Image.open("assets/characters/orson-pixel/sprites.png"))
    body = np.array(Image.open(RIG / "body.png"))
    removed = (body == 0) & (pix > 0)
    out = {vk: {"skin": np.zeros(5), "hair": np.zeros(5)} for row in VIEWS for vk in row}
    for key, (d, _, _, pose) in rig["heads"]["frames"].items():
        base, _ = view_key(d, pose)
        x, y = map(int, key.split(","))
        f = next(f for lst in rig["frames"].values() for f in lst if f[0] == x and f[1] == y)
        w, h = f[2], f[3]
        got = pix[y:y + h, x:x + w][removed[y:y + h, x:x + w]]
        for p, ss in (("skin", SKIN), ("hair", HAIR)):
            for t, s in enumerate(ss):
                out[base][p][t] += (got == s).sum()
    return out


def place(rig, key, index):
    """Where a head goes in a frame: (x, y, view, flipped). A view the head doesn't have (an older
    head without looking-up views) falls back to the normal one."""
    d, cx, cy, pose = rig["heads"]["frames"][key]
    vk, flip = view_key(d, pose)
    if vk not in index:
        vk = vk[3:]
    c = rig["heads"]["cells"][vk]
    w = index[vk][2]
    x = cx - c["ox"] - w if flip else cx + c["ox"]
    return int(round(x)), int(round(cy + c["oy"])), vk, flip


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
            hx, hy, vk, flip = place(rig, key, index)
            vx, vy, vw, vh = index[vk]
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
