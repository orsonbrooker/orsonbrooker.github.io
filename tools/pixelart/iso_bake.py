"""Turns iso_blender.py's passes into pixel art: a court's panels, flat court picture and panels.json, or a prop.

  uv run --with pillow --with numpy python3 tools/pixelart/iso_bake.py SCENE.json PASSES_DIR OUT_DIR

Every pixel knows where it is (game metres), which way it faces and what shape it is, so the look is painted
here in pixel space, on the palette (art/iso/palette.json), with light from the upper left:
  - each material has a ramp of palette colours, dark to light. Boxes (trim, window frames, the rack) take a step
    of their ramp by which way each face points;
  - patterns are worked out from the pixel's position, so their lines are clean 2:1 stairs: floor boards, the
    court markings (`markings`), and bricks (a tone per brick, a lit top edge, a shaded bottom row, dark joints);
  - anything standing out from a wall (trim, a window, a hanging banner) throws a shadow on the bricks, traced
    from each wall pixel towards the light; the floor darkens where it meets the walls;
  - balls are the game's own ball sprite (engine/draw.js makeBallSprite, ported below), at the game's size, in
    its own colours (in the palette as the ball's colours), set in by depth so a rail in front stays in front;
  - outlines are one pixel, only where depth changes (round the outside, or where a shape is in front of
    another), never along a hinge, coloured a dark shade of the shape in front; doubled corners are taken out;
  - every other colour is snapped to the nearest palette colour in CIE Lab.

A court scene places props (art/iso/props/<name>/) with `props`: each is baked on its own first (a prop scene
has "prop": true), and the court puts its picture for the way it stands at its foot. A prop carries its own
shadow on the floor, as see-through dark pixels, so it can stand on any court.
"""
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from iso_eval import ROOT, nearest, srgb_to_lab  # noqa: E402
from iso_scene import expand_prop  # noqa: E402

# Ramps, dark to light, all from art/iso/palette.json (the gym's colours).
RAMPS = {
    "wood": ["#a0574b", "#b66439", "#bb714f", "#cd7e4e", "#d48651", "#dd9257"],
    "blue": ["#3b3876", "#3d5a99", "#356098"],
    "line": ["#e9ccbb", "#f9f5f0"],
    "brick": ["#532837", "#6e3b3c", "#8b4541", "#a0574b", "#b46d63", "#bb714f"],
    "skirting": ["#6e3b3c", "#876066", "#a5788e", "#af8a7e"],
    "cap": ["#6e3b3c", "#876066", "#af8a7e", "#c89169", "#e9ccbb"],
    "frame": ["#5f5d77", "#877e8f", "#959cb7", "#e9ccbb", "#f9f5f0"],
    "glass": ["#356098", "#afd1e0", "#f9f5f0"],
    "metal": ["#5f5d77", "#877e8f", "#959cb7", "#afd1e0"],
    "banner": ["#3b3876", "#3d5a99", "#356098", "#afd1e0"],
    "pennant": ["#180826", "#3d654c", "#e9ccbb"],
    "board": ["#403751", "#5f5d77", "#877e8f", "#959cb7"],
}
# The scoreboard's face: what the game lights is the digits' segments; the art has them unlit.
FACE = {"face": "#403751", "window": "#180826", "unlit": "#532837", "lit": "#d0553c", "label": "#e9ccbb"}
OUTLINE = {"wood": "#532837", "blue": "#180826", "line": "#532837", "brick": "#400c22", "skirting": "#1e0418",
           "cap": "#400c22", "frame": "#180826", "glass": "#180826", "metal": "#180826", "banner": "#180826",
           "pennant": "#180826", "board": "#180826", "scoreface": "#180826"}
SHADOW = ("#180826", 84)  # a prop's shadow on the floor: this colour, this opaque (0-255)
JOINED_M = 0.15  # parts of one material this close in depth are joined (a rail meeting a post): no line between
HINGE_M = 0.06  # a pixel this close to a hinge line belongs to the hinge: no outline there
BACK = np.array([math.cos(math.radians(30)) * math.cos(math.radians(45))] * 2 + [math.sin(math.radians(30))])

# ---------- the game's ball (engine/draw.js, content/looks.js) ----------

BALL_LOOKS = {
    "normal": {"main": "#de6d2b", "shade": "#b5501d", "shine": "#f39a55", "seam": "#5b2a12", "edge": "#3a1a10"},
    "money": {"main": "#f0b424", "shade": "#c48412", "shine": "#fff3a6", "seam": "#7a4a08", "edge": "#4a2c08"},
}
TURNED, SIDE_SEAM = 0.55, 0.68
_l = np.array([-0.4, -0.5, 0.77])
BALL_LIGHT = _l / np.linalg.norm(_l)
GAME_BALL_PX = 24  # engine/draw.js BALL_PX: the sprite square; the ball fills all but half a pixel round it


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.uint8)


def _rgbf(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)


def _on_ball(nx, ny, turn):
    nz = math.sqrt(max(0.0, 1 - nx * nx - ny * ny))
    x, y, z = nx, ny, nz
    y, z = y * math.cos(turn) - z * math.sin(turn), y * math.sin(turn) + z * math.cos(turn)
    return x * math.cos(TURNED) + z * math.sin(TURNED), y


def ball_sprite(size, look, turn):
    """engine/draw.js makeBallSprite (rolling over, not sideways), at `size` pixels: RGBA uint8."""
    L = BALL_LOOKS[look]
    out = np.zeros((size, size, 4), np.uint8)
    mid = (size - 1) / 2
    R = size / 2 - 0.5
    edge, seam_c = _rgbf(L["edge"]), _rgbf(L["seam"])
    base, light, dark = _rgbf(L["main"]), _rgbf(L["shine"]), _rgbf(L["shade"])

    def mix(a, b, t):
        return a + (b - a) * t

    def corner(x, y):
        return _on_ball((x - 0.5 - mid) / R, (y - 0.5 - mid) / R, turn)

    def crosses(vals, at):
        return min(vals) < at <= max(vals)
    for y in range(size):
        for x in range(size):
            nx, ny = (x - mid) / R, (y - mid) / R
            r2 = nx * nx + ny * ny
            if r2 > 1:
                continue
            nz = math.sqrt(1 - r2)
            lit = max(0.0, nx * BALL_LIGHT[0] + ny * BALL_LIGHT[1] + nz * BALL_LIGHT[2])
            col = mix(base, light, 0.55) if lit > 0.86 else base if lit > 0.42 else dark if lit > 0.16 else mix(dark, edge, 0.4)
            if lit > 0.985:
                col = _rgbf(L["shine"])
            cs = [corner(x, y), corner(x + 1, y), corner(x, y + 1), corner(x + 1, y + 1)]
            across, down = [p[0] for p in cs], [p[1] for p in cs]
            if crosses(across, 0) or crosses(across, SIDE_SEAM) or crosses(across, -SIDE_SEAM) or crosses(down, 0):
                col = mix(seam_c, edge, 0 if lit > 0.42 else 0.5)
            if r2 > ((R - 1) / R) ** 2:
                col = edge
            out[y, x, :3] = np.clip(np.round(col), 0, 255)
            out[y, x, 3] = 255
    return out


def ball_colours(size=16):
    """Every colour the game's normal and money balls use at this size (for the palette)."""
    seen = set()
    for look in BALL_LOOKS:
        for i in range(16):
            s = ball_sprite(size, look, i / 16 * 2 * math.pi)
            for c in s[s[..., 3] > 0][:, :3]:
                seen.add("#%02x%02x%02x" % tuple(int(v) for v in c))
    return sorted(seen)


# ---------- painting ----------

def band(d, n):
    """0..n-1 from how much a surface faces the light (d in -1..1)."""
    return np.clip(((d + 0.15) / 1.0 * n).astype(int), 0, n - 1)


def in_poly(a, b, pts):
    """Which of the points (a, b) are inside the polygon pts [(a, b), ...] (even-odd rule)."""
    inside = np.zeros(a.shape, bool)
    n = len(pts)
    for i in range(n):
        (a0, b0), (a1, b1) = pts[i], pts[(i + 1) % n]
        if b0 == b1:
            continue
        crosses = (b0 > b) != (b1 > b)
        at = a0 + (b - b0) * (a1 - a0) / (b1 - b0)
        inside ^= crosses & (a < at)
    return inside


def wall_coords(face, p):
    """(along, out, up) for points on a wall: along it, out from it, up."""
    p = np.asarray(p, float)
    return (p[..., 0], p[..., 1], p[..., 2]) if face == "hoop" else (p[..., 1], p[..., 0], p[..., 2])


def wall_shadow(sc, panel, face, P, light):
    """Wall pixels in the shadow of anything standing out from that wall, traced from each point towards the light."""
    k = 1 if face == "hoop" else 0  # the axis that points out of the wall
    hit = np.zeros(P.shape[:2], bool)
    if light[k] <= 0:
        return hit
    for s in sc["shapes"]:
        if s["panel"] != panel or s["material"] == "brick":
            continue
        if s["shape"] == "poly" and s.get("hang"):
            Q = P + (s["hang"] / light[k]) * light
            a, _, c = wall_coords(face, Q)
            pts = [(float(wall_coords(face, p)[0]), float(wall_coords(face, p)[2])) for p in s["points"]]
            hit |= in_poly(a, c, pts)
        elif s["shape"] == "box":
            mn, mx = np.array(s["min"]), np.array(s["max"])
            for t in np.linspace(0.005, mx[k] / light[k], 24):
                Q = P + t * light
                hit |= np.all((Q >= mn - 1e-6) & (Q <= mx + 1e-6), axis=-1)
    return hit


def edges(m):
    """The top, left, right and bottom edge pixels of a mask."""
    return (m & ~np.roll(m, 1, axis=0), m & ~np.roll(m, 1, axis=1), m & ~np.roll(m, -1, axis=1), m & ~np.roll(m, -1, axis=0))


def paint(sc, panel, pas, light):
    alpha = pas["alpha"] > 0.5
    pos, nrm, ids = pas["pos"], pas["nrm"], pas["id"]
    h, w = alpha.shape
    rgb = np.zeros((h, w, 3), np.uint8)
    mat = np.full((h, w), "", dtype=object)
    up = sc["upArtPerM"]
    u, v, z = pos[..., 0] + 1e-4, pos[..., 1] + 1e-4, pos[..., 2] + 1e-4
    d = (nrm * np.array(light)).sum(-1)

    def ramp(name):
        return np.stack([hexrgb(c) for c in RAMPS[name]])
    for i, s in enumerate(sc["shapes"]):
        m = alpha & (ids == i + 1)
        if not m.any():
            continue
        name = s["material"]
        mat[m] = name
        R = ramp(name) if name in RAMPS else None
        face = s.get("face")
        if name == "wood":
            # boards 0.25 m wide running out from the hoop wall, 1.5 m long, ends staggered board to board
            board = np.floor(u * 4).astype(int)
            seg = np.floor((v + (board * 0.55) % 1.5) / 1.5).astype(int)
            key = board * 1000 + seg
            out = R[3 + (key * 7 + 3) % 3]  # one of the three lightest
            # a seam where the board (or plank) changes from the pixel above: a one-pixel 2:1 stair
            seam = (key != np.roll(key, 1, axis=0)) & np.roll(alpha, 1, axis=0)
            out[seam] = R[1]
            # the court markings, in order: painted over the boards (seams show through the blue, not the lines)
            for mk in sc.get("markings", []):
                on = np.zeros_like(alpha)
                for u0, v0, u1, v1 in mk["rects"]:
                    on |= (u >= u0) & (u < u1) & (v >= v0) & (v < v1)
                Rm = ramp(mk["material"])
                out[on] = Rm[-1] if mk["material"] == "line" else Rm[1]
                if mk["material"] != "line":
                    out[on & seam] = Rm[0]
                mat[m & on] = mk["material"]
            # the floor darkens where it meets the walls
            near = ((u < 2 / 24) | (v < 2 / 24)) & (mat == "wood")
            out[near] = R[1]
            rgb[m] = out[m]
        elif name == "brick":
            along = u if face == "hoop" else v
            zp = np.floor(z * up).astype(int)  # whole art pixels up the wall
            course, row = zp // 5, zp % 5  # five pixels a course: a joint, then four of brick
            brick = np.floor((along + (course % 2) * 0.25) / 0.5).astype(int)
            lit = 1 if face == "side" else 0  # the side wall faces the light, the hoop wall away from it
            vary = ((brick * 7 + course * 3) % 5 == 0).astype(int) - ((brick * 5 + course * 11) % 7 == 0).astype(int)
            tone = 2 + lit + vary
            tone = tone + (row == 4) - (row == 1)  # the top edge catches the light, the bottom row is in shadow
            # darker into the back corner and up under the top trim, where less light gets in
            tone = tone - (along < 0.25) - (z > sc["wallHeightPx"] / up - 0.5)
            tone = np.maximum(tone, 1)
            tone = np.clip(tone, 0, len(R) - 1)
            out = R[tone]
            joint = (brick != np.roll(brick, 1, axis=1)) & np.roll(alpha, 1, axis=1) & (np.roll(ids, 1, axis=1) == ids)
            groove = (row == 0) | joint
            out[groove] = R[lit + 1]  # a step darker than the brick, not as dark as an outline
            # shadows of what stands out from the wall
            sh = wall_shadow(sc, panel, face, pos, np.array(light)) & m
            out[sh] = R[np.clip(tone[sh] - 2, 1, None)]  # never as dark as an outline
            out[sh & groove] = R[lit + 1]
            rgb[m] = out[m]
        elif name in ("banner", "pennant"):
            a, _, c = wall_coords(face, pos)
            if name == "banner":
                out = np.broadcast_to(R[1 + (face == "side")], (h, w, 3)).copy()
                top_c = max(float(wall_coords(face, p)[2]) for p in s["points"])
                out[(c > top_c - 0.19) & (c < top_c - 0.12)] = hexrgb("#f9f5f0")  # a light stripe
                ba, _, bc = wall_coords(face, s.get("badge", [0, 0, 0]))
                rr = (a - ba) ** 2 + (c - bc) ** 2  # and a ball
                out[rr < 0.14 ** 2] = hexrgb("#d0553c")
                out[rr < 0.06 ** 2] = hexrgb("#dd9257")
                out[(rr < 0.14 ** 2) & (np.abs(c - bc) < 0.015)] = hexrgb("#532837")
                lt = hexrgb(RAMPS["banner"][-1])
            else:
                out = np.broadcast_to(R[1], (h, w, 3)).copy()
                a0 = min(float(wall_coords(face, p)[0]) for p in s["points"])
                cs_ = [float(wall_coords(face, p)[2]) for p in s["points"]]
                mid_c = (max(cs_) + min(cs_)) / 2
                out[(c > mid_c - 0.03) & (c < mid_c + 0.03) & (a < a0 + 0.8)] = hexrgb("#e9ccbb")
                out[a < a0 + s.get("hoist", 0.1)] = hexrgb("#f9f5f0")  # the white strip it hangs by
                lt = hexrgb("#e9ccbb")
            # cloth: lit along its top and left edges, a shade darker along the right and bottom
            top, lft, rgt, bot = edges(m)
            out[(top | lft) & ~(rgt | bot)] = lt
            out[rgt | bot] = R[0]
            rgb[m] = out[m]
        elif name == "scoreface":
            rgb[m] = scoreface(sc, s, pos, face, h, w)[m]
        elif name == "glass":
            a, _, c = wall_coords(face, pos)
            pts = [wall_coords(face, p) for p in s["points"]]
            a0, a1 = min(float(p[0]) for p in pts), max(float(p[0]) for p in pts)
            c0, c1 = min(float(p[2]) for p in pts), max(float(p[2]) for p in pts)
            na, nc = s.get("panes", [1, 1])
            pa, pc = (a - a0) / (a1 - a0) * na, (c - c0) / (c1 - c0) * nc
            fa, fc = pa % 1, pc % 1
            out = np.broadcast_to(R[1], (h, w, 3)).copy()
            out[np.abs(fa + fc - 1.15) < 0.12] = R[2]  # a light streak across each pane
            out[(fc > 0.78) | (fa < 0.12)] = R[0]  # the frame's shade along each pane's top and side
            bars = (np.abs(pa - np.round(pa)) * (a1 - a0) / na < 0.03) | (np.abs(pc - np.round(pc)) * (c1 - c0) / nc < 0.03)
            out[bars] = hexrgb(RAMPS["frame"][3])
            rgb[m] = out[m]
        else:  # boxes (trim, frames, the rack): a step of the ramp by which way the face points
            out = R[band(d, len(R))]
            if name in ("cap", "frame"):
                out[nrm[..., 2] > 0.9] = R[-1]  # their tops catch the light
            rgb[m] = out[m]
    return rgb, mat, alpha


FONT = {  # 3x5 pixel letters (M is 5 wide), for labels painted on a wall
    "S": ["111", "100", "111", "001", "111"], "C": ["111", "100", "100", "100", "111"],
    "O": ["111", "101", "101", "101", "111"], "R": ["110", "101", "110", "101", "101"],
    "E": ["111", "100", "110", "100", "111"], "T": ["111", "010", "010", "010", "010"],
    "I": ["111", "010", "010", "010", "111"], "M": ["10001", "11011", "10101", "10001", "10001"],
}
SEGMENTS = "abcdefg"
DIGIT_SEGS = {"0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc",
              "7": "abc", "8": "abcdefg", "9": "abcdfg"}
DIGIT_W, DIGIT_H, GAP, PAD, LABEL_GAP = 8, 15, 2, 2, 2  # face pixels: one along the wall is 1/24 m, one up is 1 px


def segment_rects(n):
    """The seven segments of a digit cell, as (r0, c0, r1, c1) face pixels from its bottom left (c counts up)."""
    w, h, t = DIGIT_W, DIGIT_H, 2
    mid = h // 2
    return {"a": (0, h - t, w, h), "g": (0, mid - 1, w, mid + 1), "d": (0, 0, w, t),
            "f": (0, mid, t, h), "b": (w - t, mid, w, h), "e": (0, 0, t, mid), "c": (w - t, 0, w, mid)}


def face_layout(windows):
    """Where each window, its label and its digit cells go on a scoreboard face, in face pixels: r along the
    reading direction (left to right on screen), c up from the face's bottom. Returns (layout, width, height)."""
    r, out = 3, []
    for wdef in windows:
        ww = wdef["digits"] * DIGIT_W + (wdef["digits"] - 1) * GAP + 2 * PAD
        win = (r, 3, r + ww, 3 + DIGIT_H + 2 * PAD)
        cells = [(r + PAD + i * (DIGIT_W + GAP), 3 + PAD) for i in range(wdef["digits"])]
        lw = sum(len(FONT[ch][0]) for ch in wdef["label"]) + len(wdef["label"]) - 1
        out.append({**wdef, "window": win, "cells": cells, "labelAt": (r + (ww - lw) // 2, win[3] + LABEL_GAP)})
        r += ww + 4
    return out, r - 1, 3 + DIGIT_H + 2 * PAD + LABEL_GAP + 5 + 3


def scoreface(sc, s, pos, face, h, w):
    """A scoreboard's face, painted in its own pixels on the wall: windows, unlit digit segments (the game lights
    them), labels above. Lit with the scene's `lit` digits for a preview."""
    a, _, c = wall_coords(face, pos)
    pts = [wall_coords(face, p) for p in s["points"]]
    a0, a1 = min(float(p[0]) for p in pts), max(float(p[0]) for p in pts)
    c0 = min(float(p[2]) for p in pts)
    apm, up = sc["artPerM"], sc["upArtPerM"]
    # reading left to right on screen: along the hoop wall that's towards smaller u, along the side wall larger v
    r = np.floor(((a1 - a) if face == "hoop" else (a - a0)) * apm).astype(int)
    cc = np.floor((c - c0) * up).astype(int)
    out = np.broadcast_to(hexrgb(FACE["face"]), (h, w, 3)).copy()
    layout, _, _ = face_layout(s["windows"])
    for wd in layout:
        r0, c0_, r1, c1 = wd["window"]
        out[(r >= r0) & (r < r1) & (cc >= c0_) & (cc < c1)] = hexrgb(FACE["window"])
        show = (wd.get("show", "") if sc.get("_lit") else "").rjust(wd["digits"])
        for (rx, cy), ch in zip(wd["cells"], show):
            for seg, (q0, d0, q1, d1) in segment_rects(DIGIT_W).items():
                on = (r >= rx + q0) & (r < rx + q1) & (cc >= cy + d0) & (cc < cy + d1)
                out[on] = hexrgb(FACE["lit"] if seg in DIGIT_SEGS.get(ch, "") else FACE["unlit"])
        lx, ly = wd["labelAt"]
        for ch in wd["label"]:
            g = FONT[ch]
            for j, row in enumerate(g):
                for i, bit in enumerate(row):
                    if bit == "1":
                        out[(r == lx + i) & (cc == ly + 4 - j)] = hexrgb(FACE["label"])
            lx += len(g[0]) + 1
    return out


def add_balls(sc, panel, rgb, mat, alpha, ids, depth):
    """Sets the game's ball sprite in for each ball of this panel, by depth."""
    ox, oy = sc["origin"]
    apm, up = sc["artPerM"], sc["upArtPerM"]
    h, w = alpha.shape
    for i, s in enumerate(sc["shapes"]):
        if s["panel"] != panel or s["shape"] != "ball":
            continue
        cu, cv, cz = s["centre"]
        cx, cy = ox + apm * (cv - cu), oy + apm / 2 * (cu + cv) - cz * up
        across = s["r"] * 2 * apm / math.cos(math.radians(45))  # the ball's width on screen, art px
        size = int(round(across * GAME_BALL_PX / (GAME_BALL_PX - 1)))  # the sprite square, as the game's fills it
        spr = ball_sprite(size, s.get("look", "normal"), s.get("turn", 0.0))
        x0, y0 = int(round(cx - size / 2)), int(round(cy - size / 2))
        mid, rr = (size - 1) / 2, size / 2 - 0.5
        cd = float(np.dot(s["centre"], BACK))
        for j in range(size):
            for k in range(size):
                Y, X = y0 + j, x0 + k
                if spr[j, k, 3] == 0 or not (0 <= Y < h and 0 <= X < w):
                    continue
                bd = cd + s["r"] * math.sqrt(max(0.0, 1 - ((k - mid) ** 2 + (j - mid) ** 2) / rr ** 2))
                if alpha[Y, X] and depth[Y, X] > bd:
                    continue
                rgb[Y, X] = spr[j, k, :3]
                alpha[Y, X] = True
                mat[Y, X] = "ball"
                ids[Y, X] = 10000 + i
                depth[Y, X] = bd


def outlines(kind, plane, rgb, mat, alpha, ids, depth, pos):
    """One-pixel outlines where depth changes, coloured from the shape in front, then doubled corners removed."""
    h, w = alpha.shape
    line = np.zeros((h, w), bool)
    col = np.zeros((h, w, 3), np.uint8)
    rgba_alpha = alpha.copy()
    # the ball's own dark edge already outlines it: a rail in front doesn't draw a second line onto it
    dark_ball = (mat == "ball") & (srgb_to_lab(rgb.astype(float))[..., 0] < 30)

    def on_hinge(y, x):
        u, v, z = pos[y, x]
        if kind == "floor":
            return u < HINGE_M or v < HINGE_M
        if kind == "wall":
            return z < HINGE_M or (u < HINGE_M if plane == "hoop" else v < HINGE_M)
        return False

    for y in range(h):
        for x in range(w):
            if alpha[y, x]:
                # in front of something further back (a different shape): the pixel behind gets the line. The
                # ball has its own edge, so it draws none
                if mat[y, x] not in OUTLINE:
                    continue
                for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and alpha[yy, xx] and ids[yy, xx] != ids[y, x] \
                            and depth[y, x] - depth[yy, xx] > (JOINED_M if mat[yy, xx] == mat[y, x] else 0.01) \
                            and not dark_ball[yy, xx]:
                        line[yy, xx] = True
                        col[yy, xx] = hexrgb(OUTLINE[mat[y, x]])
                continue
            # an empty pixel beside the shape: the silhouette's outline goes here (outside), unless that edge is a
            # hinge or a ball
            best = None
            for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and alpha[yy, xx] and mat[yy, xx] != "ball" and not on_hinge(yy, xx):
                    if best is None or depth[yy, xx] > depth[best]:
                        best = (yy, xx)
            if best is not None:
                line[y, x] = True
                col[y, x] = hexrgb(OUTLINE.get(mat[best], OUTLINE["wood"]))
                rgba_alpha[y, x] = True
    # doubled corners: a line pixel with one line neighbour beside and one above/below, the diagonal between them
    # empty, on a staircase - the line joins up without it
    changed = True
    while changed:
        changed = False
        p = np.pad(line, 2)

        def at(dy, dx):
            return p[2 + dy:p.shape[0] - 2 + dy, 2 + dx:p.shape[1] - 2 + dx]
        drop = np.zeros_like(line)
        for sx in (-1, 1):
            for sy in (-1, 1):
                drop |= line & at(0, sx) & at(sy, 0) & ~at(0, -sx) & ~at(-sy, 0) & ~at(sy, sx) & (~at(0, 2 * sx) | ~at(2 * sy, 0))
        ys, xs = np.nonzero(drop)
        for y, x in zip(ys, xs):
            if line[y, x]:
                line[y, x] = False
                if not alpha[y, x]:
                    rgba_alpha[y, x] = False
                changed = True
                break
    out = rgb.copy()
    out[line] = col[line]
    mat = mat.copy()
    mat[line] = "outline"
    return out, rgba_alpha, mat


def snap(rgb, alpha, mat, palette):
    pal = np.stack([hexrgb(c) for c in palette])
    todo = alpha & (mat != "ball")  # the ball keeps the game's own colours
    out = rgb.copy()
    if todo.any():
        idx, _ = nearest(srgb_to_lab(rgb[todo]), srgb_to_lab(pal))
        out[todo] = pal[idx]
    return out


def bake_panel(sc, name, pas, light, palette):
    q = sc["panels"][name]
    rgb, mat, alpha = paint(sc, name, pas, light)
    ids = pas["id"].copy()
    pos = pas["pos"]
    depth = np.where(alpha, (pos * BACK).sum(-1), -1e9)
    add_balls(sc, name, rgb, mat, alpha, ids, depth)
    rgb, alpha, mat = outlines(q["kind"], q.get("plane"), rgb, mat, alpha, ids, depth, pos)
    return snap(rgb, alpha, mat, palette), alpha


def crop(rgb, alpha, k, under=None):
    """The panel cut to what it covers, blown up k times; under: an RGBA layer beneath it (a shadow)."""
    full = np.zeros(alpha.shape + (4,), np.uint8)
    if under is not None:
        full[:] = under
    full[alpha, :3] = rgb[alpha]
    full[alpha, 3] = 255
    ys, xs = np.nonzero(full[..., 3])
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    img = Image.fromarray(full[y0:y1, x0:x1]).resize(((x1 - x0) * k, (y1 - y0) * k), Image.NEAREST)
    return img, int(x0), int(y0)


def prop_shadow(sc, name, light):
    """A prop's shadow on the floor (z = 0): each floor pixel traced towards the light."""
    cw, ch = sc["canvas"]
    ox, oy = sc["origin"]
    apm = sc["artPerM"]
    ys, xs = np.mgrid[0:ch, 0:cw] + 0.5
    vmu, upv = (xs - ox) / apm, (ys - oy) / (apm / 2)
    P = np.stack([(upv - vmu) / 2, (upv + vmu) / 2, np.zeros_like(xs)], -1)
    hit = np.zeros((ch, cw), bool)
    shapes = [s for s in sc["shapes"] if s["panel"] == name]
    top = max((s["max"][2] if s["shape"] == "box" else s["centre"][2] + s["r"]) for s in shapes)
    for t in np.linspace(0.01, top / light[2], 48):
        Q = P + t * light
        for s in shapes:
            if s["shape"] == "box":
                hit |= np.all((Q >= np.array(s["min"])) & (Q <= np.array(s["max"])), axis=-1)
            else:
                hit |= ((Q - np.array(s["centre"])) ** 2).sum(-1) <= s["r"] ** 2
    layer = np.zeros((ch, cw, 4), np.uint8)
    layer[hit, :3] = hexrgb(SHADOW[0])
    layer[hit, 3] = SHADOW[1]
    return layer


def prop_wall_shadow(sc, name, light):
    """A wall prop's shadow on its wall: each wall pixel traced towards the light."""
    cw, ch = sc["canvas"]
    ox, oy = sc["origin"]
    apm, up = sc["artPerM"], sc["upArtPerM"]
    ys, xs = np.mgrid[0:ch, 0:cw] + 0.5
    if name == "along-u":  # the hoop wall, v = 0
        u = -(xs - ox) / apm
        P = np.stack([u, np.zeros_like(u), (oy + apm / 2 * u - ys) / up], -1)
    else:  # the side wall, u = 0
        v = (xs - ox) / apm
        P = np.stack([np.zeros_like(v), v, (oy + apm / 2 * v - ys) / up], -1)
    k = 1 if name == "along-u" else 0
    shapes = [s for s in sc["shapes"] if s["panel"] == name and s["shape"] == "box"]
    deep = max(s["max"][k] for s in shapes)
    hit = np.zeros((ch, cw), bool)
    for t in np.linspace(0.005, deep / light[k], 24):
        Q = P + t * light
        for s in shapes:
            hit |= np.all((Q >= np.array(s["min"])) & (Q <= np.array(s["max"])), axis=-1)
    layer = np.zeros((ch, cw, 4), np.uint8)
    layer[hit, :3] = hexrgb(SHADOW[0])
    layer[hit, 3] = SHADOW[1]
    return layer


def bake_prop(sc, passes, out, light, palette):
    k = sc["scale"]
    ox, oy = sc["origin"]
    stem = sc.get("id", out.name)
    info = {"note": sc.get("note", ""), "scale": k, "orientations": {}}
    wall = sc.get("mount") == "wall"
    info["mount"] = "wall" if wall else "floor"
    for name in sc["panels"]:
        pas = dict(np.load(passes / f"{name}.npz"))
        rgb, alpha = bake_panel(sc, name, pas, light, palette)
        shadow = prop_wall_shadow(sc, name, light) if wall else prop_shadow(sc, name, light)
        img, x0, y0 = crop(rgb, alpha, k, shadow)
        img.save(out / f"{stem}-{name}.webp", lossless=True)
        if any(s["shape"] == "poly" and s.get("windows") for s in sc["shapes"]):
            # a preview with digits lit, for looking at; the game lights them itself
            sc["_lit"] = True
            rgb2, alpha2 = bake_panel(sc, name, pas, light, palette)
            sc["_lit"] = False
            crop(rgb2, alpha2, k, shadow)[0].save(out / f"{stem}-{name}-lit-preview.webp", lossless=True)
        boxes = [s for s in sc["shapes"] if s["panel"] == name and s["shape"] == "box"]
        lo = [round(min(s["min"][i] for s in boxes), 4) for i in (0, 1, 2)]
        hi = [round(max(s["max"][i] for s in boxes), 4) for i in (0, 1, 2)]
        # it folds flat onto its panel about its back edge: a floor prop the long edge nearer the wall it runs along,
        # a wall prop its bottom edge on the wall (game metres from its foot, u v z)
        if wall:
            hinge = [[lo[0], 0, lo[2]], [hi[0], 0, lo[2]]] if name == "along-u" else [[0, lo[1], lo[2]], [0, hi[1], lo[2]]]
        else:
            hinge = [[lo[0], lo[1], 0], [hi[0], lo[1], 0]] if name == "along-u" else [[lo[0], lo[1], 0], [lo[0], hi[1], 0]]
        e = {"image": f"{stem}-{name}.webp",
             "foot": [(ox - x0) * k, (oy - y0) * k],  # where its foot is in the image, court px from the top left
             "footprint": [lo, hi], "hinge": hinge, "height": hi[2]}
        if wall:
            e["wall"] = "hoop" if name == "along-u" else "side"
        face = next((s for s in sc["shapes"] if s["panel"] == name and s.get("windows")), None)
        if face:
            # where the game lights digits: the face's corner on the wall (metres from the foot: along, up), which
            # way reading goes along the wall, and each window's digit cells in face pixels (1/24 m along, 1 px up)
            layout, fw, fh = face_layout(face["windows"])
            pts = [wall_coords(e["wall"], p) for p in face["points"]]
            al = [float(p[0]) for p in pts]
            e["face"] = {"start": [max(al) if name == "along-u" else min(al), min(float(p[2]) for p in pts)],
                         "reading": -1 if name == "along-u" else 1, "size": [fw, fh],
                         "segments": segment_rects(DIGIT_W), "digit": [DIGIT_W, DIGIT_H],
                         "windows": [{"id": wd["id"], "cells": wd["cells"]} for wd in layout],
                         "colours": {"lit": FACE["lit"], "unlit": FACE["unlit"]}}
        info["orientations"][name] = e
    (out / "prop.json").write_text(json.dumps(info, indent=1) + "\n")
    print(f"wrote {len(info['orientations'])} pictures and prop.json to {out}")


def bake_court(sc, passes, out, light, palette):
    k = sc["scale"]
    up = sc["upArtPerM"]
    cw, ch = sc["canvas"]
    ox, oy = sc["origin"]
    apm = sc["artPerM"]
    flat = Image.new("RGBA", (cw * k, ch * k), (0, 0, 0, 0))
    geo = {"origin": {"x": ox * k, "y": oy * k}, "eu": {"x": -apm * k, "y": apm // 2 * k},
           "ev": {"x": apm * k, "y": apm // 2 * k}, "room": sc["room"], "pxPerM": up * k, "size": cw * k}

    def court_px(u_, v_, z_=0.0):
        # on the art grid: whole art pixels, then blown up
        return [round(ox + apm * (v_ - u_)) * k, round(oy + apm / 2 * (u_ + v_) - z_ * up) * k]
    U, V = sc["room"]["u"], sc["room"]["v"]
    names = {"floor": "floor.webp", "wall-hoop": "wall-hoop.webp", "wall-side": "wall-side.webp"}
    entries = []
    for name, q in sc["panels"].items():
        pas = dict(np.load(passes / f"{name}.npz"))
        rgb, alpha = bake_panel(sc, name, pas, light, palette)
        img, x0, y0 = crop(rgb, alpha, k)
        img.save(out / names[name], lossless=True)
        flat.alpha_composite(img, (x0 * k, y0 * k))
        e = {"id": name, "kind": q["kind"], "image": names[name], "at": [x0 * k, y0 * k], "order": len(entries)}
        if q["kind"] == "wall":
            e["plane"] = q["plane"]
            e["hinge"] = [court_px(0, 0), court_px(U, 0) if q["plane"] == "hoop" else court_px(0, V)]
        entries.append(e)
    # props: their own pictures (baked first, on their own), stood at their foot
    for pr in sc.get("props", []):
        folder = ROOT / pr["prop"]
        o = json.loads((folder / "prop.json").read_text())["orientations"][pr["along"]]
        on = pr.get("on", "floor")
        f = pr["foot"]  # [u, v] on the floor, [u, z] on the hoop wall, [v, z] on the side wall
        base = {"floor": (f[0], f[1], 0.0), "wall-hoop": (f[0], 0.0, f[1]), "wall-side": (0.0, f[0], f[1])}[on]
        fx, fy = court_px(*base)
        at = [fx - o["foot"][0], fy - o["foot"][1]]
        flat.alpha_composite(Image.open(folder / o["image"]).convert("RGBA"), tuple(at))
        entries.append({"id": pr["id"], "kind": "prop", "prop": pr["prop"], "along": pr["along"],
                        "image": os.path.relpath(folder / o["image"], out), "at": at, "order": len(entries),
                        "on": on, "foot": [round(x, 4) for x in f],
                        "hinge": [court_px(base[0] + a, base[1] + b, base[2] + c) for a, b, c in o["hinge"]]})
    flat.save(out / "court.webp", lossless=True)
    manifest = {"note": sc.get("note", ""), "geometry": geo, "scale": k, "wallHeight": sc["wallHeightPx"] / up,
                "needs": sorted({e["kind"] + (":" + e["plane"] if e.get("plane") else "") for e in entries if e["kind"] != "prop"}),
                "image": "court.webp", "panels": entries}
    (out / "panels.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"wrote {len(entries)} panels and court.webp to {out}")


def main():
    scene_path, passes, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    sc = expand_prop(json.loads(scene_path.read_text()))
    sc["upArtPerM"] = json.loads((passes / "camera.json").read_text())["upArtPerM"]
    palette = json.loads((ROOT / "art/iso/palette.json").read_text())["colours"]
    L = np.array(sc["light"], float)
    L /= np.linalg.norm(L)
    out.mkdir(parents=True, exist_ok=True)
    (bake_prop if sc.get("prop") else bake_court)(sc, passes, out, L, palette)


if __name__ == "__main__":
    main()
