"""Gear for kids made from video: Flow paints one item onto grids of a kid's frames in key colours, and this
turns what it painted into a layer the game draws over the kid (players/gear.js), never baked into the body.

  python tools/pixelart/gear_key.py grids <kid> <out dir>
      grids of the kid's frames for Flow (frame_grids.py layout), with the shoes and shorts greyed and the
      held ball painted back in, so nothing on the kid is near a key colour; also <kid>-mv-NN.jpg copies
      to upload under those names
  python tools/pixelart/gear_key.py build <kid> <item> <grids dir> <prefix>
      reads <prefix>-NN-k.img (named by match_grids.py), keeps the version of each grid that changed least
      besides the item, and writes assets/characters/gear/<item>/<kid>.webp + .png + .json

Key colours: the item's main colour is a shaded medium magenta (hue about 55 degrees in the Cb/Cr plane),
a second colour (stripes, trim) a shaded bright cyan-blue (about 320 degrees, far more saturated than any
kit colour). Each keeps its own light and shade. In the layer:
- <kid>.webp: the item's own pixels for each frame, packed; key-coloured pixels stored grey (their
  lightness), outlines and anything not key-coloured as Flow drew them.
- <kid>.png: red channel the part (1 = gear1, 2 = gear2, 0 = keep as drawn), green 255 on a body pixel the
  item hides (hair under a hat), at the same place in the same piece.
- <kid>.json: for each frame of the body sheet ("x,y"), its piece [ax, ay, w, h, dx, dy]: where it is in
  the webp, and where its corner sits from the frame's corner (it may reach outside the frame).
The item's entry in content/gear.js says what zone it's in and whether it goes over the held ball.
"""
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
GREEN = np.array([0, 177, 64], float)
SKIN, HAIR, JERSEY, TEAM, SHOES = 1, 2, 3, 4, 5


def ycc(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb, cr = b - y, r - y
    return y, np.hypot(cb, cr), (np.degrees(np.arctan2(cr, cb)) + 360) % 360


def keys(gen):
    """The two key colours in a picture Flow painted: (magenta, cyan, lightness)."""
    y, chroma, ang = ycc(gen)
    k1 = (chroma > 30) & (ang > 30) & (ang < 85)
    k2 = (chroma > 70) & (ang > 290) & (ang < 345)
    return k1, k2, y


def is_green(a):
    return (a[..., 1] > a[..., 0] + 40) & (a[..., 1] > a[..., 2] + 40)


# ---------- grids ----------

def grids(kid, out):
    d = f"{ROOT}/assets/characters/{kid}-detail"
    sheet = np.array(Image.open(f"{d}/sprites.webp").convert("RGBA")).astype(float)
    reg = np.array(Image.open(f"{d}/regions.png"))[..., 0]
    meta = json.load(open(f"{d}/sprites.json"))
    y = 0.299 * sheet[..., 0] + 0.587 * sheet[..., 1] + 0.114 * sheet[..., 2]
    for part, grey in ((SHOES, 215), (TEAM, 110)):
        m = reg == part
        ref = max(1.0, float(np.median(y[m])))
        k = (y[m] / ref)[:, None]
        sheet[m, :3] = np.where(k <= 1, grey * k, grey + (255 - grey) * (k - 1) * 0.6)
    im = Image.fromarray(sheet.clip(0, 255).astype(np.uint8))
    # the held ball, behind the body, so Flow sees hands holding a ball (not a hole)
    under = Image.new("RGBA", im.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(under)
    for key, (cx, cy, r) in meta.get("balls", {}).items():
        x, y0 = map(int, key.split(","))
        cx, cy = x + cx, y0 + cy
        g.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(60, 30, 20, 255))
        g.ellipse([cx - r + 1.5, cy - r + 1.5, cx + r - 1.5, cy + r - 1.5], fill=(214, 110, 40, 255))
        g.ellipse([cx - r * 0.55, cy - r * 0.75, cx + r * 0.1, cy - r * 0.2], fill=(240, 150, 80, 255))
    under.alpha_composite(im)
    tmp = f"{out}/.sheet"
    os.makedirs(tmp, exist_ok=True)
    under.save(f"{tmp}/sprites.webp", lossless=True)
    shutil.copy(f"{d}/sprites.json", f"{tmp}/sprites.json")
    # each move's frames together, so a whole move comes from one painting
    subprocess.run([sys.executable, f"{HERE}/frame_grids.py", tmp, out, "--moves"], check=True)
    for f in sorted(glob.glob(f"{out}/grid-[0-9][0-9].jpg")):
        shutil.copy(f, f"{out}/{kid}-mv-{os.path.basename(f)[5:7]}.jpg")


# ---------- build ----------

def facing(anim):
    return "b" if anim.endswith(("-b", "-bl", "-br")) else "s" if anim.endswith(("-l", "-r")) else "f"


def build(kid, item, gdir, prefix):
    """Each grid takes the one of its versions that changed least besides the item, whole, so every frame
    of a move (one grid holds whole moves) comes from the same painting. Frames whose item is far from the
    usual size for that side are listed: look at those grids."""
    d = f"{ROOT}/assets/characters/{kid}-detail"
    sheet = np.array(Image.open(f"{d}/sprites.webp").convert("RGBA"))
    regions = np.array(Image.open(f"{d}/regions.png"))[..., 0]
    layout = json.load(open(f"{gdir}/grids.json"))
    meta = json.load(open(f"{d}/sprites.json"))
    item_info = json.load(open(f"{ROOT}/content/gear.json"))[item]
    over_ball = item_info.get("ball") == "over"
    cands, notes = {}, []  # grid -> [(name, gen, k1, k2, lum, changed)]
    for gi in sorted({c["grid"] for c in layout}):
        orig = np.asarray(Image.open(f"{gdir}/grid-{gi:02d}.jpg").convert("RGB")).astype(float)
        for f in sorted(glob.glob(f"{prefix}-{gi:02d}-*.img")):
            gen = np.asarray(Image.open(f).convert("RGB").resize((orig.shape[1], orig.shape[0]), Image.LANCZOS)).astype(float)
            k1, k2, lum = keys(gen)
            spill = (np.abs(gen - orig).sum(-1) > 90) & ~ndimage.binary_dilation(k1 | k2, iterations=4)
            cands.setdefault(gi, []).append((os.path.basename(f), gen, orig, k1, k2, lum, spill))
        if gi not in cands:
            notes.append(f"grid {gi}: no images")
    # how big the item is in each frame, in each version (a share of the frame's body)
    sizes = {}
    for k, c in enumerate(layout):
        bx, by, bw, bh = c["box"]
        pad = 12
        for j, (_, gen, orig, k1, k2, _, spill) in enumerate(cands.get(c["grid"], [])):
            win = (slice(max(0, by - pad), by + bh + pad), slice(max(0, bx - pad), bx + bw + pad))
            body = max(1, int((~is_green(orig[by:by + bh, bx:bx + bw])).sum()))
            sizes[k, j] = (int((k1 | k2)[win].sum()) / body, int(spill[by:by + bh, bx:bx + bw].sum()) / body)
    usual = {}
    for side in "fsb":
        v = [r for (k, j), (r, _) in sizes.items() if facing(layout[k]["anim"]) == side and r > 0]
        usual[side] = float(np.median(v)) if v else 0
    pick = {}
    for gi, cs in cands.items():
        pick[gi] = min(range(len(cs)), key=lambda j: int(cs[j][6].sum()))
    pieces, odd = {}, []
    for k, c in enumerate(layout):
        if c["grid"] not in pick:
            continue
        j = pick[c["grid"]]
        r, sp = sizes[k, j]
        side = facing(c["anim"])
        off = abs(r - usual[side]) / max(usual[side], 1e-3) + 2 * sp
        if off > 0.45:
            odd.append(f"grid {c['grid']:02d} cell {layout.index(c) - min(i for i, x in enumerate(layout) if x['grid'] == c['grid']):2d} ({c['anim']}): {off:.0%} off the usual size")
        _, gen, orig, k1, k2, lum, _ = cands[c["grid"]][j]
        piece = cut(c, gen, orig, k1, k2, lum, sheet, regions, meta, over_ball, item_info.get("hides") == "hair")
        if piece is not None:
            pieces[f"{c['rect'][0]},{c['rect'][1]}"] = piece
    borrowed = borrow(layout, pieces, sheet)
    if item_info.get("hides") == "hair":
        for c in layout:
            key = f"{c['rect'][0]},{c['rect'][1]}"
            if key in pieces:
                pieces[key] = hide_hair_above(pieces[key], c["rect"], sheet, regions)
    write(kid, item, pieces, meta)
    if borrowed:
        print(f"{borrowed} frames with no painting borrowed the item from a matching frame")
    for n in notes:
        print(n)
    print(f"{len(odd)} frames far from the item's usual size")
    redo = sorted({int(o[5:7]) for o in odd})
    if redo:
        print("their grids (check them; redo with a finished grid as a second reference):", ",".join(f"{g:02d}" for g in redo))


def hide_hair_above(p, rect, sheet, regions):
    """A hat hides the frame's own hair above its bottom edge that it doesn't cover, and the outline round
    that hair (after borrowing, the piece came from another frame and its mask from that frame's hair)."""
    sx, sy, sw, sh = rect
    ph, pw = p["rgba"].shape[:2]
    # the piece and the frame on one canvas, the frame's corner at (fx, fy)
    left, top = min(0, p["dx"]), min(0, p["dy"])
    W, H = max(sw, p["dx"] + pw) - left, max(sh, p["dy"] + ph) - top
    fx, fy, px, py = -left, -top, p["dx"] - left, p["dy"] - top
    rgba = np.zeros((H, W, 4), np.uint8)
    part = np.zeros((H, W, 4), np.uint8)
    part[..., 3] = 255
    rgba[py:py + ph, px:px + pw] = p["rgba"]
    part[py:py + ph, px:px + pw] = p["part"]
    body = np.zeros((H, W), bool)
    body[fy:fy + sh, fx:fx + sw] = sheet[sy:sy + sh, sx:sx + sw, 3] > 0
    reg = np.full((H, W), 255, np.uint8)
    reg[fy:fy + sh, fx:fx + sw] = regions[sy:sy + sh, sx:sx + sw]
    hat = (part[..., 0] > 0)
    if not hat.any():
        return p
    rows = np.nonzero(hat.any(1))[0]
    above = np.zeros((H, W), bool)
    above[:rows.max() - max(2, (rows.max() - rows.min()) // 5)] = True
    keep = rgba[..., 3] > 0
    hair = body & (reg == HAIR) & above & ~keep
    ring = ndimage.binary_dilation(hair, iterations=4) & body & (reg == 0) & above & ~keep
    part[hair | ring, 1] = 255
    m = keep | (part[..., 1] > 0)
    ys, xs = np.nonzero(m)
    t, b, l, r = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return {"rgba": rgba[t:b, l:r], "part": part[t:b, l:r], "dx": int(l) + left, "dy": int(t) + top}


def borrow(layout, pieces, sheet, reach=14):
    """Frames Flow didn't paint take the item from the frame facing the same way whose body, where the
    item sits, matches best (lined up by shifting a few pixels): a standing frame borrows from the first
    frame of the turn, which is the same pose."""
    def body(rect):
        x, y, w, h = rect
        return sheet[y:y + h, x:x + w].astype(float)

    have = [c for c in layout if f"{c['rect'][0]},{c['rect'][1]}" in pieces]
    n = 0
    for c in layout:
        key = f"{c['rect'][0]},{c['rect'][1]}"
        if key in pieces:
            continue
        tgt = body(c["rect"])
        th, tw = tgt.shape[:2]
        best = None
        for d in have:
            if facing(d["anim"]) != facing(c["anim"]):
                continue
            p = pieces[f"{d['rect'][0]},{d['rect'][1]}"]
            ph, pw = p["rgba"].shape[:2]
            src = body(d["rect"])
            sh, sw = src.shape[:2]
            # the donor's body where the item is (inside its frame)
            y0, x0 = max(0, p["dy"]), max(0, p["dx"])
            y1, x1 = min(sh, p["dy"] + ph), min(sw, p["dx"] + pw)
            if y1 - y0 < 6 or x1 - x0 < 6:
                continue
            patch = src[y0:y1, x0:x1]
            for oy in range(-reach, reach + 1, 2):
                for ox in range(-reach, reach + 1, 2):
                    ty0, tx0 = y0 + oy, x0 + ox
                    if ty0 < 0 or tx0 < 0 or ty0 + (y1 - y0) > th or tx0 + (x1 - x0) > tw:
                        continue
                    t = tgt[ty0:ty0 + y1 - y0, tx0:tx0 + x1 - x0]
                    a = (patch[..., 3] > 0) | (t[..., 3] > 0)
                    err = float(np.abs(patch[..., :3] - t[..., :3]).sum(-1)[a].mean() + 255 * np.mean((patch[..., 3] > 0) != (t[..., 3] > 0))) if a.any() else 1e9
                    if best is None or err < best[0]:
                        best = (err, p, oy, ox)
        if best and best[0] < 90:
            _, p, oy, ox = best
            pieces[key] = {**p, "dx": p["dx"] + ox, "dy": p["dy"] + oy}
            n += 1
    return n


def cut(c, gen, orig, k1, k2, lum, sheet, regions, meta, over_ball, hides_hair=False):
    """One frame's piece: the item's pixels at the sheet's size, around the frame (pad on every side)."""
    bx, by, bw, bh = c["box"]
    sx, sy, sw, sh = c["rect"]
    s = c["s"]
    pad = int(round(14 * s))  # Flow may draw a hat a little above the frame
    H, W = gen.shape[:2]
    x0, y0, x1, y1 = max(0, bx - pad), max(0, by - pad), min(W, bx + bw + pad), min(H, by + bh + pad)
    # the cell, scaled back to the sheet: (x0 - bx) / s sheet pixels from the frame's corner
    ow, oh = round((x1 - x0) / s), round((y1 - y0) / s)
    dx, dy = round((x0 - bx) / s), round((y0 - by) / s)

    def up(a, mode=Image.BILINEAR):
        return np.asarray(Image.fromarray(a).resize((ow, oh), mode))

    g = gen[y0:y1, x0:x1]
    m1 = up((k1[y0:y1, x0:x1] * 255).astype(np.uint8)) > 128
    m2 = up((k2[y0:y1, x0:x1] * 255).astype(np.uint8)) > 128
    m2 &= ~m1
    if not (m1 | m2).any():
        return None
    # only pieces that touch this frame (not a neighbour's hat reaching into the margin), and no specks
    fx0, fy0 = max(0, -dx), max(0, -dy)
    inframe = np.zeros((oh, ow), bool)
    inframe[fy0:fy0 + sh, fx0:fx0 + sw] = True
    item = m1 | m2
    lab, n = ndimage.label(item)
    if n:
        sizes = ndimage.sum(item, lab, range(1, n + 1))
        touch = ndimage.maximum(inframe, lab, range(1, n + 1))
        item = np.isin(lab, 1 + np.flatnonzero((sizes >= max(6, 0.03 * sizes.max())) & (touch > 0)))
    m1 &= item
    m2 &= item
    if not item.any():
        return None
    rgb = up(g.clip(0, 255).astype(np.uint8), Image.LANCZOS).astype(float)
    y_up = up(lum[y0:y1, x0:x1].clip(0, 255).astype(np.uint8))
    # the body under the piece, at the same place
    body = np.zeros((oh, ow), bool)
    body[fy0:fy0 + sh, fx0:fx0 + sw] = sheet[sy:sy + sh, sx:sx + sw, 3] > 0
    # Flow's own outline round the item: dark pixels next to it that weren't there before
    o = up(orig[y0:y1, x0:x1].clip(0, 255).astype(np.uint8), Image.LANCZOS).astype(float)
    dark = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]) < 70
    changed = np.abs(rgb - o).sum(-1) > 80
    near = ndimage.binary_dilation(m1 | m2, iterations=2)
    outline = near & dark & changed & ~(m1 | m2)
    # off the body, a plain dark edge all round so a hat's brim reads against the court
    edge = ndimage.binary_dilation(m1 | m2, iterations=1) & ~(m1 | m2) & ~body
    outline |= edge
    keep = m1 | m2 | outline
    # what the item hides: body pixels Flow turned to background next to the item, and any hair it took
    # away (buns under a beanie), with the outline that went round that hair
    gone = body & is_green(rgb) & ~keep
    hair = np.zeros((oh, ow), bool)
    hair[fy0:fy0 + sh, fx0:fx0 + sw] = regions[sy:sy + sh, sx:sx + sw] == HAIR
    hide = gone & (ndimage.binary_dilation(m1 | m2, iterations=int(10 / max(s, 0.5))) | hair)
    lone = ndimage.binary_dilation(hide & hair, iterations=3)
    hide |= gone & lone
    if hides_hair:
        # a hat hides all the hair above its bottom edge that it doesn't cover (Buns' buns), whatever
        # Flow drew there, and the outline round that hair
        hat = m1 | m2
        if hat.any():
            rows = np.nonzero(hat.any(1))[0]
            above = np.zeros((oh, ow), bool)
            above[:rows.max() - max(2, (rows.max() - rows.min()) // 5)] = True
            cut_hair = hair & above & ~keep & body
            ring = ndimage.binary_dilation(cut_hair, iterations=4) & body & ~keep & above
            reg0 = np.zeros((oh, ow), bool)
            reg0[fy0:fy0 + sh, fx0:fx0 + sw] = regions[sy:sy + sh, sx:sx + sw] == 0
            hide |= cut_hair | (ring & reg0)
    # behind the held ball (a jersey): none of it where the ball is
    ball = meta.get("balls", {}).get(f"{sx},{sy}")
    if ball and not over_ball:
        yy, xx = np.mgrid[0:oh, 0:ow]
        inside = (xx - fx0 - ball[0]) ** 2 + (yy - fy0 - ball[1]) ** 2 <= (ball[2] - 0.5) ** 2
        keep &= ~inside
        hide &= ~inside
        m1 &= keep
        m2 &= keep
    if not keep.any():
        return None
    # key pixels stored by lightness alone, stretched per key so the shading runs dark to light
    out = np.zeros((oh, ow, 4), np.uint8)
    out[keep, :3] = rgb[keep].clip(0, 255).astype(np.uint8)
    out[keep, 3] = 255
    out[outline] = [28, 20, 26, 255]
    for m in (m1, m2):
        if m.any():
            out[m, :3] = y_up[m][:, None]
    part = np.zeros((oh, ow, 4), np.uint8)
    part[m1, 0] = 1
    part[m2, 0] = 2
    part[hide, 1] = 255
    part[..., 3] = 255
    ys, xs = np.nonzero(keep | hide)
    t, b, l, r = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return {"rgba": out[t:b, l:r], "part": part[t:b, l:r], "dx": dx + int(l), "dy": dy + int(t)}


def write(kid, item, pieces, meta):
    out = f"{ROOT}/assets/characters/gear/{item}"
    os.makedirs(out, exist_ok=True)
    # the key pixels' lightness, stretched over all frames so each key's shading is full range
    W = 1024
    px = py = shelf = 0
    at = {}
    for key, p in pieces.items():
        h, w = p["rgba"].shape[:2]
        if px + w > W:
            px, py, shelf = 0, py + shelf + 1, 0
        at[key] = (px, py)
        px += w + 1
        shelf = max(shelf, h)
    H = py + shelf + 1
    rgba = np.zeros((H, W, 4), np.uint8)
    part = np.zeros((H, W, 4), np.uint8)
    part[..., 3] = 255
    for key, p in pieces.items():
        x, y = at[key]
        h, w = p["rgba"].shape[:2]
        rgba[y:y + h, x:x + w] = p["rgba"]
        part[y:y + h, x:x + w] = p["part"]
    refs = {}
    for k, name in ((1, "gear1"), (2, "gear2")):
        m = part[..., 0] == k
        if not m.any():
            continue
        L = rgba[m, 0].astype(float)
        lo, hi = np.percentile(L, 2), np.percentile(L, 98)
        t = ((L - lo) / max(1, hi - lo)).clip(0, 1)
        kk = 0.35 + 1.0 * t
        base = 150.0
        v = np.where(kk <= 1, base * kk, base + (255 - base) * (kk - 1) * 0.6)
        rgba[m, :3] = v.clip(0, 255).astype(np.uint8)[:, None]
        refs[name] = int(base)
    Image.fromarray(rgba).save(f"{out}/{kid}.webp", lossless=True, method=6)
    Image.fromarray(part).save(f"{out}/{kid}.png", optimize=True)
    frames = {key: [*at[key], *pieces[key]["rgba"].shape[1::-1], pieces[key]["dx"], pieces[key]["dy"]] for key in pieces}
    json.dump({"refs": refs, "frames": frames}, open(f"{out}/{kid}.json", "w"))
    # each layer's version, so a changed one is fetched afresh (players/gear.js)
    h = hashlib.sha1(b"".join(open(f"{out}/{kid}.{e}", "rb").read() for e in ("webp", "png", "json"))).hexdigest()[:8]
    ipath = f"{ROOT}/assets/characters/gear/index.json"
    index = json.load(open(ipath)) if os.path.exists(ipath) else {}
    index.setdefault(item, {})[kid] = h
    json.dump(dict(sorted(index.items())), open(ipath, "w"), indent=1)
    total = len({f"{f[0]},{f[1]}" for fr in meta["frames"].values() for f in fr})
    print(f"{item} on {kid}: {len(pieces)} of {total} frames, sheet {W}x{H}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "grids":
        grids(*sys.argv[2:4])
    elif cmd == "build":
        build(*sys.argv[2:6])
    else:
        sys.exit(__doc__)
