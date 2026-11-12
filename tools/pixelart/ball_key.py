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


def orange_ball(orange, r, least=0.35):
    """Centre of the disc of radius r that holds the most of the frame's own orange ball, or None when
    there's too little orange to tell. The disc may reach past the frame's edge (a ball held out at the
    side is cut off by the frame)."""
    if orange.sum() < 0.15 * np.pi * r * r:
        return None
    k = int(np.ceil(r))
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    disc = ((yy ** 2 + xx ** 2) <= r * r).astype(float)
    fill = ndimage.convolve(np.pad(orange.astype(float), k), disc, mode="constant")
    best = fill.max()
    if best < least * disc.sum():  # too little of a ball there to be one
        return None
    ys, xs = np.where(fill >= best - 0.5)  # a flat top: its middle
    return float(xs.mean() - k), float(ys.mean() - k)


def colour_bins(px):
    """Each pixel's bin in a coarse RGB grid (16 levels a channel)."""
    px = px.astype(int) >> 4
    return px[..., 0] * 256 + px[..., 1] * 16 + px[..., 2]


def ball_colours(samples_ball, samples_skin):
    """Which colour bins are this kid's ball rather than their skin: learnt from the pixels under Flow's
    magenta balls and from skin away from any ball, so a ball in shadow (as brown as a light skin) and a
    warm skin (as orange as a ball) are both told apart."""
    hb = np.bincount(np.concatenate(samples_ball), minlength=4096).astype(float)
    hs = np.bincount(np.concatenate(samples_skin), minlength=4096).astype(float)
    pb, ps = hb / max(1, hb.sum()), hs / max(1, hs.sum())
    return (hb >= 3) & (pb > 3 * ps)


def own_orange(sub, rsub, ballish):
    """The frame's own ball: pixels in the kid's ball colours, in the fixed colours or filed as skin (a
    ball before tidy_regions.py often is)."""
    return (sub[..., 3] > 0) & ballish[colour_bins(sub[..., :3])] & np.isin(rsub[..., 0], [0, 1])


def cut_ball(sub, rsub, balls, key, cx, cy, r, mm, orange, odd):
    """Cuts the ball (mm, and the frame's own orange, inside the circle) out of the frame, records it in
    balls and returns how many pixels went."""
    sh, sw = sub.shape[:2]
    yy, xx = np.mgrid[:sh, :sw]
    inside = (yy - cy) ** 2 + (xx - cx) ** 2 <= (r * 1.08) ** 2
    out = (mm | orange) & inside
    near = (yy - cy) ** 2 + (xx - cx) ** 2 <= (r * 2.5) ** 2
    if (orange & near & ~out).sum() > 0.15 * np.pi * r * r:
        odd.append(key)
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
    balls[key] = [round(float(cx), 1), round(float(cy), 1), round(float(r), 1)]
    n = int((out & (sub[..., 3] > 0)).sum())
    sub[out, 3] = 0
    rsub[out] = 0
    return n


def main(d, grids_dir, prefix):
    sheet = np.array(Image.open(f"{d}/sprites.webp").convert("RGBA"))
    reg = np.array(Image.open(f"{d}/regions.png").convert("RGBA"))
    layout = json.load(open(f"{grids_dir}/grids.json"))
    meta = json.load(open(f"{d}/sprites.json"))
    balls, cut, found, moved, odd, filled = {}, 0, [], [], [], []
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
    frames = meta["frames"]
    masks, samples_ball, samples_skin = [], [], []
    for sx, sy, sw, sh, cx, cy, r, m in found:
        mm = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((sw, sh), Image.BILINEAR)) > 100
        sub, rsub = sheet[sy:sy + sh, sx:sx + sw], reg[sy:sy + sh, sx:sx + sw]
        on = (sub[..., 3] > 0) & np.isin(rsub[..., 0], [0, 1])
        samples_ball.append(colour_bins(sub[ndimage.binary_erosion(mm, iterations=2) & on][:, :3]))
        samples_skin.append(colour_bins(sub[(rsub[..., 0] == 1) & (sub[..., 3] > 0) & ~ndimage.binary_dilation(mm, iterations=8)][:, :3]))
        masks.append(ndimage.binary_dilation(mm, iterations=3))  # the magenta, grown a little for the ball's outline
    ballish = ball_colours(samples_ball, samples_skin)
    for (sx, sy, sw, sh, cx, cy, r, m), mm in zip(found, masks):
        if not 0.85 * usual <= r <= 1.15 * usual:
            r = usual
        sub, rsub = sheet[sy:sy + sh, sx:sx + sw], reg[sy:sy + sh, sx:sx + sw]
        yy, xx = np.mgrid[:sh, :sw]
        # Flow sometimes moves the ball a little when it repaints it. The frame's own ball is where its orange
        # is: the disc of the ball's size holding the most orange, near the magenta one. When the two differ,
        # the magenta (with any fingers in front of it) is moved onto the frame's own ball, so the hole is cut
        # where the old ball is and no old ball is left beside the game's
        orange = own_orange(sub, rsub, ballish)
        near = (yy - cy) ** 2 + (xx - cx) ** 2 <= (r * 2.5) ** 2
        own = orange_ball(orange & near, r) or orange_ball(orange & near, r, 0.2)  # (legs or hands in front)
        if own and 0.2 * r < np.hypot(own[0] - cx, own[1] - cy) < 1.5 * r:
            dx, dy = int(round(own[0] - cx)), int(round(own[1] - cy))
            mm = np.roll(np.roll(mm, dy, 0), dx, 1)
            cx, cy = own
            moved.append(f"{sx},{sy}")
        cut += cut_ball(sub, rsub, balls, f"{sx},{sy}", cx, cy, r, mm, orange, odd)
    # within a move every frame holding a ball is cut the same way, or the ball would flicker between the
    # drawn one and the game's: a frame Flow left without magenta (a ball half behind the hands, say) has
    # its ball found from its own orange
    # (only beside a frame of the move that holds its ball, and near where that one is, from the feet: a
    # frame after the ball has left the hands stays as it is)
    for anim, fr in frames.items():
        keys = [f"{f[0]},{f[1]}" for f in fr]
        if not any(k in balls for k in keys):
            continue
        for i, (f, k) in enumerate(zip(fr, keys)):
            if k in balls:
                continue
            near_balls = [(fr[j], balls[keys[j]]) for j in (i - 1, i + 1) if 0 <= j < len(fr) and keys[j] in balls]
            if not near_balls:
                continue
            sx, sy, sw, sh = f[:4]
            sub, rsub = sheet[sy:sy + sh, sx:sx + sw], reg[sy:sy + sh, sx:sx + sw]
            orange = own_orange(sub, rsub, ballish)
            own = orange_ball(orange, usual, 0.2)  # beside a neighbour's ball, less of it need show
            # the neighbour's ball, in this frame: frames are placed by their feet (f[4], f[5])
            if not own or min(np.hypot(own[0] + f[4] - (b[0] + g[4]), own[1] + f[5] - (b[1] + g[5])) for g, b in near_balls) > 2 * usual:
                continue
            yy, xx = np.mgrid[:sh, :sw]
            # no magenta to say where fingers cross it: the ball's own colours inside it go (fingers are
            # skin, and their outline is kept where it touches skin)
            disc = (yy - own[1]) ** 2 + (xx - own[0]) ** 2 <= (usual * 0.9) ** 2
            by_skin = ndimage.binary_dilation(rsub[..., 0] == 1, iterations=2)
            mm = orange | (disc & (rsub[..., 0] == 0) & ~by_skin)
            filled.append(k)
            cut += cut_ball(sub, rsub, balls, k, own[0], own[1], usual, mm, orange, odd)
    meta["balls"] = balls
    Image.fromarray(sheet).save(f"{d}/sprites.webp", quality=90, method=6)
    Image.fromarray(reg).save(f"{d}/regions.png")
    json.dump(meta, open(f"{d}/sprites.json", "w"))
    print(f"balls in {len(balls)} frames (usual radius {usual:.1f} px), {cut} ball pixels cut out; "
          f"{len(moved)} moved back onto the frame's own ball (Flow had moved it), {len(filled)} found from their own "
          f"orange (Flow left them unpainted)")
    print("look at: moved", " ".join(moved), "| found", " ".join(filled))
    if odd:
        print(f"{len(odd)} frames still have their own orange beside the cut, look at them:", " ".join(odd))


if __name__ == "__main__":
    main(*sys.argv[1:4])
