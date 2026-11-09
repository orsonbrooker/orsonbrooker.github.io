"""The shared body every layered player is built on, from Orson's pixel-art sheet.

  python tools/pixelart/rig.py

Reads assets/characters/orson-pixel (his frames from video) and writes:
  assets/characters/rig/body.png   his frames with his head taken off (same places, same palette)
  assets/characters/rig/rig.json   his sheet's frames, faces, palette and release points, plus for
                                   every frame where the head goes (its middle), which way it faces,
                                   and for each drawn facing the square a head image fills
  art/heads/template-orson.png     his head in the five drawn facings (front, front-right, right,
                                   back-right, back), 512 px squares on green: the guide for making
                                   new heads (art/heads/README.md)
  art/heads/head-orson.png         the same, so his own head can be put back on as a check

Left-facing frames use the right-facing head, flipped. Frames whose move isn't named by its facing
(the turns, standing) are matched to the nearest facing by the shape of his head.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

PIX = Path("assets/characters/orson-pixel")
DET = Path("assets/characters/orson-detail")
OUT = Path("assets/characters/rig")
HEADS = Path("art/heads")
SKIN = list(range(1, 6))
HAIR = list(range(6, 11))
JERSEY = list(range(11, 16))
TEAM = list(range(16, 21))
BALL = [26, 29, 30, 36, 37]  # the ball's own oranges
DRAWN = ["f", "fr", "r", "br", "b"]
MIRROR = {"l": "r", "fl": "fr", "bl": "br"}
DIRS = ["f", "fr", "r", "br", "b", "bl", "l", "fl"]
REF = {d: (f"dribble-{d}" if d != "f" else "run-f") for d in DRAWN}  # the frame each facing's guide comes from
CELL = 512  # guide square, in the guide image's pixels
GREEN = (0, 177, 64)


def grow(mask, n=1):
    m = mask.copy()
    for _ in range(n):
        g = m.copy()
        g[1:] |= m[:-1]
        g[:-1] |= m[1:]
        g[:, 1:] |= m[:, :-1]
        g[:, :-1] |= m[:, 1:]
        m = g
    return m


def neck_of(cell):
    """The row his shoulders start: the first row with plenty of jersey."""
    rows = np.isin(cell, JERSEY + TEAM).sum(1)
    if rows.max() == 0:
        return None
    return int(np.where(rows > rows.max() * 0.35)[0].min())


def head_mask(cell, dark, allowed=None):
    """His head in one frame: his hair, the skin of his face and neck above his shoulders that sits
    under or beside his hair, and the dark outline round them. With `allowed` (where his head
    usually is for this facing), skin outside it stays: a raised arm or hand by his head."""
    # the ball shares some browns with hair and skin: anything inside its round shape stays ball
    ball = ball_of(cell)
    hair = np.isin(cell, HAIR) & ~ball
    if hair.sum() < 8:
        return None, None
    neck = neck_of(cell)
    if neck is None:
        return None, None
    ys, xs = np.where(hair)
    H, W = hair.shape
    above = np.zeros_like(hair)
    above[: neck + 3] = True
    x0, x1 = xs.min() - 1, xs.max() + 1
    band = np.zeros_like(hair)
    band[:, max(0, x0):x1 + 1] = True
    # below the shoulders' top only the middle (the chin), not the shoulders or arms
    inset = int((x1 - x0) * 0.2)
    band[neck:, : max(0, x0 + inset)] = False
    band[neck:, x1 - inset + 1:] = False
    cand = (hair | np.isin(cell, SKIN)) & above & band & ~ball
    if allowed is not None:
        cand &= allowed | hair
    # the skin joined to his hair
    head = flood(cand, hair)
    # what his head encloses (eyes, mouth, lines on his face)
    head = fill_holes(head) & ~ball
    if allowed is not None:
        head &= allowed | hair
    outline = np.isin(cell, dark) & grow(head, 1) & above & ~ball
    return head | outline, neck


def ball_of(cell):
    """The ball: a round, solid patch of its oranges (his hair has a few of them too, scattered)."""
    ballish = np.isin(cell, BALL)
    out = np.zeros_like(ballish)
    for comp in pieces(grow(ballish, 1)):
        ys = np.array([p[0] for p in comp])
        xs = np.array([p[1] for p in comp])
        h, w = ys.ptp() + 1, xs.ptp() + 1
        own = ballish[ys, xs].sum()
        if own >= 20 and 0.6 <= h / w <= 1.6 and own / (h * w) >= 0.3:
            m = np.zeros_like(ballish)
            m[ys, xs] = True
            # the whole disc: the circle round its middle
            cy, cx, r = ys.mean(), xs.mean(), (h + w) / 4 + 0.5
            yy, xx = np.ogrid[: cell.shape[0], : cell.shape[1]]
            out |= ((yy - cy) ** 2 + (xx - cx) ** 2 <= r * r) & (cell > 0)
    return out


WARM = [26, 29, 30, 36, 37]  # browns and oranges shared by the ball and his skin and hair shading
DARK_BROWN = [28, 33]  # shading lines inside his limbs and face (the outline round him is darker still)


def fold_into_parts(cell, rgb, keep=None):
    """The in-between browns his art uses inside his skin and hair (shading the video gave the same
    colour as the ball or an outline) become the nearest skin or hair tone, so they recolour with
    them: a warm brown with skin (or hair) on most sides, or a dark brown line inside skin that
    doesn't touch the background. `keep` (a mask) is left alone: the ball."""
    rgb = np.asarray(rgb, float)
    lum = rgb @ [0.299, 0.587, 0.114]
    tones = {"skin": SKIN, "hair": HAIR}
    keep = np.zeros(cell.shape, bool) if keep is None else keep
    out = cell.copy()
    for _ in range(6):
        changed = False
        for part, slots in tones.items():
            mine = np.isin(out, slots)
            n = np.zeros(cell.shape, int)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dy or dx:
                        n += np.roll(np.roll(mine, dy, 0), dx, 1)
            empty = grow(out == 0, 1)
            pick = ((np.isin(out, WARM) & (n >= 3)) | (np.isin(out, DARK_BROWN) & (n >= 4) & ~empty)) & ~keep
            if pick.any():
                for y, x in zip(*np.where(pick)):
                    out[y, x] = min(slots, key=lambda s: abs(lum[s] - lum[out[y, x]]))
                changed = True
        if not changed:
            break
    return out


def around(y, x, h, w):
    return [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and 0 <= y + dy < h and 0 <= x + dx < w]


def pieces(mask):
    """The 8-connected pieces of a mask, as lists of (y, x)."""
    seen = np.zeros_like(mask)
    h, w = mask.shape
    out = []
    for y, x in zip(*np.where(mask)):
        if seen[y, x]:
            continue
        stack, comp = [(y, x)], []
        seen[y, x] = True
        while stack:
            p = stack.pop()
            comp.append(p)
            for q in around(*p, h, w):
                if mask[q] and not seen[q]:
                    seen[q] = True
                    stack.append(q)
        out.append(comp)
    return out


def flood(allowed, seed):
    out = seed & allowed
    while True:
        g = grow(out, 1) & allowed
        if (g == out).all():
            return out
        out = g


def fill_holes(mask):
    outside = np.zeros_like(mask)
    outside[0, :] = ~mask[0, :]
    outside[-1, :] = ~mask[-1, :]
    outside[:, 0] = ~mask[:, 0]
    outside[:, -1] = ~mask[:, -1]
    outside = flood(~mask, outside)
    return ~outside


def descriptor(cell, head):
    """His head's shape at 16 x 16 (hair 1, skin 2), for matching facings."""
    ys, xs = np.where(head)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    part = np.where(np.isin(cell, HAIR), 1.0, np.where(np.isin(cell, SKIN), 2.0, 0.0)) * head
    img = Image.fromarray(part[y0:y1, x0:x1].astype(np.float32), "F").resize((16, 16), Image.BILINEAR)
    return np.asarray(img)


def main():
    meta = json.load(open(PIX / "sprites.json"))
    sheet = Image.open(PIX / "sprites.png")
    pal = sheet.getpalette()
    a = np.array(sheet)
    rgb = np.array(meta["rgb"])
    lum = rgb @ [0.299, 0.587, 0.114]
    dark = [i for i in range(1, len(rgb)) if lum[i] < 60]

    # every distinct frame once
    frames = {}
    for name, lst in meta["frames"].items():
        for f in lst:
            frames.setdefault(f"{f[0]},{f[1]}", (name, f))

    info = {}
    for key, (name, f) in frames.items():
        x, y, w, h = f[:4]
        cell = a[y:y + h, x:x + w]
        head, neck = head_mask(cell, dark)
        if head is None:
            continue
        hy, hx = np.where(head)
        ry, rx = np.where(head & np.isin(cell, HAIR))
        info[key] = dict(name=name, head=head, neck=neck, cx=float(rx.mean()), cy=float(ry.mean()),
                         top=int(hy.min()), left=int(hx.min()), right=int(hx.max()), desc=descriptor(cell, head))

    # the guide frames: where the head square sits for each drawn facing, relative to the head's middle
    det = json.load(open(DET / "sprites.json"))
    pix_of = det["printsFrom"]["frames"]
    K = det["printsFrom"]["scale"]
    det_atlas = Image.open(DET / "sprites.webp").convert("RGBA")
    cells = {}
    refs = {}
    shapes = {}  # each facing's head shape in its guide frame, and its hair's middle
    guide = Image.new("RGBA", (CELL * len(DRAWN), CELL), GREEN + (255,))
    mine = Image.new("RGBA", (CELL * len(DRAWN), CELL), GREEN + (255,))
    for n, d in enumerate(DRAWN):
        dx, dy, dw, dh = det["frames"][REF[d]][0][:4]
        key = pix_of[f"{dx},{dy}"]
        it = info[key]
        size = max(it["neck"] - it["top"], it["right"] - it["left"]) * 1.5
        # the square, in the pixel frame (whole pixels)
        sx = int(round((it["left"] + it["right"]) / 2 - size / 2))
        sy = int(round(it["top"] - size * 0.15))
        s = int(round(size))
        cells[d] = dict(w=s, h=s, ox=sx - it["cx"], oy=sy - it["cy"], neck=it["neck"] - sy)
        refs[d] = it["desc"]
        shapes[d] = (it["head"], it["cx"], it["cy"])
        # the guide, from the full-detail frame at the same place (K times finer)
        frame = Image.new("RGBA", det_atlas.size, (0, 0, 0, 0))
        frame.paste(det_atlas.crop((dx, dy, dx + dw, dy + dh)), (dx, dy))
        box = (dx + sx * K, dy + sy * K, dx + (sx + s) * K, dy + (sy + s) * K)
        crop = frame.crop(box)
        # head and neck only: his own head pixels (from the pixel frame), grown a little
        px, py, pw, ph = [v for v in frames[key][1][:4]]
        keep = np.zeros((s, s), bool)
        hm = it["head"]
        for yy in range(s):
            for xx in range(s):
                fy, fx = sy + yy, sx + xx
                if 0 <= fy < hm.shape[0] and 0 <= fx < hm.shape[1]:
                    keep[yy, xx] = hm[fy, fx]
        keep = grow(keep, 1)
        km = Image.fromarray((keep * 255).astype(np.uint8)).resize(crop.size, Image.NEAREST)
        cut = Image.new("RGBA", crop.size, (0, 0, 0, 0))
        cut.paste(crop, (0, 0), km)
        big = cut.resize((CELL, CELL), Image.NEAREST)
        guide.alpha_composite(big, (n * CELL, 0))
        mine.alpha_composite(big, (n * CELL, 0))

    # each frame's facing: from its move's name, else the nearest head shape
    def facing(it):
        parts = it["name"].split("-")
        if len(parts) == 2 and parts[1] in DIRS:
            return parts[1]
        best, bd = None, 1e9
        for d in DIRS:
            r = refs[MIRROR.get(d, d)]
            if d in MIRROR:
                r = r[:, ::-1]
            diff = float(((r - it["desc"]) ** 2).sum())
            if diff < bd:
                best, bd = d, diff
        return best

    rig_frames = {}
    body = a.copy()
    for key, it in info.items():
        x, y = map(int, key.split(","))
        h, w = it["head"].shape
        d = facing(it)
        # where his head usually is, facing this way: the guide frame's head shape, moved to this
        # frame's hair (and flipped for the left-facing ones), grown a little
        shape, rcx, rcy = shapes[MIRROR.get(d, d)]
        if d in MIRROR:
            shape, rcx = shape[:, ::-1], shape.shape[1] - 1 - rcx
        allowed = np.zeros((h, w), bool)
        sy, sx = np.where(shape)
        ty, tx = sy + int(round(it["cy"] - rcy)), sx + int(round(it["cx"] - rcx))
        ok = (ty >= 0) & (ty < h) & (tx >= 0) & (tx < w)
        allowed[ty[ok], tx[ok]] = True
        allowed = grow(allowed, 2)
        cell = a[y:y + h, x:x + w]
        head, _ = head_mask(cell, dark, allowed)
        it["head"] = head
        region = body[y:y + h, x:x + w]
        region[head] = 0
        region[:] = fold_into_parts(region, rgb, keep=ball_of(region))
        # specks left floating near where his head was (bits of its outline)
        near = grow(it["head"], 6)
        solid = region > 0
        for comp in pieces(solid & near):
            if len(comp) < 12 and not any(solid[yy, xx] and not near[yy, xx] for (cy_, cx_) in comp for (yy, xx) in around(cy_, cx_, h, w)):
                for (yy, xx) in comp:
                    region[yy, xx] = 0
        rig_frames[key] = [d, round(it["cx"], 2), round(it["cy"], 2)]

    OUT.mkdir(parents=True, exist_ok=True)
    o = Image.fromarray(body, "P")
    o.putpalette(pal)
    o.save(OUT / "body.png", transparency=0, optimize=True)
    rig = {k: v for k, v in meta.items()}
    rig["heads"] = {"cells": cells, "frames": rig_frames, "mirror": MIRROR}
    json.dump(rig, open(OUT / "rig.json", "w"), separators=(",", ":"))
    HEADS.mkdir(parents=True, exist_ok=True)
    guide.convert("RGB").save(HEADS / "template-orson.png")
    mine.convert("RGB").save(HEADS / "head-orson.png")
    counts = {}
    for v in rig_frames.values():
        counts[v[0]] = counts.get(v[0], 0) + 1
    print(len(rig_frames), "frames with a head;", "facings", counts)
    print("squares", {d: c["w"] for d, c in cells.items()})


if __name__ == "__main__":
    main()
