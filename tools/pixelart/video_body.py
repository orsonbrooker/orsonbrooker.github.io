"""Build a lab body (sprites.png + sprites.json) straight from pixel-art-style videos.

Each art pixel is read from the video (see from_video.py), then every colour is put in a part
(skin, hair, jersey, team, shoes: five tones each, so the game can recolour them like the builder
does) or in the fixed colours (outlines, eyes, ball...). Which video colour belongs to which part is
set once by hand in the config, from a numbered swatch this script writes.

  uv run --with pillow --with numpy python tools/pixelart/video_body.py art/video/orson.json

Config (JSON):
  {"out": "assets/characters/lab/video", "period": 5.35, "clusters": 48,
   "clips": {"bounce": "/path/to/video.mp4"},
   "anims": {"idle": {"clip": "bounce", "frames": [0, 2, 4], "fps": 8}, ...},
   "spin": {"clip": "bounce", "frames": [18, 24, 30, 39, 51]},
   "parts": {"skin": [3, 7, ...], ...}, "fixed": 12}
With no "parts" yet, it writes swatch.png next to the config and stops.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

sys.path.insert(0, os.path.dirname(__file__))
from from_video import kmeans, sample  # noqa: E402

PARTS = ["skin", "hair", "jersey", "team", "shoes"]


def read_frames(video, wanted):
    tmp = tempfile.mkdtemp()
    subprocess.run(["ffmpeg", "-v", "error", "-i", video, f"{tmp}/%04d.png"], check=True)
    return {n: np.asarray(Image.open(f"{tmp}/{n + 1:04d}.png").convert("RGB")) for n in sorted(wanted)}


def drop_shadow(cells):
    def greys(c):
        col = c[..., :3].astype(int)
        return (c[..., 3] > 0) & (col.max(2) - col.min(2) <= 16) & (col.mean(2) >= 70) & (col.mean(2) <= 165)

    rows = sum(greys(c).sum(1) for c in cells)
    floor = int(np.argmax(rows))
    for c in cells:
        # The shadow lies outside his outline: only greys reachable from the empty background
        # without crossing anything else go. Grey soles and socks inside the outline stay.
        g = greys(c)
        g[: floor - 12] = False
        g[floor + 12:] = False
        empty = c[..., 3] == 0
        seen = np.zeros_like(g)
        stack = [(y, x) for y, x in zip(*np.where(g)) if any(
            0 <= y + dy < g.shape[0] and 0 <= x + dx < g.shape[1] and empty[y + dy, x + dx]
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
        for y, x in stack:
            seen[y, x] = True
        while stack:
            y, x = stack.pop()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < g.shape[0] and 0 <= nx < g.shape[1] and g[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        c[seen, 3] = 0
    return floor


def keep_body(c, keep_ball=False):
    """Only the biggest connected blob (the boy and anything he holds): drops a ball in the air and
    stray specks. With keep_ball (dribbling), a ball out of his hand stays too; only specks go."""
    on = c[..., 3] > 0
    lab = np.zeros(on.shape, int)
    best, best_n, k = 0, 0, 0
    sizes = {}
    for y, x in zip(*np.where(on)):
        if lab[y, x]:
            continue
        k += 1
        stack, n = [(y, x)], 0
        lab[y, x] = k
        while stack:
            cy, cx = stack.pop()
            n += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < on.shape[0] and 0 <= nx < on.shape[1] and on[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = k
                        stack.append((ny, nx))
        sizes[k] = n
        if n > best_n:
            best, best_n = k, n
    if keep_ball:
        small = [k2 for k2, n2 in sizes.items() if n2 < 40]
        c[np.isin(lab, small), 3] = 0
    else:
        c[lab != best, 3] = 0


def clear_lettering(idx, palette):
    """Finds the printed team name and number (team-coloured marks sitting inside the jersey),
    paints them over with the jersey shade around them, and returns where they were:
    [x, y, w, h, rows] in frame pixels (rows: 2 = name over number, the front; 1 = number only),
    or None when none shows."""
    team = set(palette["team"])
    jersey = set(palette["jersey"])
    is_team = np.isin(idx, list(team))
    is_jersey = np.isin(idx, list(jersey))
    H, W = idx.shape
    seen = np.zeros_like(is_team)
    marks = []
    for y, x in zip(*np.where(is_team)):
        if seen[y, x]:
            continue
        comp, stack = [], [(y, x)]
        seen[y, x] = True
        while stack:
            cy, cx = stack.pop()
            comp.append((cy, cx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and is_team[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        if len(comp) > 45:
            continue  # shorts, big trim: not a letter
        border = set()
        for cy, cx in comp:
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < H and 0 <= nx < W and not is_team[ny, nx]:
                    border.add((ny, nx))
        if border and sum(is_jersey[p] for p in border) / len(border) >= 0.75:
            marks.append(comp)
    if not marks:
        return None
    pts = np.array([p for comp in marks for p in comp])
    y0, x0 = pts.min(0)
    y1, x1 = pts.max(0) + 1
    if (y1 - y0) > 16 or (x1 - x0) > 16:
        # caught trim or a hand too: clear only the small marks, and let the frames either side
        # say where the print goes
        for cy, cx in pts:
            win = idx[max(0, cy - 2):cy + 3, max(0, cx - 2):cx + 3]
            js = [v for v in win.ravel() if v in jersey]
            if js and len([p for p in marks if len(p) <= 20 and (cy, cx) in p]):
                idx[cy, cx] = max(set(js), key=js.count)
        return None
    # paint over the whole box (the letters' soft edges are jersey-ish blues): each pixel takes
    # the commonest jersey shade just outside the box on its own rows
    mark = np.zeros_like(is_team)
    mark[pts[:, 0], pts[:, 1]] = True
    for cy in range(max(0, y0 - 1), min(H, y1 + 1)):
        ring = []
        for ry in (cy - 1, cy, cy + 1):
            if 0 <= ry < H:
                for rx in [*range(x0 - 4, x0 - 1), *range(x1 + 1, x1 + 4)]:
                    if 0 <= rx < W and is_jersey[ry, rx]:
                        ring.append(idx[ry, rx])
        if not ring:
            continue
        fill = max(set(ring), key=ring.count)
        for cx in range(max(0, x0 - 1), min(W, x1 + 1)):
            if is_jersey[cy, cx] or mark[cy, cx]:
                idx[cy, cx] = fill
    # a gap of jersey rows between two groups of marks means name over number
    rows_used = sorted(set(pts[:, 0]))
    gaps = [b - a for a, b in zip(rows_used, rows_used[1:])]
    two = any(g >= 2 for g in gaps) and (y1 - y0) >= 10
    return [int(x0), int(y0), int(x1 - x0), int(y1 - y0), 2 if two else 1]


def jersey_spot(idx, palette, face):
    """Where to print on a plain jersey, from its shape in this frame: [x, y, w, h, rows, angle].
    Placed on the middle of the jersey's mass across his chest (or back), which barely moves when an
    arm or the ball crosses part of it, tilted with his body (the mass's long axis), as wide as the
    jersey there."""
    jersey = np.isin(idx, palette["jersey"])
    rows = np.where(jersey.sum(1) >= 4)[0]
    if len(rows) < 8:
        return None
    top, bottom = rows.min(), rows.max()
    tall = bottom - top + 1
    lo, hi = (0.2, 0.7) if face == "front" else (0.12, 0.62)
    band = jersey.copy()
    band[: int(top + tall * lo)] = False
    band[int(top + tall * hi) + 1:] = False
    ys, xs = np.where(band)
    if len(ys) < 12:
        return None
    cx, cy = xs.mean(), ys.mean()
    # tilt: the band's long axis is across his shoulders; its angle from level, kept small
    cov = np.cov(np.vstack([xs - cx, ys - cy]))
    vals, vecs = np.linalg.eigh(cov)
    ax_x, ax_y = vecs[:, np.argmax(vals)]
    if ax_x < 0:
        ax_x, ax_y = -ax_x, -ax_y
    angle = float(np.degrees(np.arctan2(ax_y, ax_x)))
    angle = max(-20.0, min(20.0, angle)) if vals.max() > 1.5 * vals.min() else 0.0
    # width: the median jersey run across the band's middle rows
    widths = []
    for yy in range(int(cy) - 2, int(cy) + 3):
        r = None
        xs_row = np.where(jersey[yy])[0] if 0 <= yy < jersey.shape[0] else []
        if len(xs_row):
            near = xs_row[np.argmin(np.abs(xs_row - cx))]
            a = b = near
            while a - 1 >= 0 and jersey[yy, a - 1]:
                a -= 1
            while b + 1 < jersey.shape[1] and jersey[yy, b + 1]:
                b += 1
            widths.append(b - a + 1)
    w = int(np.median(widths)) if widths else 0
    if face == "side" and w < 5:
        return None
    h = 13 if face == "front" else 8 if face == "back" else 7
    rows_n = 2 if face == "front" else 1
    # the print's centre sits on the mass's middle (the front's a little lower, under the neckline)
    return [int(round(cx - w / 2)), int(round(cy - h / 2)), w, h, rows_n, round(angle, 1)]


def pieces(mask):
    """Labels a mask's 8-connected pieces: (labels, sizes), label 0 is background."""
    H, W = mask.shape
    lab = np.zeros(mask.shape, int)
    sizes = [0]
    for y, x in zip(*np.where(mask)):
        if lab[y, x]:
            continue
        k = len(sizes)
        stack, n = [(y, x)], 0
        lab[y, x] = k
        while stack:
            cy, cx = stack.pop()
            n += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = k
                        stack.append((ny, nx))
        sizes.append(n)
    return lab, np.array(sizes)


def hair_or_skin(idx, lab, either, part_of, palette, tones_of, centres):
    """Browns the video uses for both hair and skin, decided by where they are rather than by their
    neighbours alone: joined to his head of hair (a piece of hair and these browns with plenty of
    sure hair in it) they're hair, so the shaded back of his head recolours with the rest; anywhere
    else (a speck on an arm, a shadow on his neck) they're skin."""
    shared = [i for i, parts in either.items() if "hair" in parts and "skin" in parts]
    if not shared:
        return
    amb = np.isin(lab, shared)
    sure_hair = np.isin(lab, [i for i, p in part_of.items() if p == "hair" and i not in either])
    comp, sizes = pieces(amb | sure_hair | np.isin(idx, palette["hair"]))
    hair_count = np.bincount(comp[sure_hair], minlength=len(sizes))
    head = (hair_count >= 25)[comp] & (comp > 0)
    # ...and near more sure hair than sure skin (a raised arm across his hair stays arm)
    sure_skin = np.isin(lab, [i for i, p in part_of.items() if p == "skin" and i not in either])

    def around(mask, r=3):
        c = np.pad(mask.astype(int), r).cumsum(0).cumsum(1)
        c = np.pad(c, ((1, 0), (1, 0)))
        n = 2 * r + 1
        return c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]

    head &= around(sure_hair) * 1.5 >= around(sure_skin)
    for part, where in (("hair", amb & head), ("skin", amb & ~head)):
        ys, xs = np.where(where)
        if not len(ys):
            continue
        cols = centres[lab[ys, xs]]
        t = ((tones_of[part][None] - cols[:, None]) ** 2).sum(2).argmin(1)
        idx[ys, xs] = np.array(palette[part])[t]
    # sure-hair specks away from his head (a lit fold on an arm): skin
    ys, xs = np.where(np.isin(idx, palette["hair"]) & ~head & (comp > 0) & (sizes[comp] < 12))
    if len(ys):
        t = ((tones_of["skin"][None] - centres[lab[ys, xs]][:, None]) ** 2).sum(2).argmin(1)
        idx[ys, xs] = np.array(palette["skin"])[t]
    # the shaded underside of his hair often comes out as the darkest skin shades: above his jersey,
    # a dark-skin pixel with more sure hair than light skin around it is hair (spreading a few steps,
    # so a big shaded patch fills in from its hairy edge); face and neck shading, ringed by light
    # skin, stays skin
    jr = np.where(np.isin(idx, palette["jersey"]).any(1))[0]
    if len(jr):
        above = np.zeros(idx.shape, bool)
        above[: jr.min()] = True
        light = np.isin(idx, palette["skin"][2:])
        for _ in range(4):
            hairy = np.isin(idx, palette["hair"])
            dark = np.isin(idx, palette["skin"][:2]) & above
            flip = dark & (around(hairy, 2) > around(light, 2)) & (around(hairy, 2) >= 3)
            if not flip.any():
                break
            ys, xs = np.where(flip)
            t = ((tones_of["hair"][None] - centres[lab[ys, xs]][:, None]) ** 2).sum(2).argmin(1)
            idx[ys, xs] = np.array(palette["hair"])[t]
    # small patches of skin colour mostly ringed by hair (a lit strand at the back of his head): hair
    is_hair = np.isin(idx, palette["hair"])
    is_skin = np.isin(idx, palette["skin"])
    sk, sk_sizes = pieces(is_skin)
    H, W = idx.shape
    for k in range(1, len(sk_sizes)):
        if sk_sizes[k] > 60:
            continue
        ys, xs = np.where(sk == k)
        ring = set()
        for y, x in zip(ys, xs):
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and sk[ny, nx] != k:
                    ring.add((ny, nx))
        if ring and sum(is_hair[p] for p in ring) / len(ring) >= 0.7:
            t = ((tones_of["hair"][None] - centres[lab[ys, xs]][:, None]) ** 2).sum(2).argmin(1)
            idx[ys, xs] = np.array(palette["hair"])[t]


def biggest_piece(mask):
    """The biggest 4-connected piece of a mask."""
    H, W = mask.shape
    lab = np.zeros(mask.shape, int)
    best, best_n, k = 0, 0, 0
    for y, x in zip(*np.where(mask)):
        if lab[y, x]:
            continue
        k += 1
        stack, n = [(y, x)], 0
        lab[y, x] = k
        while stack:
            cy, cx = stack.pop()
            n += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = k
                    stack.append((ny, nx))
        if n > best_n:
            best, best_n = k, n
    return lab == best if best else np.zeros_like(mask)


def jersey_face(idx, palette, face):
    """An invisible four-cornered face laid on his chest (or back) for the number to be warped onto:
    [x0, y0, x1, y1, x2, y2, x3, y3] (top-left, top-right, bottom-right, bottom-left, grid pixels),
    or None. Its top and bottom are rows across the main patch of jersey (a third of the way down to
    two thirds on the front, higher on the back), its sides the jersey's edges there brought in a
    little, so it narrows as he turns side-on. It tilts with his shoulders: the top edge of the jersey,
    gently, as the builder's players' numbers do (tools/build_regions.py). Side-on frames get none,
    like the builder's side-on poses."""
    if face == "side":
        return None
    jersey = np.isin(idx, palette["jersey"])
    H, W = jersey.shape
    # the main patch: the biggest connected piece (not a sliver behind an arm, a sock or an eye)
    lab = np.zeros(jersey.shape, int)
    best, best_n, k = 0, 0, 0
    for y, x in zip(*np.where(jersey)):
        if lab[y, x]:
            continue
        k += 1
        stack, n = [(y, x)], 0
        lab[y, x] = k
        while stack:
            cy, cx = stack.pop()
            n += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < H and 0 <= nx < W and jersey[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = k
                    stack.append((ny, nx))
        if n > best_n:
            best, best_n = k, n
    if best_n < 30:
        return None
    # measure on all of the jersey but tiny bits: an arm across his back splits it in two, and the
    # face should span both sides (the number is only drawn on the jersey that shows)
    sizes = np.bincount(lab.ravel())
    main = (lab > 0) & (sizes[lab] >= 15)
    # its height: anchored to his body, not to how much of the jersey shows. The top is his
    # shoulder line (the top of the jersey, straps and all), the bottom the top of his shorts; the
    # number sits a fixed share of the way down, like a printed jersey. Measuring only the jersey
    # that shows put it on the small of his back when a raised arm covered his shoulders.
    jers = lab == best
    top = np.where(jers.any(1))[0].min()
    shorts = biggest_piece(np.isin(idx, palette["team"]))
    srows = np.where(shorts.sum(1) >= 3)[0]
    srows = srows[srows > top + 4]
    bottom = srows.min() if len(srows) else np.where(jers.any(1))[0].max()
    tall = bottom - top + 1
    lo, hi = (0.22, 0.68) if face == "front" else (0.16, 0.5)
    ry0, ry1 = int(round(top + tall * lo)), int(round(top + tall * hi))

    # its width and middle: from the lower half of his back (between the print and his shorts),
    # which a raised arm never covers. The number then sits where it would on a real jersey, and an
    # arm across his back passes in front of part of it (ink only goes where the jersey shows).
    spans = []
    for r in range(int(top + tall * 0.5), int(bottom)):
        xs = np.where(main[r])[0]
        if len(xs) >= 3:
            spans.append((xs.min(), xs.max()))
    if not spans:
        return None
    a = float(np.median([s[0] for s in spans]))
    b = float(np.median([s[1] for s in spans]))
    mid, full_w = (a + b) / 2, b - a + 1
    # tilt from the shoulders: a line through the top edge of the jersey across its middle
    xs_all = np.where(main.any(0))[0]
    x0, x1 = xs_all.min(), xs_all.max()
    cols = [c for c in range(x0 + (x1 - x0) // 5, x1 - (x1 - x0) // 5 + 1) if main[:, c].any()]
    angle = 0.0
    if len(cols) > 4:
        tops = [np.argmax(main[:, c]) for c in cols]
        angle = float(np.arctan(np.polyfit(cols, tops, 1)[0])) * 0.6
        angle = max(-np.radians(12), min(np.radians(12), angle))
    w = full_w * 0.8
    corners = np.array([[mid - w / 2, ry0], [mid + w / 2, ry0], [mid + w / 2, ry1], [mid - w / 2, ry1]], float)
    c = corners.mean(0)
    rot = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    corners = (corners - c) @ rot.T + c
    return [round(float(v), 2) for v in corners.ravel()]


def clear_box(idx, box, palette):
    """Paints the print box plain jersey: jersey and team pixels inside it take the commonest
    jersey shade just outside it on their rows (arms and the ball in front are left alone)."""
    x0, y0, w, h = box[:4]
    x1, y1 = x0 + w, y0 + h
    H, W = idx.shape
    jersey = np.isin(idx, palette["jersey"])
    inkable = jersey | np.isin(idx, palette["team"])
    for cy in range(max(0, y0 - 1), min(H, y1 + 1)):
        ring = [idx[ry, rx] for ry in (cy - 1, cy, cy + 1) if 0 <= ry < H
                for rx in [*range(x0 - 4, x0 - 1), *range(x1 + 1, x1 + 4)] if 0 <= rx < W and jersey[ry, rx]]
        if ring:
            fill = max(set(ring), key=ring.count)
            for cx in range(max(0, x0 - 1), min(W, x1 + 1)):
                if inkable[cy, cx]:
                    idx[cy, cx] = fill


def main():
    cfg_path = sys.argv[1]
    cfg = json.load(open(cfg_path))
    here = os.path.dirname(cfg_path)
    wanted = {}
    for spec in [*cfg["anims"].values(), cfg["spin"]]:
        wanted.setdefault(spec["clip"], set()).update(spec["frames"])
    cells = {}
    grids = {}  # frame -> where its cell grid starts in the video
    videos = {}  # frame -> the video frame (only for a full-detail sheet)
    for clip, ns in wanted.items():
        src = cfg["clips"][clip]
        # a clip is a video path, or {"video": path, "keep_ball": true} for dribbling
        video, keep_ball = (src, False) if isinstance(src, str) else (src["video"], src.get("keep_ball", False))
        fs = read_frames(video, ns)
        bg = np.median(fs[min(ns)].reshape(-1, 3), axis=0)
        green = cfg.get("background") == "green"
        got = {}
        for n, f in fs.items():
            got[n], gx, gy = sample(f, bg, cfg.get("period", 5.35), green, with_grid=True)
            grids[(clip, n)] = (gx, gy)
            if "detail" in cfg:
                videos[(clip, n)] = f  # kept for the full-detail sheet
        h = min(c.shape[0] for c in got.values())
        w = min(c.shape[1] for c in got.values())
        got = {n: c[:h, :w].copy() for n, c in got.items()}
        if not green:  # on green the shadow already went with the background
            floor = drop_shadow(list(got.values()))
        for n, c in got.items():
            keep_body(c, keep_ball)
        if green:
            # the floor: where his feet usually are (one foot is down in nearly every frame)
            floor = int(np.median([np.where(c[..., 3].any(1))[0].max() for c in got.values()]))
        for n, c in got.items():
            cells[(clip, n)] = (c, floor)

    px = np.concatenate([c[c[..., 3] > 0][:, :3] for c, _ in cells.values()]).astype(float)
    rng = np.random.default_rng(1)
    k = cfg.get("clusters", 48)
    # The colour groups are saved once, so the part lists in the config keep pointing at the same
    # colours when frames are added or the clean-up changes.
    saved = os.path.splitext(cfg_path)[0] + "-colours.json"
    if os.path.exists(saved):
        centres = np.array(json.load(open(saved)), float)
        k = len(centres)
    else:
        centres = kmeans(px[rng.choice(len(px), min(len(px), 60000), replace=False)], k)
        centres = centres[np.argsort(centres.sum(1))]
        json.dump(centres.round().astype(int).tolist(), open(saved, "w"))
    labels = {key: None for key in cells}
    for key, (c, _) in cells.items():
        on = c[..., 3] > 0
        lab = np.full(on.shape, -1)
        lab[on] = ((c[..., :3][on].astype(float)[:, None] - centres[None]) ** 2).sum(2).argmin(1)
        labels[key] = lab

    if "parts" not in cfg:
        # numbered swatch, plus a frame painted by cluster so each number can be found on the body
        sw = Image.new("RGB", (8 * 70, ((k + 7) // 8) * 40), "white")
        d = ImageDraw.Draw(sw)
        for i, col in enumerate(centres):
            x, y = (i % 8) * 70, (i // 8) * 40
            d.rectangle((x, y, x + 34, y + 34), fill=tuple(int(v) for v in col))
            d.text((x + 38, y + 10), str(i), fill="black")
        sw.save(os.path.join(here, "swatch.png"))
        print("wrote swatch.png; add \"parts\" to the config")
        return

    # cluster -> (part, tone) for parts; fixed colours keep their own value
    part_of = {}
    for part, ids in cfg["parts"].items():
        for i in ids:
            part_of[i] = part
    rgb = [(0, 0, 0)]  # slot 0: transparent
    slot_of = {}
    palette = {}
    colours = {}
    for part in PARTS:
        ids = [i for i in range(k) if part_of.get(i) == part]
        # five tones from this part's pixels, darkest first (outline, dark, shadow, mid, light)
        pts = np.concatenate([np.repeat(centres[i][None], max(1, int(sum((l == i).sum() for l in labels.values()) / 50)), 0) for i in ids])
        tones = kmeans(pts, min(5, len(ids)), seed=2) if len(ids) > 5 else centres[ids]
        tones = tones[np.argsort(tones.sum(1))]
        while len(tones) < 5:
            tones = np.vstack([tones, tones[-1]])
        palette[part] = list(range(len(rgb), len(rgb) + 5))
        for t in tones:
            rgb.append(tuple(int(round(v)) for v in t))
        for i in ids:
            slot_of[i] = palette[part][int(((tones - centres[i]) ** 2).sum(1).argmin())]
        colours[part] = "#%02x%02x%02x" % rgb[palette[part][3]]
    # the rest: merged down to a few fixed colours
    rest = [i for i in range(k) if i not in part_of]
    nf = min(cfg.get("fixed", 14), len(rest))
    fixed = kmeans(centres[rest].copy(), nf, seed=3) if len(rest) > nf else centres[rest]
    base = len(rgb)
    for t in fixed:
        rgb.append(tuple(int(round(v)) for v in t))
    for i in rest:
        slot_of[i] = base + int(((fixed - centres[i]) ** 2).sum(1).argmin())
    sock_base = len(rgb)
    for s in palette["jersey"]:
        # one step off the jersey's own colour: the game finds a pixel's slot by its colour
        r, g, b = rgb[s]
        rgb.append((r, g, b - 1 if b > 0 else 1))

    # frames: each trimmed to its own box, packed left to right; anchor = feet on the floor line
    sheet_imgs, frame_of = [], {}
    x_anchor = None
    # colours shared by two parts (a brown that is both hair shadow and skin shadow): each such
    # pixel joins whichever of its parts is most common around it
    either = {int(i): parts for i, parts in cfg.get("either", {}).items()}
    tones_of = {part: np.array([rgb[s] for s in palette[part]], float) for part in palette}
    prints = {}
    faces = {}  # frame -> the invisible face on his jersey the number is warped onto
    face_of = {}  # frame -> "front" / "back" / "side" when the jersey is plain
    for spec in cfg["anims"].values():
        if "face" in spec:  # one for the move, or one per frame
            faces_list = spec["face"] if isinstance(spec["face"], list) else [spec["face"]] * len(spec["frames"])
            for n, f in zip(spec["frames"], faces_list):
                face_of[(spec["clip"], n)] = f
    for key in sorted(cells, key=lambda kk: (kk[0], kk[1])):
        c, floor = cells[key]
        lab = labels[key]
        idx = np.zeros(lab.shape, np.uint8)
        for i, s in slot_of.items():
            idx[lab == i] = s
        if either:
            owner = np.full(lab.shape, -1)
            for i, part in part_of.items():
                if i not in either:
                    owner[lab == i] = PARTS.index(part)
            for i in cfg.get("ball", []):  # "fixed" as a candidate means the ball's colours
                owner[lab == i] = len(PARTS)
            for y, x in zip(*np.where(np.isin(lab, list(either)))):
                cand = either[int(lab[y, x])]
                win = owner[max(0, y - 2):y + 3, max(0, x - 2):x + 3]
                counts = [(win == (len(PARTS) if p == "fixed" else PARTS.index(p))).sum() for p in cand]
                part = cand[int(np.argmax(counts))]
                if part == "fixed":
                    idx[y, x] = base + int(((fixed - centres[lab[y, x]]) ** 2).sum(1).argmin())
                    continue
                t = int(((tones_of[part] - centres[lab[y, x]]) ** 2).sum(1).argmin())
                idx[y, x] = palette[part][t]
        if either:
            hair_or_skin(idx, lab, either, part_of, palette, tones_of, centres)
        if key not in face_of:  # lettering in the video: find it, paint it out
            prints[key] = clear_lettering(idx, palette)
        # Socks and soles are white like the jersey but shouldn't change with it: they take the
        # same tones from the fixed (sock) set. On a green-screen video they're the white below
        # the hem of his shorts (right in a crouch or a jump too); otherwise, near his feet.
        ys, _ = np.where(idx > 0)
        if green:
            # the hem: the bottom of the shorts, the biggest connected piece of team colour (blue
            # shading on his shoes doesn't count)
            team = np.isin(idx, palette["team"])
            shorts = biggest_piece(team)
            team_rows = np.where(shorts.any(1))[0]
            low = team_rows.max() + 1 if len(team_rows) else ys.max() - cfg.get("sock_rows", 26)
        else:
            low = ys.max() - cfg.get("sock_rows", 26)
        for t, s in enumerate(palette["jersey"]):
            band = idx[low:] == s
            idx[low:][band] = sock_base + t
        # Eye whites are jersey-white too: a few jersey pixels surrounded by skin are eyes, and
        # keep their white.
        is_j = np.isin(idx, palette["jersey"])
        is_s = np.isin(idx, palette["skin"])
        for y, x in zip(*np.where(is_j)):
            win = (slice(max(0, y - 3), y + 4), slice(max(0, x - 3), x + 4))
            if is_j[win].sum() <= 6 and is_s[win].sum() >= 12:
                idx[y, x] = sock_base + palette["jersey"].index(idx[y, x])
        if key in face_of:  # a plain jersey: place the print from the jersey's shape (socks and eyes aside)
            prints[key] = jersey_spot(idx, palette, face_of[key])
            faces[key] = jersey_face(idx, palette, face_of[key])
        if cfg.get("mirror"):  # the video turns the other way from the game's player
            idx = idx[:, ::-1]
        ys, xs = np.where(idx > 0)
        sheet_imgs.append((key, idx[ys.min():ys.max() + 1, xs.min():xs.max() + 1], xs.min(), ys.min(), floor))
    # x anchor: middle of the body in the first spin frame (standing facing us)
    first = (cfg["spin"]["clip"], cfg["spin"]["frames"][0])
    for key, im, x0, y0, floor in sheet_imgs:
        if key == first:
            x_anchor = x0 + im.shape[1] // 2
    # Each move lines up on its own: feet on the floor (the move's usual lowest point) and the
    # middle of his body (jersey and shorts) over the anchor. A boy who drifts a little in the
    # video then still dribbles on the spot. Moves that leave the floor (jumps) set
    # "anchor": "clip" and use the whole video's floor instead.
    ax = {key: x_anchor for key, *_ in sheet_imgs}
    fy = {key: floor for key, im, x0, y0, floor in sheet_imgs}
    by_key = {key: (im, x0, y0) for key, im, x0, y0, floor in sheet_imgs}
    body = palette["jersey"] + palette["team"]
    anchor_of = {}  # move -> (x, floor) it lined up on
    for name, spec in cfg["anims"].items():
        keys = [(spec["clip"], n) for n in spec["frames"] if (spec["clip"], n) in by_key]
        if "anchor" in spec or not keys:
            continue
        bottoms, centres = [], []
        for k in keys:
            im, x0, y0 = by_key[k]
            bottoms.append(y0 + im.shape[0] - 1)
            cols = np.where(np.isin(im, body))[1]
            if len(cols):
                centres.append(x0 + cols.mean())
        for k in keys:
            fy[k] = int(np.median(bottoms))
            if centres:
                ax[k] = int(round(np.median(centres)))
        anchor_of[name] = (ax[keys[0]], fy[keys[0]])
    # Moves off the floor (jump, release) line up where another move stood: "anchor": "gather".
    for name, spec in cfg["anims"].items():
        if spec.get("anchor") in anchor_of:
            for n in spec["frames"]:
                if (spec["clip"], n) in by_key:
                    ax[(spec["clip"], n)], fy[(spec["clip"], n)] = anchor_of[spec["anchor"]]
    # Where the ball leaves his hands, for the game's shot ("release_from": [move, frame, "flip"]):
    # the ball's middle in that frame, from his feet, in court pixels.
    # One per facing too ("release": {"bl": [move, frame], "b": [...]}), for a game that turns
    # him to face the hoop from each spot.
    def release_point(ref):
        k = (cfg["anims"][ref[0]]["clip"], cfg["anims"][ref[0]]["frames"][ref[1]])
        ball = np.isin(labels[k], cfg.get("ball", [])) & (cells[k][0][..., 3] > 0)
        ys, xs = np.where(ball)
        if not len(ys):
            return None
        dx, dy = xs.mean() - ax[k], ys.mean() - fy[k]
        if len(ref) > 2 and ref[2] == "flip":
            dx = -dx
        return [round(dx / cfg.get("res", 0.25)), round(dy / cfg.get("res", 0.25))]

    if "release_from" in cfg:
        cfg["releaseOffset"] = release_point(cfg["release_from"])
        print("release point", cfg["releaseOffset"])
    if "release" in cfg:
        cfg["releaseOffsets"] = {d: release_point(ref) for d, ref in cfg["release"].items()}
        print("release points", cfg["releaseOffsets"])
    # Derived moves (what a game reads) are made from the frames above, optionally flipped:
    # "derived": {"turn": {"from": [["idle", 0], ["idle-fr", 0, "flip"], ...]}}. Flipped frames get
    # their own mirrored copy on the sheet, since a game draws frames as they are.
    def derived_keys(spec):
        out = []
        for ref in spec["from"]:
            src = cfg["anims"][ref[0]]
            out.append(((src["clip"], src["frames"][ref[1]]), len(ref) > 2 and ref[2] == "flip"))
        return out

    flipped = sorted({k for spec in cfg.get("derived", {}).values() for k, f in derived_keys(spec) if f})
    H = max(im.shape[0] for _, im, *_ in sheet_imgs)
    W = sum(im.shape[1] + 1 for _, im, *_ in sheet_imgs) + sum(by_key[k][0].shape[1] + 1 for k in flipped)
    sheet = np.zeros((H, W), np.uint8)
    # Print spots that went missing (a hand in front, trim caught) or jumped: fill in from the
    # frames either side, measured from the feet so a crop change doesn't move them.
    anchored = {}
    for key, im, x0, y0, floor in sheet_imgs:
        p = prints.get(key)
        if p:
            anchored[key] = (p[0] - ax[key], p[1] - fy[key], p[2], p[3], p[4], p[5] if len(p) > 5 else 0)
    for name, spec in cfg["anims"].items():
        keys = [(spec["clip"], n) for n in spec["frames"]]
        have = [k for k in keys if k in anchored]
        if not have:
            continue
        med_w = int(np.median([anchored[k][2] for k in have]))
        med_h = int(np.median([anchored[k][3] for k in have]))
        good = [k for k in have if abs(anchored[k][2] - med_w) <= 3 and abs(anchored[k][3] - med_h) <= 3]
        for i, k in enumerate(keys):
            if k in good:
                continue
            near = sorted(good, key=lambda g: abs(keys.index(g) - i))[:2]
            if near and abs(keys.index(near[0]) - i) <= 3:
                anchored[k] = tuple(int(round(np.mean([anchored[g][j] for g in near]))) for j in range(4)) + (anchored[near[0]][4], anchored[near[0]][5])
            else:
                anchored.pop(k, None)
    floors = {key: (x0, y0, floor) for key, im, x0, y0, floor in sheet_imgs}
    for key, a in anchored.items():
        x0, y0, floor = floors[key]
        prints[key] = [a[0] + ax[key], a[1] + fy[key], a[2], a[3], a[4], a[5]]
    # The faces glide: each corner, measured from his feet, goes through a median of the frames
    # either side (dropping a frame where an arm or the ball spoiled the measurement) and then an
    # average, across each move (round the loop for loops). Side-on frames, where the face is too
    # narrow to read, get none, like the builder's side-on poses.
    for spec in cfg["anims"].values():
        keys = [(spec["clip"], n) for n in spec["frames"] if (spec["clip"], n) in by_key]
        keys = [k for k in keys if faces.get(k)]
        if not keys:
            continue
        loop = "fps" in spec and spec["frames"][0] != spec["frames"][-1]
        rel = np.array([[v - (ax[k] if j % 2 == 0 else fy[k]) for j, v in enumerate(faces[k])] for k in keys], float)
        n = len(keys)
        idxs = lambda i, r: [(i + d) % n if loop else min(n - 1, max(0, i + d)) for d in range(-r, r + 1)]
        med = np.array([np.median(rel[idxs(i, 2)], 0) for i in range(n)])
        avg = np.array([med[idxs(i, 1)].mean(0) for i in range(n)])
        for i, k in enumerate(keys):
            f = [round(float(v + (ax[k] if j % 2 == 0 else fy[k])), 2) for j, v in enumerate(avg[i])]
            width = np.hypot(f[2] - f[0], f[3] - f[1])
            faces[k] = f if width >= 4 else None
    # A plain jersey's print, measured in every frame, still wobbles a pixel or two from noise: smooth
    # its middle, width and tilt across each move (from his feet, so his own movement stays), and
    # keep its size steady within the move.
    for spec in cfg["anims"].values():
        keys = [(spec["clip"], n) for n in spec["frames"] if (spec["clip"], n) in by_key]
        keys = [k for k in keys if k in face_of and prints.get(k)]
        if len(keys) < 3:
            continue
        loop = "fps" in spec and spec["frames"][0] != spec["frames"][-1]
        rel = np.array([[prints[k][0] + prints[k][2] / 2 - ax[k], prints[k][1] + prints[k][3] / 2 - fy[k], prints[k][2],
                         prints[k][5] if len(prints[k]) > 5 else 0] for k in keys], float)
        n = len(keys)
        h = prints[keys[0]][3]
        for i, k in enumerate(keys):
            near = [(i + d) % n if loop else min(n - 1, max(0, i + d)) for d in range(-2, 3)]
            cx, cy, w, ang = rel[near].mean(0)
            cx, cy = cx + ax[k], cy + fy[k]
            prints[k] = [int(round(cx - w / 2)), int(round(cy - h / 2)), int(round(w)), h, prints[k][4], round(float(ang), 1)]
    for key, im, x0, y0, floor in sheet_imgs:
        p = prints.get(key)
        if p and key not in face_of:
            up = 3 if p[4] == 2 else 0  # the front's name is a faint smudge just above what was found
            clear_box(im, [p[0] - x0, p[1] - y0 - up, p[2], p[3] + up], palette)
    x = 0
    print_at = {}
    face_at = {}
    for key, im, x0, y0, floor in sheet_imgs:
        h, w = im.shape
        sheet[:h, x:x + w] = im
        frame_of[key] = [x, 0, w, h, int(x0 - ax[key]), int(y0 - fy[key])]
        fc = faces.get(key)
        if fc and key in face_of:  # the face for the number, on the sheet: [rows, 4 corners]
            face_at[f"{x},0"] = [2 if face_of[key] == "front" else 1] + [round(v - (x0 if j % 2 == 0 else y0) + (x if j % 2 == 0 else 0), 2) for j, v in enumerate(fc)]
        p = prints.get(key)
        if p:  # where to print the number (and name), on the sheet
            print_at[f"{x},0"] = [int(v) for v in (x + p[0] - x0, p[1] - y0, p[2], p[3], p[4])] + [p[5] if len(p) > 5 else 0]
        x += w + 1
    for key in flipped:
        sx, _, w, h, ox, oy = frame_of[key]
        sheet[:h, x:x + w] = sheet[:h, sx:sx + w][:, ::-1]
        frame_of[(*key, "flip")] = [x, 0, w, h, -(ox + w), oy]
        fc = face_at.get(f"{sx},0")
        if fc:  # mirrored: left and right corners swap
            mx = lambda v: x + w - (v - sx)
            tl, tr, br, bl = [(fc[1 + 2 * i], fc[2 + 2 * i]) for i in range(4)]
            face_at[f"{x},0"] = [fc[0], mx(tr[0]), tr[1], mx(tl[0]), tl[1], mx(bl[0]), bl[1], mx(br[0]), br[1]]
        p = print_at.get(f"{sx},0")
        if p:
            left = p[0] - sx
            print_at[f"{x},0"] = [x + w - left - p[2], p[1], p[2], p[3], p[4], -p[5]]  # mirrored tilt
        x += w + 1
    # check picture: the spin frames as built, then with each part painted one flat colour
    flags = {"skin": (255, 0, 255), "hair": (255, 220, 0), "jersey": (0, 255, 255), "team": (0, 90, 255), "shoes": (255, 60, 0)}
    flag_rgb = list(rgb)
    for part, slots in palette.items():
        for s in slots:
            flag_rgb[s] = flags[part]
    spin_keys = [(cfg["spin"]["clip"], n) for n in cfg["spin"]["frames"]]
    tiles = [im for key, im, *_ in sheet_imgs if key in spin_keys]
    tw = max(t.shape[1] for t in tiles) + 4
    chk = Image.new("RGB", (tw * len(tiles) * 2, H + 4), (120, 170, 120))
    for row, pal in enumerate([rgb, flag_rgb]):
        for i, t in enumerate(tiles):
            p = Image.fromarray(t, "P")
            fl = [v for c in pal for v in c]
            p.putpalette(fl + [0] * (768 - len(fl)))
            mask = Image.fromarray(((t > 0) * 255).astype(np.uint8))
            chk.paste(p.convert("RGB"), (tw * (i + row * len(tiles)) + 2, 2), mask)
    chk.resize((chk.width * 4, chk.height * 4), Image.NEAREST).save(os.path.join(here, "check.png"))
    # every slot its own exact colour (the game finds a pixel's slot by colour)
    seen = set()
    for i, (r, g, b) in enumerate(rgb):
        while i and (r, g, b) in seen:
            b = b - 1 if b > 0 else b + 2
        seen.add((r, g, b))
        rgb[i] = (r, g, b)
    out = cfg["out"]
    os.makedirs(out, exist_ok=True)
    img = Image.fromarray(sheet, "P")
    flat = [v for t in rgb for v in t]
    img.putpalette(flat + [0] * (768 - len(flat)))
    img.info["transparency"] = 0
    img.save(os.path.join(out, "sprites.png"), optimize=True, transparency=0)
    meta = {
        "res": cfg.get("res", 0.25),
        "frames": {
            **{name: [frame_of[(spec["clip"], n)] for n in spec["frames"]] for name, spec in {**cfg["anims"], "spin": cfg["spin"]}.items()},
            **{name: [frame_of[(*k, "flip") if f else k] for k, f in derived_keys(spec)] for name, spec in cfg.get("derived", {}).items()},
        },
        "palette": palette,
        "colours": colours,
        "rgb": [list(t) for t in rgb],
        "layers": {},
        "fps": {name: spec["fps"] for name, spec in {**cfg["anims"], **cfg.get("derived", {})}.items() if "fps" in spec},
        "pixel": True,  # true pixel art: draw at whole screen pixels per art pixel
        "prints": print_at,
        "faces": face_at,
        **({"releaseOffset": cfg["releaseOffset"]} if "releaseOffset" in cfg else {}),
        **({"releaseOffsets": cfg["releaseOffsets"]} if "releaseOffsets" in cfg else {}),
    }
    json.dump(meta, open(os.path.join(out, "sprites.json"), "w"), separators=(",", ":"))
    print(f"{len(frame_of)} drawings, sheet {W}x{H}, {os.path.getsize(os.path.join(out, 'sprites.png'))} B, {len(rgb)} colours")
    if "detail" in cfg:
        write_detail(cfg, meta, sheet_imgs, frame_of, flipped, grids, videos, out, sheet, palette)


def stamp(path):
    """A short stamp of a file's contents, for cache-busting its URL."""
    return hashlib.sha1(open(path, "rb").read()).hexdigest()[:8]


def write_detail(cfg, meta, sheet_imgs, frame_of, flipped, grids, videos, pixel_out, pixel_sheet, palette):
    """The same frames at the video's full detail (no pixel conversion), `scale` times the pixel
    sheet's size ("detail": {"out": ..., "scale": 3, "quality": 80}). Writes:
      sprites.webp  the frames, wrapped onto rows at most ROW_W wide (some phones can't draw wider)
      regions.png   which part each pixel is, for recolouring the way the builder's players are
                    (red channel: 1 skin, 2 hair, 3 jersey, 4 team, 5 shoes, 0 leave as drawn)
      sprites.json  frames, scale, fps, release points, the parts' average colours, and which pixel
                    sheet frame each frame is (the number is printed from the pixel sheet's faces)
    The background goes by the green key, with soft edges; anything the pixel sheet dropped (a ball
    in the air, specks) is dropped here too."""
    ROW_W = 4096
    d = cfg["detail"]
    K = int(d.get("scale", 3))
    p = cfg.get("period", 5.35)
    part_id = {"skin": 1, "hair": 2, "jersey": 3, "team": 4, "shoes": 5}
    slot_part = np.zeros(256, np.uint8)
    for part, slots in palette.items():
        for s in slots:
            slot_part[s] = part_id[part]
    tiles = {}  # pixel sheet key "x,0" -> (picture, regions)
    for key, im, x0, y0, floor in sheet_imgs:
        gx, gy = grids[key]
        a = videos[key]
        h, w = im.shape
        vx, vy = gx + x0 * p, gy + y0 * p
        rgb = a.astype(int)
        green = (rgb[..., 1] > rgb[..., 0] + 20) & (rgb[..., 1] > rgb[..., 2] + 8)
        alpha = np.where(green, 0, 255).astype(np.uint8)
        # green spill on soft edges: no pixel greener than its red and blue suggest
        rgb[..., 1] = np.minimum(rgb[..., 1], (rgb[..., 0] + rgb[..., 2]) // 2 + 40)
        full = Image.fromarray(np.dstack([rgb.clip(0, 255).astype(np.uint8), alpha]), "RGBA")
        box = (vx, vy, vx + w * p, vy + h * p)
        tile = full.transform((w * K, h * K), Image.EXTENT, box, Image.BICUBIC)
        # keep only what the pixel frame kept (grown a pixel so soft edges survive)
        keep = Image.fromarray(((im > 0) * 255).astype(np.uint8)).resize((w * K, h * K), Image.NEAREST)
        keep = keep.filter(ImageFilter.MaxFilter(2 * K + 1))
        r, g, b, al = tile.split()
        al = ImageChops.multiply(al, keep)
        tile = Image.merge("RGBA", (r, g, b, al))
        # parts: each art pixel's part from the pixel frame, grown into the soft edge around it
        sx = frame_of[key][0]
        parts = slot_part[pixel_sheet[:h, sx:sx + w]]
        reg = Image.fromarray(parts).resize((w * K, h * K), Image.NEAREST).filter(ImageFilter.MaxFilter(2 * K + 1))
        reg_a = np.asarray(reg).copy()
        inside = np.asarray(Image.fromarray(parts).resize((w * K, h * K), Image.NEAREST))
        # the soft rim outside the pixel frame takes its neighbour's part; inside, a pixel keeps its
        # own (the ball, outlines and eyes stay as drawn)
        body = np.asarray(Image.fromarray(((im > 0) * 255).astype(np.uint8)).resize((w * K, h * K), Image.NEAREST)) > 0
        reg_a = np.where(body, inside, np.where(np.asarray(keep) > 0, reg_a, 0)).astype(np.uint8)
        tiles[f"{sx},0"] = (tile, reg_a)
    for key in flipped:
        sx = frame_of[key][0]
        fx = frame_of[(*key, "flip")][0]
        t, r = tiles[f"{sx},0"]
        tiles[f"{fx},0"] = (ImageOps.mirror(t), r[:, ::-1])
    # pack in rows, in the pixel sheet's order
    places, x, y, row_h = {}, 0, 0, 0
    for key in sorted(tiles, key=lambda k: int(k.split(",")[0])):
        t = tiles[key][0]
        if x + t.width > ROW_W:
            x, y, row_h = 0, y + row_h + 2, 0
        places[key] = (x, y)
        x += t.width + 2
        row_h = max(row_h, t.height)
    W, H = ROW_W, y + row_h
    sheet = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    regions = np.zeros((H, W), np.uint8)
    for key, (px, py) in places.items():
        t, r = tiles[key]
        sheet.paste(t, (px, py))
        regions[py:py + r.shape[0], px:px + r.shape[1]] = np.maximum(regions[py:py + r.shape[0], px:px + r.shape[1]], r)
    out = d["out"]
    os.makedirs(out, exist_ok=True)
    sheet.save(os.path.join(out, "sprites.webp"), "WEBP", quality=d.get("quality", 80), method=6)
    reg_img = np.zeros((H, W, 4), np.uint8)
    reg_img[..., 0] = regions
    reg_img[..., 3] = np.where(np.asarray(sheet.split()[3]) > 0, 255, 0)
    Image.fromarray(reg_img, "RGBA").save(os.path.join(out, "regions.png"), optimize=True)
    # each part's average colour where it's solid, for recolouring (players/recolor.js)
    px_rgb = np.asarray(sheet)
    solid = px_rgb[..., 3] > 250
    names = {v: k for k, v in part_id.items()}
    avg = {names[i]: [round(float(c)) for c in px_rgb[(regions == i) & solid][:, :3].mean(0)] for i in names if ((regions == i) & solid).any()}

    def moved(f):
        x0, y0, w, h, ox, oy = f
        qx, qy = places[f"{x0},{y0}"]
        return [qx, qy, w * K, h * K, ox * K, oy * K]

    dmeta = {
        "res": meta["res"] * K,
        "frames": {name: [moved(f) for f in frames] for name, frames in meta["frames"].items()},
        "fps": meta["fps"],
        **{k: meta[k] for k in ("releaseOffset", "releaseOffsets") if k in meta},
        "regions": avg,
        "colours": meta["colours"],
        # the number and team name are printed from the pixel sheet's faces: which pixel frame each
        # frame here is, K times bigger
        # (each file named with a stamp of its contents, so browsers never use a stale copy)
        "regionsFile": f"{out}/regions.png?v={stamp(os.path.join(out, 'regions.png'))}",
        "printsFrom": {"atlas": f"{pixel_out}/sprites.png?v={stamp(os.path.join(pixel_out, 'sprites.png'))}",
                       "meta": f"{pixel_out}/sprites.json?v={stamp(os.path.join(pixel_out, 'sprites.json'))}", "scale": K,
                       "frames": {f"{q[0]},{q[1]}": k for k, q in places.items()}},
    }
    json.dump(dmeta, open(os.path.join(out, "sprites.json"), "w"), separators=(",", ":"))
    print(f"full detail: sheet {W}x{H}, {os.path.getsize(os.path.join(out, 'sprites.webp')) // 1024} KB, "
          f"regions {os.path.getsize(os.path.join(out, 'regions.png')) // 1024} KB")

if __name__ == "__main__":
    main()
