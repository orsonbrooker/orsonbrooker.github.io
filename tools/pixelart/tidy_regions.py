"""Tidies a full-detail sheet's region map (which part each pixel recolours with) after video_body.py, so a
new skin or hair colour changes cleanly:

- skin's soft edges: pixels left as outline (or filed as hair) beside skin, coloured like skin, become skin,
  so a new skin colour has no light rim from the old one (the ball and dark outlines stay as they are)
- black hair: near-black pixels inside a head of hair (kept as outline, since outlines are black too)
  become hair, spreading out from the hair, but not the ball's seams, an eye, a brow or the player's edge
- nothing below the top of the jersey is hair (dark greys on arms, legs and shoes)

  python tools/pixelart/tidy_regions.py assets/characters/buns-detail
"""
import json
import sys

import numpy as np
from scipy import ndimage
from PIL import Image

SKIN, HAIR, JERSEY = 1, 2, 3
R = 4  # how far round each pixel to look for the hair, in sheet pixels


def box(mask, r):
    c = np.pad(mask.astype(np.int32), r).cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    n = 2 * r + 1
    return c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]


def skin_edges(img, part, on):
    """Outline or hair pixels touching skin whose colour is close to some skin colour on the sheet."""
    rgb = img[..., :3]
    skin = on & (part == SKIN)
    # the skin's colours, coarsely (so the nearest one is quick to find)
    q = np.unique(rgb[skin] // 8, axis=0) * 8 + 4
    cand = on & ((part == 0) | (part == HAIR)) & (box(skin, 1) >= 3)
    ys, xs = np.where(cand)
    px = rgb[ys, xs]
    best = np.full(len(px), 1e9)
    for i in range(0, len(q), 256):
        dd = ((px[:, None, :] - q[None, i:i + 256, :]) ** 2).sum(2).min(1)
        best = np.minimum(best, dd)
    luma = 0.299 * px[:, 0] + 0.587 * px[:, 1] + 0.114 * px[:, 2]
    ok = (best < 18 ** 2) & (luma > 45)
    out = np.zeros_like(cand)
    out[ys[ok], xs[ok]] = True
    return out


def skin_shadows(img, part, on):
    """Dark (not black) outline pixels in the middle of skin: shading, not outline."""
    luma = 0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]
    skin = on & (part == SKIN)
    return on & (part == 0) & (luma >= 22) & (box(skin, 2) >= 15) & ~(box(~on, 1) > 0)


def ball_not_skin(img, part, on):
    """The ball's bright orange, where it touches a hand, filed as skin: back to the ball's own colours."""
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    orange = (r == mx) & (r > 110) & ((mx - mn) > 0.6 * mx) & (g > b)
    ball = on & (part == 0) & orange
    return on & (part == SKIN) & orange & (box(ball, 3) >= 6)


def nearest(px, cols):
    """Each pixel's squared distance to the nearest of `cols`."""
    best = np.full(len(px), 1e9)
    for i in range(0, len(cols), 256):
        best = np.minimum(best, ((px[:, None, :] - cols[None, i:i + 256, :]) ** 2).sum(2).min(1))
    return best


def ball_in_frame(cell_img, cell):
    """The ball's darker shades look like skin and get filed as skin: inside the ball's circle (found from
    its bright orange), a skin pixel closer to the ball's colours than to the skin's goes back to the
    ball, and so does any patch of skin there that doesn't join the arm. Changes `cell` in place; returns
    how many."""
    r, g, b = cell_img[..., 0], cell_img[..., 1], cell_img[..., 2]
    on = cell_img[..., 3] > 0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    # the ball's own bright orange (filed as the ball, not skin, so a warm cheek isn't taken for it)
    orange = on & (cell == 0) & (r == mx) & (r > 110) & ((mx - mn) > 0.6 * mx) & (g > b)
    lab, n = ndimage.label(ndimage.binary_closing(orange, iterations=2))
    if not n:
        return 0
    sizes = ndimage.sum(orange, lab, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    if sizes[k - 1] < 150:
        return 0
    ys, xs = np.where(lab == k)
    bh, bw = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1
    if not 0.6 < bh / bw < 1.6:  # round, like a ball
        return 0
    cy, cx = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2
    rad = max(ys.max() - ys.min(), xs.max() - xs.min()) / 2 * 1.08
    yy, xx = np.mgrid[: cell.shape[0], : cell.shape[1]]
    inside = (yy - cy) ** 2 + (xx - cx) ** 2 <= rad ** 2
    skin = on & (cell == SKIN)
    cand = skin & inside
    if not cand.any() or not (skin & ~inside).any():
        return 0
    rgb = cell_img[..., :3]
    ball_cols = np.unique(rgb[on & inside & (cell == 0) & ~orange | orange] // 6, axis=0) * 6 + 3
    skin_cols = np.unique(rgb[skin & ~inside] // 6, axis=0) * 6 + 3
    px = rgb[cand]
    back = nearest(px, ball_cols) < nearest(px, skin_cols)
    cy_, cx_ = np.where(cand)
    out = np.zeros_like(cand)
    out[cy_[back], cx_[back]] = True
    # patches of skin inside the ball that don't reach the skin outside it (a hand on the ball does)
    slab, sn = ndimage.label(skin & ~out)
    if sn:
        reach = np.zeros(sn + 1, bool)
        reach[np.unique(slab[skin & ~inside])] = True
        out |= cand & ~reach[slab]
    cell[out] = 0
    return int(out.sum())


def dark_hair(img, part, on):
    luma = 0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]
    dark = on & (part == 0) & (luma < 60)
    hair = on & (part == HAIR)
    others = on & (part != 0) & (part != HAIR)
    can = dark & ~(box(others, R) > 0) & ~(box(~on, 1) > 0) & (box(hair | dark, R) >= 0.85 * box(on, R))
    # spreads out from the hair a few pixels at a time, so big all-black patches fill in too
    turn = np.zeros_like(can)
    for _ in range(40):
        grow = can & ~turn & (box(hair | turn, 2) > 0)
        if not grow.any():
            break
        turn |= grow
    return turn


def main(d):
    img = np.asarray(Image.open(f"{d}/sprites.webp").convert("RGBA")).astype(np.int32)
    reg = np.array(Image.open(f"{d}/regions.png").convert("RGBA"))
    on = img[..., 3] > 0
    part = reg[..., 0]
    edges = skin_edges(img, part, on)
    reg[edges, 0] = SKIN
    shadows = skin_shadows(img, reg[..., 0], on)
    reg[shadows, 0] = SKIN
    ball = ball_not_skin(img, reg[..., 0], on)
    reg[ball, 0] = 0
    hair = dark_hair(img, reg[..., 0], on)
    reg[hair, 0] = HAIR
    meta = json.load(open(f"{d}/sprites.json"))
    low_hair = 0
    in_ball = 0
    for x, y, w, h, *_ in {tuple(f) for fs in meta["frames"].values() for f in fs}:
        cell = reg[y:y + h, x:x + w, 0]
        in_ball += ball_in_frame(img[y:y + h, x:x + w], cell)
        rows = np.where((cell == JERSEY).any(1))[0]
        if not len(rows):
            continue
        low = cell[rows[0] + 3:] == HAIR
        low_hair += int(low.sum())
        cell[rows[0] + 3:][low] = 0
    Image.fromarray(reg).save(f"{d}/regions.png")
    print(f"skin edges {int(edges.sum())}, skin shadows {int(shadows.sum())}, ball back from skin {int(ball.sum()) + in_ball}, black hair {int(hair.sum())}, hair below the jersey's top {low_hair}")


if __name__ == "__main__":
    main(sys.argv[1])
