"""The held ball as its own sprite: Flow repaints the ball in shaded magenta on grids of a kid's frames
(the same grids as key_hair.py). For each frame this fits a circle to the magenta ball, records it in the
sheet's description as `balls: {"x,y": [cx, cy, r]}` (in the frame's own pixels, keyed by where the frame
sits on the sheet), and cuts the ball out of the body: the game draws its own ball there first, then the
body, so fingers in front of the ball stay in front. Frames with no ball are left alone.

  python tools/pixelart/ball_key.py assets/characters/buns-detail <grids dir> <prefix>
  (reads <prefix>-NN-k.img, named by match_grids.py; keeps the version with the roundest balls)
"""
import glob
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def magenta(gen):
    r, g, b = gen[..., 0], gen[..., 1], gen[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb, cr = b - y, r - y
    ang = (np.degrees(np.arctan2(cr, cb)) + 360) % 360
    return (np.hypot(cb, cr) > 22) & (ang > 35) & (ang < 80)


def fit_circle(mask):
    """Centre and radius from the mask's edge (a least-squares circle), so a ball partly behind a hand or a
    leg still gives its full size."""
    edge = mask & ~ndimage.binary_erosion(mask)
    ys, xs = np.where(edge)
    if len(xs) < 12:
        return None
    A = np.c_[2 * xs, 2 * ys, np.ones(len(xs))]
    bvec = xs ** 2 + ys ** 2
    (cx, cy, c), *_ = np.linalg.lstsq(A, bvec, rcond=None)
    r = np.sqrt(max(1e-6, c + cx ** 2 + cy ** 2))
    # never smaller than the visible ball, never wildly bigger
    hw = max(xs.max() - xs.min(), ys.max() - ys.min()) / 2 + 1
    return cx, cy, float(np.clip(r, hw * 0.95, hw * 1.35))


def main(d, grids_dir, prefix):
    sheet = np.array(Image.open(f"{d}/sprites.webp").convert("RGBA"))
    reg = np.array(Image.open(f"{d}/regions.png").convert("RGBA"))
    layout = json.load(open(f"{grids_dir}/grids.json"))
    meta = json.load(open(f"{d}/sprites.json"))
    balls, cut, found = {}, 0, []
    for g in sorted({c["grid"] for c in layout}):
        files = sorted(glob.glob(f"{prefix}-{g:02d}-*.img"))
        if not files:
            print("grid", g, "has no key images"); continue
        cells = [c for c in layout if c["grid"] == g]
        best = None
        for f in files:
            gen = np.asarray(Image.open(f).convert("RGB").resize((1376, 768), Image.LANCZOS)).astype(float)
            k = ndimage.binary_opening(magenta(gen), iterations=1)
            # the version whose balls are roundest (least magenta outside each cell's best circle)
            score = 0
            for c in cells:
                bx, by, bw, bh = c["box"]
                m = k[by:by + bh, bx:bx + bw]
                if m.sum() > 20:
                    lab, n = ndimage.label(m)
                    score += int(m.sum() - ndimage.sum(m, lab, range(1, n + 1)).max())
            if best is None or score < best[0]:
                best = (score, k)
        k = best[1]
        for c in cells:
            bx, by, bw, bh = c["box"]
            sx, sy, sw, sh = c["rect"]
            m = k[by:by + bh, bx:bx + bw]
            if m.sum() < 25:
                continue
            lab, n = ndimage.label(m)
            m = lab == (int(np.argmax(ndimage.sum(m, lab, range(1, n + 1)))) + 1)  # the ball, not specks
            fit = fit_circle(m)
            if not fit:
                continue
            s = c["s"]  # sheet px -> grid px
            # cells are centred: the cell's box is the frame scaled by s
            found.append((sx, sy, sw, sh, fit[0] / s, fit[1] / s, fit[2] / s, m))
    # every ball is the same ball: a fit far from the usual size (partly hidden, or a stray) takes it
    usual = float(np.median([f[6] for f in found]))
    for sx, sy, sw, sh, cx, cy, r, m in found:
        if not 0.85 * usual <= r <= 1.15 * usual:
            r = usual
        # cut out: the magenta (grown a little, for the ball's outline) inside the circle
        mm = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((sw, sh), Image.BILINEAR)) > 100
        mm = ndimage.binary_dilation(mm, iterations=3)
        yy, xx = np.mgrid[:sh, :sw]
        inside = (yy - cy) ** 2 + (xx - cx) ** 2 <= (r * 1.08) ** 2
        out = mm & inside
        sub = sheet[sy:sy + sh, sx:sx + sw]
        # the ball recorded is the hole's own: a circle through the hole's edge where the old ball's dark
        # outline is left round it (not where a hand is in front), reaching into that outline, so the game's
        # ball fills the hole and the outline hugs it
        hole = out | ((sub[..., 3] == 0) & inside)
        edge = hole & ~ndimage.binary_erosion(hole)
        lum = 0.299 * sub[..., 0] + 0.587 * sub[..., 1] + 0.114 * sub[..., 2]
        dark_out = ndimage.binary_dilation((sub[..., 3] > 0) & ~hole & (lum < 90), iterations=1)
        pts = edge & dark_out
        if pts.sum() >= 12:
            ys, xs = np.where(pts)
            A = np.c_[2 * xs, 2 * ys, np.ones(len(xs))]
            (fx, fy, c), *_ = np.linalg.lstsq(A, xs ** 2 + ys ** 2, rcond=None)
            fr = np.sqrt(max(1e-6, c + fx ** 2 + fy ** 2))
            if np.hypot(fx - cx, fy - cy) < 0.3 * r and 0.9 * r <= fr <= 1.35 * r:
                cx, cy, r = float(fx), float(fy), float(fr) + 1.0
        balls[f"{sx},{sy}"] = [round(cx, 1), round(cy, 1), round(r, 1)]
        cut += int((out & (sub[..., 3] > 0)).sum())
        sub[out, 3] = 0
        reg[sy:sy + sh, sx:sx + sw][out] = 0
    meta["balls"] = balls
    Image.fromarray(sheet).save(f"{d}/sprites.webp", quality=90, method=6)
    Image.fromarray(reg).save(f"{d}/regions.png")
    json.dump(meta, open(f"{d}/sprites.json", "w"))
    rs = [b[2] for b in balls.values()]
    print(f"balls in {len(balls)} frames (usual radius {usual:.1f} px), {cut} ball pixels cut out")


if __name__ == "__main__":
    main(*sys.argv[1:4])
