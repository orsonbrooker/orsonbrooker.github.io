"""Hair from key-colour grids: Flow repaints a kid's hair in shaded magenta on grids of their frames
(tools/pixelart/frame_grids.py layout), and this puts that hair back on the full-detail sheet, so the hair
recolours from a mid-tone with real light and shade, whatever colour the video drew it.

Each magenta pixel (hue 35-80 degrees in the Cb/Cr plane, clearly coloured) becomes hair in the region map,
and on the sheet a brown of the same lightness, stretched so the darkest hair is dark and the lightest
light. `meta.art.hair` records that brown, so the game always recolours it (to the kid's own colour by
default). Only pixels that are on the player already change: the outline stays where it was.

  python tools/pixelart/key_hair.py assets/characters/buns-detail <grids dir> <prefix>
  (reads <prefix>-NN-k.img, named by match_grids.py; keeps the version that changed least besides the hair)
"""
import glob
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HAIR = 2
BROWN = np.array([150, 105, 70], float)  # the mid-tone the hair is stored in


def keyed(gen):
    r, g, b = gen[..., 0], gen[..., 1], gen[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb, cr = b - y, r - y
    ang = (np.degrees(np.arctan2(cr, cb)) + 360) % 360
    return (np.hypot(cb, cr) > 22) & (ang > 35) & (ang < 80), y


def main(d, grids_dir, prefix):
    sheet = np.array(Image.open(f"{d}/sprites.webp").convert("RGBA"))
    reg = np.array(Image.open(f"{d}/regions.png").convert("RGBA"))
    layout = json.load(open(f"{grids_dir}/grids.json"))
    meta = json.load(open(f"{d}/sprites.json"))
    lumas, spots = [], []
    for g in sorted({c["grid"] for c in layout}):
        orig = np.asarray(Image.open(f"{grids_dir}/grid-{g:02d}.jpg").convert("RGB")).astype(float)
        best = None
        for f in sorted(glob.glob(f"{prefix}-{g:02d}-*.img")):
            gen = np.asarray(Image.open(f).convert("RGB").resize((orig.shape[1], orig.shape[0]), Image.LANCZOS)).astype(float)
            k, _ = keyed(gen)
            # the version that changed least outside the hair
            spill = int(((np.abs(gen - orig).sum(-1) > 90) & ~k).sum())
            if best is None or spill < best[0]:
                best = (spill, gen)
        if best is None:
            print("grid", g, "has no key images")
            continue
        gen = best[1]
        k, y = keyed(gen)
        for c in (c for c in layout if c["grid"] == g):
            bx, by, bw, bh = c["box"]
            sx, sy, sw, sh = c["rect"]
            # the cell back at the sheet's size
            cell_k = Image.fromarray((k[by:by + bh, bx:bx + bw] * 255).astype(np.uint8)).resize((sw, sh), Image.BILINEAR)
            cell_y = Image.fromarray(y[by:by + bh, bx:bx + bw].clip(0, 255).astype(np.uint8)).resize((sw, sh), Image.BILINEAR)
            on = sheet[sy:sy + sh, sx:sx + sw, 3] > 0
            m = (np.asarray(cell_k) > 140) & on
            # highlights and specks the key colour missed, inside the hair: hair too (not skin, jersey...)
            prev = reg[sy:sy + sh, sx:sx + sw, 0]
            inner = ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=3))
            m |= inner & on & ((prev == 0) | (prev == HAIR))
            # holes right inside the hair are hair, whatever the video build called them (a light curl it took
            # for skin)
            m |= ndimage.binary_fill_holes(m) & on & (prev != 3) & (prev != 4)
            # where the key skipped a patch, what the video build already took for hair, next to it; and where
            # it barely painted the hair at all, all of that
            prev_hair = on & (prev == HAIR)
            if m.sum() < 0.6 * prev_hair.sum():
                m |= prev_hair
            m |= prev_hair & ndimage.binary_dilation(m, iterations=10)
            spots.append((sy, sx, m))
            lumas.append(np.asarray(cell_y)[m].astype(float))
    allL = np.concatenate([l for l in lumas if len(l)])
    lo, hi = np.percentile(allL, 2), np.percentile(allL, 98)
    # a frame Flow left unpainted (or nearly): its hair found by colour instead, against the hair and skin
    # colours of the frames it did paint, above the jersey; lightness from the frame itself
    sizes = np.array([m.sum() for _, _, m in spots])
    usual = np.median(sizes[sizes > 0])
    rgb_of = lambda sy, sx, m: sheet[sy:sy + m.shape[0], sx:sx + m.shape[1], :3][m].astype(float)
    good = [i for i, s in enumerate(sizes) if s >= 0.6 * usual][:: max(1, len(sizes) // 40)]
    hair_cols = np.unique(np.concatenate([rgb_of(*spots[i]) for i in good]) // 8, axis=0) * 8 + 4
    skin_cols = np.unique(sheet[..., :3][(reg[..., 0] == 1) & (sheet[..., 3] > 0)][::50] // 8, axis=0) * 8 + 4

    def nearest(px, cols):
        best = np.full(len(px), 1e9)
        for i in range(0, len(cols), 256):
            best = np.minimum(best, ((px[:, None, :] - cols[None, i:i + 256, :]) ** 2).sum(2).min(1))
        return best

    redone = 0
    for i, (sy, sx, m) in enumerate(spots):
        if sizes[i] >= 0.35 * usual:
            continue
        h, w = m.shape
        sub, rg = sheet[sy:sy + h, sx:sx + w], reg[sy:sy + h, sx:sx + w, 0]
        per_row = (rg == 3).sum(1)
        rows = np.where(per_row >= 0.3 * per_row.max())[0] if per_row.max() else per_row[:0]
        top = rows[0] if len(rows) else h // 2
        cand = (sub[..., 3] > 0) & np.isin(rg, [0, 1, HAIR])
        cand[top:] = False
        ys, xs = np.where(cand)
        px = sub[ys, xs, :3].astype(float)
        lum = 0.299 * px[:, 0] + 0.587 * px[:, 1] + 0.114 * px[:, 2]
        hairish = (nearest(px, hair_cols) < nearest(px, skin_cols)) & (lum > 25)
        mm = np.zeros_like(m)
        mm[ys[hairish], xs[hairish]] = True
        mm = ndimage.binary_closing(mm, iterations=2) & cand
        lab, n = ndimage.label(mm)
        if n:
            mm = lab == int(np.argmax(ndimage.sum(mm, lab, range(1, n + 1)))) + 1
            mm = ndimage.binary_fill_holes(mm) & cand
        if mm.sum() > m.sum():
            L = 0.299 * sub[..., 0] + 0.587 * sub[..., 1] + 0.114 * sub[..., 2]
            Lm = L[mm].astype(float)
            a0, a1 = np.percentile(Lm, 2), np.percentile(Lm, 98)
            spots[i] = (sy, sx, mm)
            lumas[i] = lo + (Lm - a0) / max(1, a1 - a0) * (hi - lo)
            redone += 1
    if redone:
        print(f"{redone} frames Flow missed: hair found by colour")
    # the keyed hair is the hair now: whatever was guessed before goes back to outline
    reg[reg[..., 0] == HAIR, 0] = 0
    n = 0
    for (sy, sx, m), L in zip(spots, lumas):
        if not m.any():
            continue
        t = ((L - lo) / max(1, hi - lo)).clip(0, 1)  # 0 darkest .. 1 lightest
        k = 0.35 + 1.0 * t  # times the mid-tone: deep shadow to bright highlight
        rgb = np.where(k[:, None] <= 1, BROWN[None] * k[:, None], BROWN[None] + (255 - BROWN[None]) * (k[:, None] - 1) * 0.6)
        h, w = m.shape
        sub = sheet[sy:sy + h, sx:sx + w]
        sub[m, :3] = rgb.clip(0, 255).astype(np.uint8)
        reg[sy:sy + h, sx:sx + w][m, 0] = HAIR
        n += int(m.sum())
    meta.setdefault("art", {})["hair"] = "#%02x%02x%02x" % tuple(int(v) for v in BROWN)
    meta["regions"]["hair"] = [int(v) for v in BROWN]
    Image.fromarray(sheet).save(f"{d}/sprites.webp", quality=90, method=6)
    Image.fromarray(reg).save(f"{d}/regions.png")
    json.dump(meta, open(f"{d}/sprites.json", "w"))
    print(f"{n} hair pixels from {len(spots)} frames; lightness {lo:.0f}-{hi:.0f}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
