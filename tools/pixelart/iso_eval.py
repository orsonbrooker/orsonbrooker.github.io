"""Scores isometric pixel art (courts, props) against docs/art/isometric.md.

  uv run --with pillow --with numpy python3 tools/pixelart/iso_eval.py IMAGE [options]
  uv run --with pillow --with numpy python3 tools/pixelart/iso_eval.py --testset [--out DIR] [--update-baseline]

Options for one image:
  --court ID        the court in content/courts.js the image is (turns on the scale and light checks)
  --crop X,Y,W,H    score only this part of the image (in the image's own pixels)
  --kind court|prop prop: also checks see-through edges (default: court with --court, else prop)
  --palette FILE    a JSON list of hex colours to measure against (default: art/iso/palette.json if there,
                    else the image's own colours)
  --out DIR         also write scorecard.json, summary.txt and marks.png (what each check found, drawn on
                    the art) into DIR

It prints a short text summary, and with --json the scorecard (JSON) instead. The scorecard has the same shape
as verify's summary.json: {ok, image, grid, checks: [{name, ok, value, limit, detail}]}. `ok` is per rule in
the spec, so the approved references fail some (known breaks, see the spec); --testset runs every case in
art/iso/testset.json and compares each number with art/iso/baseline.json, so it fails only when art gets
worse than the approved references (or a new case breaks a rule).

How it reads an image: art that was drawn small and blown up has a grid of same-coloured cells. The eval
finds the cell size (and where the grid starts) from how often colour edges repeat, samples the middle of
every cell to get the art at its own size ("native" pixels), and runs most checks on that.
"""
import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ISO = ROOT / "art" / "iso"

# The rules' limits (docs/art/isometric.md says where each comes from).
OUTLINE_L = 22  # outline colours are this dark (CIE L); the gym's are 5 to 15, its darkest fills (navy, the backpack) 25+

LIMITS = {
    "pixel_size_integer": 0.02,   # cell size within this of a whole number of screen pixels
    "pixel_size_spread": 0.03,    # tiles whose own cell size is more than 3% off the whole image's
    "mixed_sizes_share": 0.05,    # ...at most this share of tiles
    "cell_clean_share": 0.90,     # share of cells that are one flat colour (mean Lab distance < 4 inside)
    "seam_share": 0.05,           # share of tiles whose grid is shifted by over a quarter cell
    "line_ratio": 0.5,            # 2:1 pixel lines: 1 down for 2 across, 26.6 deg (the gym's old camera is 0.566)
    "line_ratio_tol": 0.03,       # (a short line fits slopes about this far apart equally well)
    "palette_mean_de": 2.0,       # mean CIE76 distance from each native pixel to the nearest palette colour
    "palette_far_share": 0.02,    # share of native pixels further than 6 from every palette colour
    "colours_max": 64,            # distinct colours in the native art (merged within Lab 2.3)
    "ramp_hue_shift": 8.0,        # degrees of hue between a ramp's darkest and lightest colour
    "outline_thick_share": 0.10,  # dark line pixels in a line 2-4 pixels thick
    "black_outline_share": 0.5,   # outline pixels that are plain near-black (L < 12, chroma < 15)
    "doubled_corner_share": 0.05, # outline pixels that only double a diagonal step
    "stray_per_1000": 2.0,        # lone pixels per 1000 native pixels
    "soft_edge_share": 0.0,       # props: pixels that are partly see-through
    "arc_error_m": 0.10,          # painted 3-point line vs content/courts.js, mean
    "side_margin_m": 1.5,         # clear floor beside each end of the 3-point arc, to the side edges of the floor
    "back_margin_m": 2.5,         # clear floor behind the top of the arc, to the open (front) edge of the floor
    "rack_size_m": [1.5, 0.6],    # a ball rack's footprint: along the hoop wall, out from it (the gym's rack)
    "rack_edge_m": 0.2,           # a rack stays this far inside the floor's edges
    "ppm_match": 0.01,            # |eu| and |ev| agree, and pxPerM matches the camera, within 1%
}


# ---------- colour ----------

def srgb_to_lab(rgb):
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def kmeans(x, k, iters=12, seed=1):
    rng = np.random.default_rng(seed)
    if len(x) <= k:
        return x.copy(), np.arange(len(x))
    # k-means++ start
    c = [x[rng.integers(len(x))]]
    sample = x[rng.choice(len(x), min(len(x), 20000), replace=False)]
    for _ in range(k - 1):
        d = np.min(((sample[:, None, :] - np.array(c)[None]) ** 2).sum(-1), 1)
        c.append(sample[rng.choice(len(sample), p=d / d.sum())] if d.sum() > 0 else sample[rng.integers(len(sample))])
    c = np.array(c)
    for _ in range(iters):
        lab = nearest(x, c)[0]
        for j in range(k):
            m = lab == j
            if m.any():
                c[j] = x[m].mean(0)
    return c, nearest(x, c)[0]


def nearest(x, c):
    best = np.full(len(x), np.inf)
    idx = np.zeros(len(x), dtype=int)
    for j in range(len(c)):
        d = ((x - c[j]) ** 2).sum(-1)
        m = d < best
        best[m] = d[m]
        idx[m] = j
    return idx, np.sqrt(best)


def merge_colours(lab, tol=2.3):
    """How many colours are left when ones closer than `tol` are merged (greedy, on the unique ones)."""
    u = np.unique(np.round(lab, 1), axis=0)
    if len(u) > 6000:  # far too many anyway; estimate on a sample
        u = u[np.random.default_rng(0).choice(len(u), 6000, replace=False)]
        scale = None
    keep = []
    for p in u[np.argsort(u[:, 0])]:
        if not keep or np.min(np.sqrt(((np.array(keep) - p) ** 2).sum(-1))) >= tol:
            keep.append(p)
    return len(keep)


# ---------- the grid ----------

def edge_profiles(gray):
    return np.abs(np.diff(gray, axis=1)).sum(0), np.abs(np.diff(gray, axis=0)).sum(1)


def period_phase(profile, lo=1.5, hi=16.0):
    """The strongest repeat in an edge profile: (period, phase, strength). The phase is where a cell edge falls.
    The strength is how much of the edge energy lines up with that period (0 to 1)."""
    d = profile - profile.mean()
    n = len(d)
    if n < 8 or not np.any(d):
        return 1.0, 0.0, 0.0
    x = np.arange(n) + 1.0  # profile[i] is the edge between pixel i and i+1
    total = np.abs(d).sum() + 1e-9
    # steps fine enough that the phase drifts under a quarter cycle across the profile
    ps, p = [], lo
    while p <= hi:
        ps.append(p)
        p += max(0.001, p * p / (4 * n))
    ps = np.array(ps)
    best = (0.0, 1.0, 0j)
    for i in range(0, len(ps), 256):
        chunk = ps[i:i + 256]
        z = np.exp(-2j * np.pi * x[None, :] / chunk[:, None]) @ d
        k = int(np.argmax(np.abs(z)))
        if abs(z[k]) / total > best[0]:
            best = (abs(z[k]) / total, float(chunk[k]), z[k])
    s, p, z = best
    phase = (-np.angle(z) / (2 * np.pi) * p) % p
    return float(p), float(phase), float(s)


def find_grid(gray, mask):
    px, ox, sx = period_phase(edge_profiles(gray)[0])
    py, oy, sy = period_phase(edge_profiles(gray)[1])
    # a weak repeat, one under 2.5 px, or different across and down means the art is drawn at its own size
    if (sx < 0.15 and sy < 0.15) or min(px, py) < 2.5 or abs(px - py) / max(px, py) > 0.1:
        return {"cell": 1.0, "cell_x": 1.0, "cell_y": 1.0, "phase": [0.0, 0.0], "strength": 0.0, "square": True, "native": True}
    cell = (px + py) / 2
    return {"cell": cell, "cell_x": px, "cell_y": py, "phase": [ox, oy], "strength": round((sx + sy) / 2, 3),
            "square": abs(px - py) / max(px, py) < 0.03, "native": False}


def tile_grids(gray, grid, tile=256):
    """The cell size and grid offset of each busy tile, compared with the whole image's."""
    out = []
    h, w = gray.shape
    for y0 in range(0, h - tile // 2, tile):
        for x0 in range(0, w - tile // 2, tile):
            t = gray[y0:y0 + tile, x0:x0 + tile]
            if t.shape[0] < 64 or t.shape[1] < 64:
                continue
            ex, ey = edge_profiles(t)
            if ex.sum() < 64 * 255 * 0.5:  # too flat to say
                continue
            px, ox, sx = period_phase(ex, max(1.5, grid["cell_x"] * 0.8), grid["cell_x"] * 1.2)
            py, oy, sy = period_phase(ey, max(1.5, grid["cell_y"] * 0.8), grid["cell_y"] * 1.2)
            if min(sx, sy) < 0.1:
                continue
            # offset of this tile's grid from the global grid, in cells (wrapped to -0.5..0.5)
            dx = (((x0 + ox) - grid["phase"][0]) / grid["cell_x"] + 0.5) % 1 - 0.5
            dy = (((y0 + oy) - grid["phase"][1]) / grid["cell_y"] + 0.5) % 1 - 0.5
            out.append({"x": x0, "y": y0, "cell_x": px, "cell_y": py, "shift": [dx, dy]})
    return out


def sample_native(rgba, grid):
    """The art at its own size: the colour in the middle of each cell (or the image itself if it's native)."""
    if grid["native"]:
        return rgba.copy(), np.arange(rgba.shape[1]), np.arange(rgba.shape[0])
    h, w = rgba.shape[:2]
    cx, cy = grid["cell_x"], grid["cell_y"]
    xs = np.arange(grid["phase"][0] - cx * math.floor(grid["phase"][0] / cx) + cx / 2, w, cx)
    ys = np.arange(grid["phase"][1] - cy * math.floor(grid["phase"][1] / cy) + cy / 2, h, cy)
    xs = np.clip(np.floor(xs).astype(int), 0, w - 1)
    ys = np.clip(np.floor(ys).astype(int), 0, h - 1)
    return rgba[np.ix_(ys, xs)], xs, ys


def cell_cleanliness(lab, opaque, grid, xs, ys):
    """Share of cells that are one flat colour inside (a blurred, resized or painted image isn't)."""
    if grid["native"]:
        return 1.0
    cx, cy = grid["cell_x"], grid["cell_y"]
    r = max(1, int(min(cx, cy) / 2) - 1)  # inset, so the cell's own edge doesn't count
    clean = total = 0
    for j, y in enumerate(ys[::2]):
        for i, x in enumerate(xs[::2]):
            if not opaque[y, x]:
                continue
            y0, y1, x0, x1 = max(0, y - r), y + r + 1, max(0, x - r), x + r + 1
            block = lab[y0:y1, x0:x1].reshape(-1, 3)
            d = np.sqrt(((block - lab[y, x]) ** 2).sum(-1)).mean()
            total += 1
            clean += d < 4
    return clean / max(1, total)


# ---------- lines ----------

def line_angles(lab_l, opaque):
    """The slope of the long straight diagonal lines (down per across), each side of horizontal. Edge pixels
    (a step in lightness to the pixel below) are swept with every slope from 0.25 to 1; the slope at which the
    most edge pixels pile up on the same lines wins. Works on stair-stepped pixel lines, unlike gradients."""
    L = lab_l.astype(np.float64)
    e = np.zeros(L.shape, bool)
    e[:-1] = (np.abs(L[1:] - L[:-1]) > 8) & opaque[1:] & opaque[:-1]
    # drop long flat runs (floors' far edges, shelves): they'd pull every slope towards flat
    run = np.zeros(L.shape, int)
    for y in range(e.shape[0]):
        row = e[y]
        edges = np.flatnonzero(np.diff(np.concatenate([[0], row.astype(int), [0]])))
        for a, b in zip(edges[::2], edges[1::2]):
            run[y, a:b] = b - a
    e &= run <= 4
    ys, xs = np.nonzero(e)
    out = {}
    if len(xs) < 20:
        return {"right": None, "left": None, "share": [0, 0]}
    slopes = np.arange(0.3, 0.9001, 0.0025)
    for side, sign in (("right", 1), ("left", -1)):
        scores, longest = [], []
        for sl in slopes:
            best_s, best_l = 0.0, 0
            # a stepped line's pixels sit up to a pixel apart across it, so try two bin offsets and keep the better
            for off in (0.0, 0.5):
                c = np.floor(ys - sign * sl * xs + off).astype(int)
                counts = np.bincount(c - c.min())
                top = np.sort(counts)[-8:]
                if top.sum() > best_s:
                    best_s, best_l = float(top.sum()), int(top[-1])
            scores.append(best_s / len(xs))  # share of edge pixels on the 8 fullest lines at this slope
            longest.append(best_l)
        scores = np.array(scores)
        prom = scores - np.median(scores)  # the peak over the background, not the raw score
        i = int(np.argmax(prom))
        # a short line fits a range of slopes equally well: take the middle of that range
        flat = np.flatnonzero(prom >= prom[i] - 1e-9)
        flat = flat[(flat >= flat[np.searchsorted(flat, i)] - 0) & (np.abs(flat - i) <= 20)]
        i = int(round(np.median(flat)))
        # a real line: stands out, and at least 12 art pixels of edge lie on one line at that slope
        out[side] = float(slopes[i]) if prom[i] > 0.02 and longest[i] >= 12 else None
        out[side + "_longest"] = int(longest[i])
        out[side + "_peak"] = round(float(prom[i]), 3)
    return out


# ---------- outlines and stray pixels ----------

def neighbours4(a):
    p = np.pad(a, 1, mode="edge")
    return [p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]]


def outline_lines(lab, opaque):
    """Finds drawn lines of outline-dark pixels (L under OUTLINE_L) and how thick each is. Walking across from a lighter (or
    see-through) pixel, a run of 1 to 4 dark pixels with something lighter again on the far side is a line, and
    its length is the line's thickness. Longer dark runs are shadows, not lines. Returns (line mask, thick mask)."""
    L = np.where(opaque, lab[..., 0], 100.0)
    dark = opaque & (L < OUTLINE_L)
    h, w = L.shape
    line = np.zeros_like(dark)
    across = np.full((2,) + dark.shape, 99)  # each pixel's line thickness, crossing it sideways and up-down
    P = np.pad(L, 5, constant_values=100.0)
    D = np.pad(dark, 5)
    ys, xs = np.nonzero(dark)
    for n, (dy, dx) in enumerate(((0, 1), (1, 0))):
        for y, x in zip(ys, xs):
            # only start at the first dark pixel of a run in this direction
            if D[y + 5 - dy, x + 5 - dx] or P[y + 5 - dy, x + 5 - dx] - L[y, x] < 18:
                continue
            k = 0
            while k < 5 and D[y + 5 + k * dy, x + 5 + k * dx]:
                k += 1
            if k > 4 or P[y + 5 + k * dy, x + 5 + k * dx] - L[y, x] < 18:
                continue
            for j in range(k):
                line[y + j * dy, x + j * dx] = True
                across[n, y + j * dy, x + j * dx] = k
    # the thickness is the thinner way across: a one-pixel 2:1 line is 2 wide sideways but 1 up-down
    thick = line & (across.min(0) >= 2)
    return line, thick


def outline_checks(lab, opaque):
    m, thick = outline_lines(lab, opaque)
    # a pixel is thick only if it's thick across both ways it's crossed (a line seen along its length isn't)
    total = int(m.sum())
    if total == 0:
        return 0, 0.0, 0.0, np.zeros_like(m), np.zeros_like(m)
    # doubled corners: a pixel whose only outline neighbours are one beside it and one above/below it, with the
    # diagonal between those two empty, on a staircase (an arm stops right after) - the line would still join up
    # without it
    p = np.pad(m, 2)
    c = p[2:-2, 2:-2]

    def at(dy, dx):
        return p[2 + dy:p.shape[0] - 2 + dy, 2 + dx:p.shape[1] - 2 + dx]
    doubled = np.zeros_like(m)
    for sx in (-1, 1):
        for sy in (-1, 1):
            h, v = at(0, sx), at(sy, 0)
            oh, ov = at(0, -sx), at(-sy, 0)
            diag = at(sy, sx)
            stair = ~at(0, 2 * sx) | ~at(2 * sy, 0)
            doubled |= c & h & v & ~oh & ~ov & ~diag & stair
    return total, thick.sum() / total, doubled.sum() / total, thick, doubled


def stray_pixels(labels, opaque):
    """Lone pixels: a colour none of its 8 neighbours has, sitting in a patch that's mostly one other colour."""
    h, w = labels.shape
    p = np.pad(labels, 1, mode="edge")
    po = np.pad(opaque, 1)
    neigh = [p[1 + dy:h + 1 + dy, 1 + dx:w + 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
    nop = [po[1 + dy:h + 1 + dy, 1 + dx:w + 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
    n = np.stack(neigh)
    same = (n == labels[None]).sum(0)
    # how many neighbours share the most common neighbour colour
    mode_count = np.zeros_like(labels)
    for k in range(8):
        mode_count = np.maximum(mode_count, (n == n[k][None]).sum(0))
    allop = np.stack(nop).all(0)
    stray = opaque & allop & (same == 0) & (mode_count >= 6)
    return stray


# ---------- ramps ----------

def ramps(palette_lab):
    """Finds the palette's shading ramps and how much each moves in hue from shadow to light. Each colour is
    linked to its nearest darker colour (Lab distance under 35, hue within 50 degrees), and each chain of links
    from a colour nothing links to is a ramp. Ramps of 3+ colours spanning 20+ of lightness are reported."""
    n = len(palette_lab)
    L = palette_lab[:, 0]
    hue = np.degrees(np.arctan2(palette_lab[:, 2], palette_lab[:, 1])) % 360
    chroma = np.hypot(palette_lab[:, 1], palette_lab[:, 2])
    parent = [-1] * n
    for i in range(n):
        best = (35.0, -1)
        for j in range(n):
            if L[j] >= L[i] - 2:
                continue
            if chroma[i] > 8 and chroma[j] > 8 and abs((hue[i] - hue[j] + 180) % 360 - 180) > 50:
                continue
            d = float(np.sqrt(((palette_lab[i] - palette_lab[j]) ** 2).sum()))
            if d < best[0]:
                best = (d, j)
        parent[i] = best[1]
    tops = set(range(n)) - set(parent)
    out, seen = [], set()
    for t in sorted(tops, key=lambda i: -L[i]):
        chain = [t]
        while parent[chain[-1]] >= 0:
            chain.append(parent[chain[-1]])
        if len(chain) < 3 or L[chain[0]] - L[chain[-1]] < 20 or tuple(chain) in seen:
            continue
        seen.add(tuple(chain))
        coloured = [i for i in chain if chroma[i] > 8]
        if len(coloured) < 2:
            dh = 0.0
        else:
            dh = float((hue[coloured[0]] - hue[coloured[-1]] + 180) % 360 - 180)
        out.append({"colours": len(chain), "hue": round(float(hue[t])), "dark_L": round(float(L[chain[-1]])),
                    "light_L": round(float(L[t])), "hue_shift": round(dh, 1)})
    return out


# ---------- court geometry ----------

def court_def(cid):
    js = f"import('{(ROOT / 'content' / 'courts.js').as_uri()}').then(m=>console.log(JSON.stringify(m.COURTS[{json.dumps(cid)}] || null)))"
    r = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True)
    c = json.loads(r.stdout)
    if not c:
        sys.exit(f"no court '{cid}' in content/courts.js")
    return c


def rack_layout():
    js = f"import('{(ROOT / 'content' / 'threes.js').as_uri()}').then(m=>console.log(JSON.stringify(m.RACK_LAYOUT || [])))"
    r = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else []


def room_checks(c):
    """Clear floor round the 3-point arc for racks and props, from content/courts.js alone (no pixels).
    u runs along the hoop wall from the back corner, v out from it; the arc's angle 0 is +u, 90 straight out."""
    ru, rv = unproject(c, c["rim"]["at"]["x"], c["rim"]["at"]["y"] + c["rim"]["height"] * c["pxPerM"])
    line = c["threePointLine"]
    pts = [(ru + math.cos(math.radians(k * 10)) * d, rv + math.sin(math.radians(k * 10)) * d) for k, d in enumerate(line)]
    room = c["room"]
    left = min(u for u, _ in pts)           # to the side wall at u = 0 (the gym's right wall)
    right = room["u"] - max(u for u, _ in pts)  # to the open side edge at u = room.u
    back = room["v"] - max(v for _, v in pts)
    out = []
    side = min(left, right)
    out.append(check("room beside the arc", side >= LIMITS["side_margin_m"], {"wall_side_m": round(left, 2), "open_side_m": round(right, 2)},
                     f">= {LIMITS['side_margin_m']} m", f"clear floor beside the arc's ends: {left:.2f} m to the side wall, "
                     f"{right:.2f} m to the open side edge"))
    out.append(check("room behind the arc", back >= LIMITS["back_margin_m"], round(back, 2), f">= {LIMITS['back_margin_m']} m",
                     f"clear floor behind the top of the arc to the open front edge: {back:.2f} m"))
    racks = rack_layout()
    if racks:
        L, D = LIMITS["rack_size_m"]
        e = LIMITS["rack_edge_m"]
        bad = []
        for i, r in enumerate(racks):
            ang, past = r["rack"]
            k = ang / 10
            j = min(len(line) - 2, int(k))
            dist = line[j] * (1 - (k - j)) + line[j + 1] * (k - j) + past
            cu, cv = ru + math.cos(math.radians(ang)) * dist, rv + math.sin(math.radians(ang)) * dist
            # the rack's long side runs along the hoop wall (art/three-point-contest.md), centred on its point
            if cu - L / 2 < e or cu + L / 2 > room["u"] - e or cv - D / 2 < e or cv + D / 2 > room["v"] - e:
                bad.append(f"rack {i + 1} at u {cu:.2f}, v {cv:.2f}")
        out.append(check("racks fit on the floor", not bad, {"racks": len(racks), "off": len(bad)}, f"{L} x {D} m, {e} m inside the edges",
                         f"{len(racks) - len(bad)} of {len(racks)} racks (content/threes.js) fit on the floor"
                         + (": " + "; ".join(bad) + " runs off it" if bad else "")))
    return out


def project(c, u, v, z=0.0):
    o, eu, ev = c["origin"], c["eu"], c["ev"]
    return o["x"] + u * eu["x"] + v * ev["x"], o["y"] + u * eu["y"] + v * ev["y"] - z * c["pxPerM"]


def unproject(c, x, y):
    o, eu, ev = c["origin"], c["eu"], c["ev"]
    dx, dy = x - o["x"], y - o["y"]
    det = eu["x"] * ev["y"] - ev["x"] * eu["y"]
    return (dx * ev["y"] - ev["x"] * dy) / det, (eu["x"] * dy - dx * eu["y"]) / det


def arc_check(c, lab, crop):
    """Finds the painted 3-point line along rays from the hoop and compares it with threePointLine."""
    ru, rv = unproject(c, c["rim"]["at"]["x"], c["rim"]["at"]["y"] + c["rim"]["height"] * c["pxPerM"])
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    h, w = L.shape
    found = []
    for k, want in enumerate(c["threePointLine"]):
        ang = math.radians(k * 10)
        hits = []
        for d in np.arange(want - 0.6, want + 0.6, 0.01):
            x, y = project(c, ru + math.cos(ang) * d, rv + math.sin(ang) * d)
            xi, yi = int(x) - crop[0], int(y) - crop[1]
            if 0 <= xi < w and 0 <= yi < h and L[yi, xi] > 82 and math.hypot(A[yi, xi], B[yi, xi]) < 18:
                hits.append(d)
        if not hits:
            found.append({"deg": k * 10, "want": want, "found": None})
            continue
        # the run of white nearest the expected distance; its middle
        hits = np.array(hits)
        runs = np.split(hits, np.nonzero(np.diff(hits) > 0.03)[0] + 1)
        run = min(runs, key=lambda r: abs(r.mean() - want))
        found.append({"deg": k * 10, "want": want, "found": round(float(run.mean()), 3), "width_m": round(float(run[-1] - run[0] + 0.01), 3)})
    return (ru, rv), found


def light_check(c, lab, crop):
    """Mean lightness of the two walls' lower halves: with light from the upper left, the right wall (facing
    left, towards the light) is lighter than the left wall (the hoop wall, facing right)."""
    L = lab[..., 0]
    h, w = L.shape

    def mean_on(points):
        vals = [L[int(y) - crop[1], int(x) - crop[0]] for x, y in points if 0 <= int(x) - crop[0] < w and 0 <= int(y) - crop[1] < h]
        return float(np.median(vals)) if vals else None
    room = c["room"]
    # sample wall panels clear of the hoop and furniture: low on the wall, near the back corner
    left = [project(c, u, 0, z) for u in np.arange(0.4, 2.0, 0.05) for z in np.arange(0.3, 1.2, 0.05)]
    right = [project(c, 0, v, z) for v in np.arange(0.4, 2.0, 0.05) for z in np.arange(0.3, 1.2, 0.05)]
    floor = [project(c, u, v) for u in np.arange(0.5, room["u"] - 0.5, 0.25) for v in np.arange(0.5, room["v"] - 0.5, 0.25)]
    return mean_on(left), mean_on(right), mean_on(floor)


# ---------- scoring ----------

def check(name, ok, value, limit, detail):
    return {"name": name, "ok": bool(ok), "value": value, "limit": limit, "detail": detail}


def evaluate(path, court=None, crop=None, kind=None, palette=None, line_ratio=None):
    target = LIMITS["line_ratio"] if line_ratio is None else line_ratio
    img = Image.open(path).convert("RGBA")
    if crop:
        x, y, w, h = crop
        img = img.crop((x, y, x + w, y + h))
    else:
        crop = (0, 0, img.width, img.height)
    rgba = np.asarray(img).astype(np.uint8)
    alpha = rgba[..., 3]
    opaque = alpha >= 128
    kind = kind or ("court" if court else "prop")
    lab = srgb_to_lab(rgba[..., :3])
    gray = np.where(opaque, rgba[..., :3].mean(-1), 0.0)

    grid = find_grid(gray, opaque)
    tiles = [] if grid["native"] else tile_grids(gray, grid)
    native, xs, ys = sample_native(rgba, grid)
    nop = native[..., 3] >= 128
    nlab = srgb_to_lab(native[..., :3])
    pts = nlab[nop]

    checks = []
    cell = grid["cell"]
    # 1. pixel size: one whole number of screen pixels per art pixel, the same everywhere
    frac = abs(cell - round(cell))
    checks.append(check("pixel size is a whole number", grid["native"] or frac <= LIMITS["pixel_size_integer"], round(cell, 3),
                        f"within {LIMITS['pixel_size_integer']} of a whole number",
                        "drawn at its own size" if grid["native"] else
                        f"each art pixel is {cell:.3f} screen pixels ({grid['cell_x']:.3f} across, {grid['cell_y']:.3f} down), so cells are "
                        f"{math.floor(cell)} or {math.ceil(cell)} px wide" if frac > LIMITS["pixel_size_integer"] else f"each art pixel is {round(cell)} screen pixels"))
    off = [t for t in tiles if abs(t["cell_x"] / grid["cell_x"] - 1) > LIMITS["pixel_size_spread"] or abs(t["cell_y"] / grid["cell_y"] - 1) > LIMITS["pixel_size_spread"]]
    share = len(off) / max(1, len(tiles))
    checks.append(check("one pixel size everywhere", share <= LIMITS["mixed_sizes_share"], round(share, 3), LIMITS["mixed_sizes_share"],
                        f"{len(off)} of {len(tiles)} busy tiles have a different cell size" if tiles else "no tiles to compare"))
    clean = cell_cleanliness(lab, opaque, grid, xs, ys)
    checks.append(check("cells are flat colour", clean >= LIMITS["cell_clean_share"], round(clean, 3), LIMITS["cell_clean_share"],
                        f"{clean:.0%} of cells are one flat colour inside (the rest are blurred, painted or resized)"))
    shifted = [t for t in tiles if max(abs(t["shift"][0]), abs(t["shift"][1])) > 0.25]
    s = len(shifted) / max(1, len(tiles))
    checks.append(check("seams on the grid", s <= LIMITS["seam_share"], round(s, 3), LIMITS["seam_share"],
                        f"{len(shifted)} of {len(tiles)} busy tiles sit off the image's grid by over a quarter cell"))

    # 2. lines
    line_mask = nop
    if court:
        # on a court, measure the floor only (walls and furniture have their own lines)
        c = court_def(court)
        gx, gy = np.meshgrid(xs + crop[0], ys + crop[1])
        o, eu, ev = c["origin"], c["eu"], c["ev"]
        det = eu["x"] * ev["y"] - ev["x"] * eu["y"]
        du, dv = gx - o["x"], gy - o["y"]
        fu, fv = (du * ev["y"] - ev["x"] * dv) / det, (eu["x"] * dv - du * eu["y"]) / det
        line_mask = nop & (fu > 0.2) & (fv > 0.2) & (fu < c["room"]["u"] - 0.2) & (fv < c["room"]["v"] - 0.2)
    la = line_angles(nlab[..., 0], line_mask)
    if la["right"] is None and la["left"] is None:
        checks.append(check("lines match the camera", True, None, f"{target} +/- {LIMITS['line_ratio_tol']}", "no long diagonal lines to measure"))
    else:
        ratios = {k: round(la[k], 3) for k in ("right", "left") if la[k] is not None}
        worst = max(abs(r - target) for r in ratios.values())
        checks.append(check("lines match the camera", worst <= LIMITS["line_ratio_tol"], ratios, f"{target} +/- {LIMITS['line_ratio_tol']}",
                            "the long diagonal lines go " + " and ".join(f"{r} down per across to the {k} ({math.degrees(math.atan(r)):.1f} deg)"
                                                                          for k, r in ratios.items()) + f"; the camera is {target} ({math.degrees(math.atan(target)):.1f} deg)"))

    # 3. palette
    if palette is not None:
        pal = srgb_to_lab(np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in palette]))
        _, d = nearest(pts, pal)
        checks.append(check("on the palette", d.mean() <= LIMITS["palette_mean_de"] and (d > 6).mean() <= LIMITS["palette_far_share"],
                            {"mean": round(float(d.mean()), 2), "p95": round(float(np.percentile(d, 95)), 2), "far_share": round(float((d > 6).mean()), 3)},
                            f"mean <= {LIMITS['palette_mean_de']}, share over 6 <= {LIMITS['palette_far_share']}",
                            f"Lab distance to the nearest palette colour: mean {d.mean():.1f}, 95% under {np.percentile(d, 95):.1f}, "
                            f"{(d > 6).mean():.0%} further than 6"))
    n = merge_colours(pts)
    checks.append(check("few colours", n <= LIMITS["colours_max"], n, LIMITS["colours_max"],
                        f"{n} distinct colours at its own size (merged within Lab 2.3)"))
    pal_lab, labels_flat = kmeans(pts, min(32, max(2, len(pts) // 50)))
    rp = ramps(pal_lab)
    shifted_r = [r for r in rp if abs(r["hue_shift"]) >= LIMITS["ramp_hue_shift"]]
    checks.append(check("ramps shift hue", bool(rp) and len(shifted_r) >= len(rp) / 2, rp, f"most ramps move >= {LIMITS['ramp_hue_shift']} deg of hue",
                        f"{len(shifted_r)} of {len(rp)} colour ramps move hue from shadow to light" if rp else "no ramps of 3+ shades found"))

    # 4. outlines and stray pixels
    total, thick, doubled, thick_m, doubled_m = outline_checks(nlab, nop)
    checks.append(check("outlines one pixel wide", thick <= LIMITS["outline_thick_share"], round(float(thick), 3), LIMITS["outline_thick_share"],
                        f"{thick:.0%} of {total} dark line pixels are in a line 2 to 4 pixels thick"))
    if total:
        ol = nlab[outline_lines(nlab, nop)[0]]
        black = float(((ol[:, 0] < 12) & (np.hypot(ol[:, 1], ol[:, 2]) < 15)).mean())
        checks.append(check("outlines take colour", black <= LIMITS["black_outline_share"], round(black, 3), LIMITS["black_outline_share"],
                            f"{black:.0%} of outline pixels are plain near-black, not a dark shade of what they go round"))
    checks.append(check("no doubled corners", doubled <= LIMITS["doubled_corner_share"], round(float(doubled), 3), LIMITS["doubled_corner_share"],
                        f"{doubled:.0%} of outline pixels only double a diagonal step"))
    labels = np.full(nop.shape, -1)
    labels[nop] = labels_flat
    stray = stray_pixels(labels, nop)
    per = stray.sum() / max(1, nop.sum()) * 1000
    checks.append(check("no stray pixels", per <= LIMITS["stray_per_1000"], round(float(per), 2), LIMITS["stray_per_1000"],
                        f"{int(stray.sum())} lone pixels ({per:.1f} per 1000)"))

    if kind == "prop":
        soft = ((alpha > 0) & (alpha < 255)).sum() / max(1, (alpha > 0).sum())
        checks.append(check("hard edges", soft <= LIMITS["soft_edge_share"], round(float(soft), 4), LIMITS["soft_edge_share"],
                            f"{soft:.1%} of visible pixels are partly see-through"))

    marks = {"stray": stray, "thick": thick_m, "doubled": doubled_m}
    arc = None
    if court:
        c = court_def(court)
        eu, ev = math.hypot(c["eu"]["x"], c["eu"]["y"]), math.hypot(c["ev"]["x"], c["ev"]["y"])
        # a real camera whose floor lines slope `target` looks down asin(target); 1 m up is then
        # cos(e) / sqrt((1 + sin^2 e) / 2) times 1 m along the floor (1.095 for 2:1, 1.015 for the gym's 0.566)
        e = math.asin(target)
        up = math.cos(e) / math.sqrt((1 + math.sin(e) ** 2) / 2)
        floor = (eu + ev) / 2
        spread = max(abs(eu / ev - 1), abs(c["pxPerM"] / (floor * up) - 1))
        checks.append(check("one scale on every axis", spread <= LIMITS["ppm_match"],
                            {"eu": round(eu, 1), "ev": round(ev, 1), "pxPerM": c["pxPerM"], "want_pxPerM": round(floor * up, 1)},
                            f"within {LIMITS['ppm_match']:.0%}", f"1 m along the wall {eu:.1f} px, out from it {ev:.1f} px, up {c['pxPerM']} px "
                            f"(this camera wants {floor * up:.1f} up for {floor:.1f} along)"))
        r_u, r_v = abs(c["eu"]["y"] / c["eu"]["x"]), abs(c["ev"]["y"] / c["ev"]["x"])
        checks.append(check("court data matches the camera", max(abs(r_u - target), abs(r_v - target)) <= LIMITS["line_ratio_tol"] and abs(r_u - r_v) <= 0.02,
                            {"eu": round(r_u, 3), "ev": round(r_v, 3)}, f"{target} +/- {LIMITS['line_ratio_tol']}, the two within 0.02",
                            f"content/courts.js floor directions slope {r_u:.3f} and {r_v:.3f} down per across"))
        if c.get("hoopFront") and c.get("hoopFrontAt") and not grid["native"] and crop == (0, 0, c["size"], c["size"]):
            hf = np.asarray(Image.open(ROOT / c["hoopFront"]).convert("RGBA"))
            hg = find_grid(np.where(hf[..., 3] >= 128, hf[..., :3].mean(-1), 0.0), None)
            if not hg["native"]:
                at = (c["hoopFrontAt"]["x"], c["hoopFrontAt"]["y"])
                off = [round(((at[i] + hg["phase"][i] - grid["phase"][i]) / cell + 0.5) % 1 - 0.5, 2) for i in (0, 1)]
                checks.append(check("overlays on the court's grid", max(abs(o) for o in off) <= 0.25, {"hoopFront": off}, "within 0.25 of a cell",
                                    f"the hoop front ({c['hoopFront']}) lands {off[0]:+.2f} cells across and {off[1]:+.2f} down from the court's grid"))
        (ru, rv), arc = arc_check(c, lab, crop)
        got = [a for a in arc if a["found"] is not None]
        inside = [a for a in arc if 0 <= project(c, ru + math.cos(math.radians(a["deg"])) * a["want"], rv + math.sin(math.radians(a["deg"])) * a["want"])[0] - crop[0] < crop[2]
                  and 0 <= project(c, ru + math.cos(math.radians(a["deg"])) * a["want"], rv + math.sin(math.radians(a["deg"])) * a["want"])[1] - crop[1] < crop[3]]
        if len(inside) < 5:
            pass  # too little of the 3-point line in this crop to measure
        elif got:
            err = float(np.mean([abs(a["found"] - a["want"]) for a in got]))
            width = float(np.median([a["width_m"] for a in got]))
            checks.append(check("3-point line where courts.js says", err <= LIMITS["arc_error_m"] and len(got) >= len(arc) - 3,
                                {"mean_error_m": round(err, 3), "found": len(got), "of": len(arc), "line_width_m": round(width, 3)},
                                f"mean <= {LIMITS['arc_error_m']} m", f"painted line found at {len(got)} of {len(arc)} angles, "
                                f"{err * 100:.0f} cm from content/courts.js on average; painted line {width * 100:.0f} cm wide"))
        else:
            checks.append(check("3-point line where courts.js says", False, None, f"mean <= {LIMITS['arc_error_m']} m", "no painted line found"))
        if not grid["native"] and crop == (0, 0, c["size"], c["size"]):
            sheets = []
            for f in sorted((ROOT / "assets" / "characters").glob("**/sprites.json")):
                meta = json.loads(f.read_text())
                if meta.get("pixel"):
                    sheets.append((str(f.parent.relative_to(ROOT / "assets" / "characters")), 1 / meta["res"]))
            if sheets:
                off = [(n, px) for n, px in sheets if abs(px / cell - 1) > LIMITS["ppm_match"]]
                checks.append(check("players' pixels match the court's", not off, {n: round(px, 3) for n, px in sheets}, f"within {LIMITS['ppm_match']:.0%} of {cell:.3f}",
                                    f"{len(off)} of {len(sheets)} pixel-art player sheets draw each pixel at a different size from the court's "
                                    f"{cell:.2f} px (" + ", ".join(f"{n} {px:.2f}" for n, px in off) + ")" if off else
                                    f"all {len(sheets)} pixel-art player sheets use the court's pixel size"))
        if crop == (0, 0, c["size"], c["size"]):
            checks.extend(room_checks(c))
            checks.append(check("made of panels", bool(c.get("panels")), c.get("panels"), "a panel set (iso_panels.py)",
                                f"the court is made of folding panels ({c['panels']})" if c.get("panels") else
                                "the court is one flat image, so it can't fold up like a box"))
        lw, rw, fl = light_check(c, lab, crop)
        if lw is not None and rw is not None and fl is not None:
            checks.append(check("light from the upper left", rw > lw, {"left_wall_L": round(lw, 1), "right_wall_L": round(rw, 1), "floor_L": round(fl, 1) if fl else None},
                                "right wall lighter than left wall",
                                f"lightness: hoop (left) wall {lw:.0f}, right wall {rw:.0f}, floor {fl:.0f}"))
        marks["arc"] = (c, (ru, rv), arc)

    return {
        "ok": all(ch["ok"] for ch in checks),
        "image": str(Path(path).resolve().relative_to(ROOT)) if Path(path).resolve().is_relative_to(ROOT) else str(path),
        "crop": list(crop),
        "kind": kind,
        "grid": {k: (round(v, 3) if isinstance(v, float) else v) for k, v in grid.items()} | {"native_size": [int(native.shape[1]), int(native.shape[0])]},
        "checks": checks,
    }, (img, native, xs, ys, marks, crop)


def panels_card(path):
    from iso_panels import check_panels
    checks = check_panels(path, court_def=court_def, evaluate=lambda f, **kw: evaluate(f, **kw))
    rel = Path(path).resolve()
    return {"ok": all(c["ok"] for c in checks), "image": str(rel.relative_to(ROOT)) if rel.is_relative_to(ROOT) else str(path),
            "kind": "panels", "checks": checks}


def summary_text(card, title=None):
    if card.get("kind") == "panels":
        lines = [title or f"panels {card['image']}"]
        lines += [f"  {'pass' if ch['ok'] else 'FAIL'}  {ch['name']}: {ch['detail']}" for ch in card["checks"]]
        return "\n".join(lines)
    lines = [f"{title or card['image']}" + (f" (crop {card['crop']})" if title is None else ""),
             f"  grid: {card['grid']['cell']} px per art pixel, art is {card['grid']['native_size'][0]}x{card['grid']['native_size'][1]} at its own size"]
    for ch in card["checks"]:
        lines.append(f"  {'pass' if ch['ok'] else 'FAIL'}  {ch['name']}: {ch['detail']}")
    return "\n".join(lines)


def draw_marks(extra, path):
    img, native, xs, ys, marks, crop = extra
    out = img.convert("RGB").copy()
    # dim, then draw marks at screen positions
    out = Image.blend(out, Image.new("RGB", out.size, (0, 0, 0)), 0.35)
    d = ImageDraw.Draw(out)
    r = max(2, int((xs[1] - xs[0]) / 2) if len(xs) > 1 else 2)
    for key, col in (("thick", (255, 170, 0)), ("doubled", (0, 220, 255)), ("stray", (255, 40, 200))):
        for j, i in zip(*np.nonzero(marks[key])):
            x, y = xs[i], ys[j]
            d.rectangle([x - r, y - r, x + r, y + r], outline=col, width=2 if key == "stray" else 1)
    if "arc" in marks:
        c, (ru, rv), arc = marks["arc"]
        for a in arc:
            ang = math.radians(a["deg"])
            wx, wy = project(c, ru + math.cos(ang) * a["want"], rv + math.sin(ang) * a["want"])
            d.ellipse([wx - crop[0] - 6, wy - crop[1] - 6, wx - crop[0] + 6, wy - crop[1] + 6], outline=(0, 255, 0), width=2)
            if a["found"] is not None:
                fx, fy = project(c, ru + math.cos(ang) * a["found"], rv + math.sin(ang) * a["found"])
                d.line([fx - crop[0] - 5, fy - crop[1], fx - crop[0] + 5, fy - crop[1]], fill=(255, 0, 0), width=3)
    out.save(path)


# ---------- the test set ----------

def badness(name, v):
    """One number per check, bigger is worse, for comparing a run with the baseline (None: not compared)."""
    if v is None:
        return None
    if name == "pixel size is a whole number":
        return abs(v - round(v)) if v >= 1.5 else 0.0
    if name in ("lines match the camera", "court data matches the camera"):
        return max(abs(r - LIMITS["line_ratio"]) for r in v.values())
    if name == "overlays on the court's grid":
        return max(abs(o) for o in v["hoopFront"])
    if name == "players' pixels match the court's":
        return None
    if name == "cells are flat colour":
        return 1 - v
    if name == "on the palette":
        return v["mean"]
    if name == "3-point line where courts.js says":
        return v["mean_error_m"]
    if name == "room beside the arc":
        return -min(v.values())
    if name == "room behind the arc":
        return -v
    if name == "made of panels":
        return None
    if name == "racks fit on the floor":
        return v["off"]
    if name == "light from the upper left":
        return v["left_wall_L"] - v["right_wall_L"]
    if isinstance(v, (int, float)):
        return float(v)
    return None


def worse_than(name, new, old):
    b, a = badness(name, new), badness(name, old)
    if a is None or b is None:
        return False
    return b > a + max(abs(a) * 0.1, 0.005)


def run_testset(out, update):
    cases = json.loads((ISO / "testset.json").read_text())["cases"]
    pal_path = ISO / "palette.json"
    pal = json.loads(pal_path.read_text())["colours"] if pal_path.exists() else None
    base_path = ISO / "baseline.json"
    baseline = json.loads(base_path.read_text()) if base_path.exists() else {}
    results, report, worse = {}, [], []
    for case in cases:
        if case.get("kind") == "panels":
            card, extra = panels_card(ROOT / case["panels"]), None
        else:
            card, extra = evaluate(ROOT / case["image"], court=case.get("court"), crop=case.get("crop"), kind=case.get("kind"), palette=pal,
                                   line_ratio=case.get("line_ratio"))
        card["id"] = case["id"]
        results[case["id"]] = card
        report.append(summary_text(card, f"{case['id']}: {case.get('image') or case.get('panels')}" + (f" crop {case['crop']}" if case.get("crop") else "")))
        if out:
            (out / case["id"]).mkdir(parents=True, exist_ok=True)
            (out / case["id"] / "scorecard.json").write_text(json.dumps(card, indent=1))
            if extra:
                draw_marks(extra, out / case["id"] / "marks.png")
        old = {c["name"]: c for c in baseline.get(case["id"], {}).get("checks", [])}
        for ch in card["checks"]:
            o = old.get(ch["name"])
            if o is None:
                if not ch["ok"]:
                    worse.append(f"{case['id']}: {ch['name']} fails and isn't a known break ({ch['detail']})")
            elif o["ok"] and not ch["ok"]:
                worse.append(f"{case['id']}: {ch['name']} passed in the baseline, now fails ({ch['detail']})")
            elif worse_than(ch["name"], ch["value"], o["value"]):
                worse.append(f"{case['id']}: {ch['name']} is worse than the baseline ({ch['detail']}; was {o['value']})")
    text = "\n\n".join(report)
    text += "\n\n" + ("Worse than the baseline:\n  " + "\n  ".join(worse) if worse else "No case is worse than the baseline.")
    if update:
        base_path.write_text(json.dumps({k: {"checks": [{x: c[x] for x in ("name", "ok", "value")} for c in v["checks"]], "grid": v["grid"]} for k, v in results.items()}, indent=1) + "\n")
        text += f"\nBaseline written to {base_path.relative_to(ROOT)}."
    summary = {"ok": not worse, "checks": [{"name": k, "ok": not any(w.startswith(k + ":") for w in worse), "detail": "; ".join(c["name"] for c in v["checks"] if not c["ok"]) or "all rules pass",
                                            "images": [f"{k}/marks.png"] if out and v.get("kind") != "panels" else []} for k, v in results.items()]}
    if out:
        (out / "summary.json").write_text(json.dumps(summary, indent=1))
        (out / "summary.txt").write_text(text + "\n")
    return text, not worse


def make_palette(path, n, dest):
    """The image's n main colours at its own size (k-means in Lab), dark to light within each ramp."""
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    grid = find_grid(np.where(rgba[..., 3] >= 128, rgba[..., :3].mean(-1), 0.0), None)
    native = sample_native(rgba, grid)[0]
    rgb = native[..., :3][native[..., 3] >= 128].astype(np.float64)
    lab = srgb_to_lab(rgb)
    centres, labels = kmeans(lab, n, iters=20)
    # report each centre as the real pixel nearest to it, so every palette colour is one the art uses
    cols = []
    for j in range(len(centres)):
        m = labels == j
        if not m.any():
            continue
        k = np.argmin(((lab[m] - centres[j]) ** 2).sum(-1))
        cols.append((rgb[m][k], int(m.sum())))
    cols.sort(key=lambda c: (round(float(np.degrees(np.arctan2(*srgb_to_lab(c[0])[[2, 1]])) % 360) // 30), float(srgb_to_lab(c[0])[0])))
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"from": str(Path(path)), "note": f"the {n} main colours of {Path(path).name} at its own size "
                                "(made by iso_eval.py --make-palette); new isometric art uses these",
                                "colours": ["#%02x%02x%02x" % tuple(int(v) for v in c) for c, _ in cols],
                                "share": [round(k / len(rgb), 4) for _, k in cols]}, indent=1) + "\n")
    print(f"wrote {len(cols)} colours to {dest}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", nargs="?")
    ap.add_argument("--court")
    ap.add_argument("--crop")
    ap.add_argument("--kind", choices=["court", "prop"])
    ap.add_argument("--palette")
    ap.add_argument("--out")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--line-ratio", type=float, help=f"the camera's floor slope (default {LIMITS['line_ratio']}, the gym's)")
    ap.add_argument("--panels", metavar="FILE", help="check a court made of folding panels (see tools/pixelart/iso_panels.py)")
    ap.add_argument("--testset", action="store_true")
    ap.add_argument("--update-baseline", action="store_true")
    ap.add_argument("--make-palette", type=int, metavar="N", help="write IMAGE's N main colours (at its own size) to --palette")
    a = ap.parse_args()
    if a.make_palette:
        make_palette(a.image, a.make_palette, Path(a.palette or ISO / "palette.json"))
        return
    out = Path(a.out) if a.out else None
    if out:
        out.mkdir(parents=True, exist_ok=True)
    if a.testset:
        text, ok = run_testset(out, a.update_baseline)
        print(text)
        sys.exit(0 if ok else 1)
    if a.panels:
        card = panels_card(a.panels)
        text = summary_text(card)
        if out:
            (out / "scorecard.json").write_text(json.dumps(card, indent=1))
            (out / "summary.txt").write_text(text + "\n")
        print(json.dumps(card, indent=1) if a.json else text)
        sys.exit(0 if card["ok"] else 1)
    if not a.image:
        ap.error("give an IMAGE, --panels FILE or --testset")
    pal = None
    pp = Path(a.palette) if a.palette else ISO / "palette.json"
    if pp.exists():
        pal = json.loads(pp.read_text())["colours"]
    crop = tuple(int(v) for v in a.crop.split(",")) if a.crop else None
    card, extra = evaluate(a.image, court=a.court, crop=crop, kind=a.kind, palette=pal, line_ratio=a.line_ratio)
    text = summary_text(card)
    if out:
        (out / "scorecard.json").write_text(json.dumps(card, indent=1))
        (out / "summary.txt").write_text(text + "\n")
        draw_marks(extra, out / "marks.png")
    print(json.dumps(card, indent=1) if a.json else text)
    sys.exit(0 if card["ok"] else 1)


if __name__ == "__main__":
    main()
