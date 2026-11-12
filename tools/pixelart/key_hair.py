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
            # and where the key skipped a patch, what the video build already took for hair, next to it
            m |= on & (prev == HAIR) & ndimage.binary_dilation(m, iterations=10)
            spots.append((sy, sx, m))
            lumas.append(np.asarray(cell_y)[m].astype(float))
    # the keyed hair is the hair now: whatever was guessed before goes back to outline
    reg[reg[..., 0] == HAIR, 0] = 0
    allL = np.concatenate([l for l in lumas if len(l)])
    lo, hi = np.percentile(allL, 2), np.percentile(allL, 98)
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
