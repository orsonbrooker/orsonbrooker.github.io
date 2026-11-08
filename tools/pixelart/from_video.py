"""Turn a pixel-art-style video into real pixel-art frames, by reading the video's own art pixels.

The video draws each art pixel as a block of about P x P screen pixels (P is about 5.3 for 1280x720).
For every frame we find where the block grid sits (it can drift a little in AI video), take the
middle of each block, drop the flat background, and snap every colour to one palette shared by all
frames so colours don't flicker.

  uv run --with pillow --with numpy python tools/pixelart/from_video.py VIDEO OUTDIR [--every N] [--period P]

Writes OUTDIR/fNNN.png (one per kept frame, transparent, 1 px per art pixel, all on the same
canvas so they line up) and OUTDIR/strip.png (a 4x preview).
"""
import argparse
import os
import subprocess
import tempfile

import numpy as np
from PIL import Image


def frames(video, every):
    tmp = tempfile.mkdtemp()
    subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", f"select=not(mod(n\\,{every}))", "-fps_mode", "passthrough", f"{tmp}/%04d.png"], check=True)
    return [np.asarray(Image.open(f"{tmp}/{n}").convert("RGB")) for n in sorted(os.listdir(tmp))]


def phase(e, p):
    """Where block edges fall, as an offset in [0, p): circular mean of edge strength."""
    n = np.arange(len(e)) + 1.0  # edge between pixel i and i+1 sits at i+1
    z = (e * np.exp(2j * np.pi * n / p)).sum()
    return (np.angle(z) / (2 * np.pi) * p) % p


def greenish(col):
    """Green screen and the boy's shadow on it: green clearly above red and blue. Nothing he wears is green."""
    col = np.asarray(col, int)
    return (col[..., 1] > col[..., 0] + 20) & (col[..., 1] > col[..., 2] + 8)


def sample(a, bg, p, green=False, with_grid=False):
    diff = np.abs(a.astype(int) - bg).sum(2)
    m = ~greenish(a) if green else diff > 40
    ys, xs = np.where(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    c = a[y0:y1, x0:x1].astype(float)
    ex = np.abs(np.diff(c, axis=1)).sum((0, 2))
    ey = np.abs(np.diff(c, axis=0)).sum((1, 2))
    px = (phase(ex, p) + x0) % p
    py = (phase(ey, p) + y0) % p
    # cell (i, j) covers [px + i*p, px + (i+1)*p); sample its inner part
    H, W = a.shape[:2]
    ni, nj = int((H - py) // p), int((W - px) // p)
    out = np.zeros((ni, nj, 4), np.uint8)
    near = np.ones((ni, nj), bool)  # floor-coloured (or not looked at)
    r = max(1, int(p * 0.2))
    for i in range(int((y0 - py) // p) - 1, int((y1 - py) // p) + 2):
        cy = int(round(py + (i + 0.5) * p))
        if not (r <= cy < H - r) or not (0 <= i < ni):
            continue
        for j in range(int((x0 - px) // p) - 1, int((x1 - px) // p) + 2):
            cx = int(round(px + (j + 0.5) * p))
            if not (r <= cx < W - r) or not (0 <= j < nj):
                continue
            block = a[cy - r:cy + r + 1, cx - r:cx + r + 1].reshape(-1, 3)
            col = np.median(block, axis=0)
            out[i, j, :3] = col
            out[i, j, 3] = 255
            near[i, j] = np.abs(col - bg).sum() <= 40
    # Background is floor colour joined to the outside. Light greys inside his outline (socks,
    # soles) are close to the floor colour too, so they only go if they really are the floor.
    tight = np.abs(out[..., :3].astype(int) - bg).sum(2) <= 14
    if green:  # on a green screen, every green cell goes (shadow, gaps between arm and body)
        near = greenish(out[..., :3])
        tight = near
    gone = np.zeros_like(near)
    stack = [(i, j) for i, j in zip(*np.where(near)) if out[i, j, 3] == 0]
    for i, j in stack:
        gone[i, j] = True
    while stack:
        i, j = stack.pop()
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            y, x = i + di, j + dj
            if 0 <= y < ni and 0 <= x < nj and near[y, x] and not gone[y, x]:
                gone[y, x] = True
                stack.append((y, x))
    out[gone | (tight & near), 3] = 0
    return (out, px, py) if with_grid else out  # with_grid: also where cell (0, 0) starts in the video


def kmeans(x, k, iters=20, seed=0):
    rng = np.random.default_rng(seed)
    c = x[rng.choice(len(x), k, replace=False)]
    for _ in range(iters):
        lab = ((x[:, None] - c[None]) ** 2).sum(2).argmin(1)
        for t in range(k):
            if (lab == t).any():
                c[t] = x[lab == t].mean(0)
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--every", type=int, default=2)
    ap.add_argument("--period", type=float, default=5.35)
    ap.add_argument("--colours", type=int, default=40)
    ap.add_argument("--drop-shadow", action="store_true", default=True)
    a = ap.parse_args()
    fs = frames(a.video, a.every)
    bg = np.median(fs[0].reshape(-1, 3), axis=0)
    cells = [sample(f, bg, a.period) for f in fs]
    h = min(c.shape[0] for c in cells)
    w = min(c.shape[1] for c in cells)
    cells = [c[:h, :w] for c in cells]
    # the floor shadow (the game draws its own): plain greys between the outline and the floor,
    # near the floor line. Shoes and outlines are darker or bluer, so they stay.
    if a.drop_shadow:
        def greys(c):
            col = c[..., :3].astype(int)
            return (c[..., 3] > 0) & (col.max(2) - col.min(2) <= 16) & (col.mean(2) >= 70) & (col.mean(2) <= 165)

        rows = sum(greys(c).sum(1) for c in cells)
        floor = int(np.argmax(rows))  # the shadow's middle row: where most of these greys are
        for c in cells:
            g = greys(c)
            g[: floor - 10] = False
            g[floor + 10:] = False
            c[g, 3] = 0
    # one palette for all frames
    px = np.concatenate([c[c[..., 3] > 0][:, :3] for c in cells]).astype(float)
    rng = np.random.default_rng(1)
    pal = kmeans(px[rng.choice(len(px), min(len(px), 40000), replace=False)], a.colours)
    for c in cells:
        on = c[..., 3] > 0
        col = c[..., :3][on].astype(float)
        lab = ((col[:, None] - pal[None]) ** 2).sum(2).argmin(1)
        c[..., :3][on] = pal[lab].round().astype(np.uint8)
    # crop all to the union box
    alpha = np.stack([c[..., 3] for c in cells]).max(0)
    ys, xs = np.where(alpha > 0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    os.makedirs(a.out, exist_ok=True)
    ims = []
    for n, c in enumerate(cells):
        im = Image.fromarray(c[y0:y1, x0:x1], "RGBA")
        im.save(f"{a.out}/f{n:03d}.png")
        ims.append(im)
    print(f"{len(ims)} frames, {x1 - x0}x{y1 - y0} art px, palette {len(pal)}")


if __name__ == "__main__":
    main()
