"""The shared body every layered player is built on, from Orson's pixel-art sheet.

  python tools/pixelart/rig.py

Reads assets/characters/orson-pixel (his frames from video) and writes:
  assets/characters/rig/body.png   his frames with his head taken off (same places, same palette)
  assets/characters/rig/rig.json   his sheet's frames, faces, palette and release points, plus for
                                   every frame where the head goes (the middle of his hair), which way
                                   it faces and whether he's looking up (in a shot), and for each view
                                   the square a head image fills
  art/heads/template-orson.png     his head in every view on green, 16:9 (1920 x 1080): the guide for
                                   making new heads (art/heads/README.md)
  art/heads/head-orson.png         the same, so his own head can be put back on as a check

Views: five facings (front, front-right, right, back-right, back), each normal and looking up (for the
jump and release of a shot). Left-facing frames use the right-facing head, flipped. Frames whose move
isn't named by its facing (turns, standing) are matched to the nearest facing by the shape of his head.

The guide's layout (LAYOUT) is shared with tools/pixelart/heads.py, which reads the heads made from it.
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
UP_MOVES = ("jump", "release")  # moves where he looks up at the hoop
# The frame each view's guide comes from: standing dribbles (or the jog, front), and early in the jump
# for looking up (his face still clear of his arms). Nobody shoots facing straight at us, so the front
# looking-up view is the normal front.
REF = {d: (f"dribble-{d}" if d not in ("f", "fr") else f"run-{d}", 0) for d in DRAWN}
REF.update({f"up-{d}": (f"jump-{d}", 1) for d in DRAWN if d != "f"})
REF["up-f"] = REF["f"]
# His face is behind his arms in most shot frames, so the looking-up guide is his normal head tipped
# back (degrees, anticlockwise: chin up for a head facing right); the frames above still say where the
# head sits and what to take off.
TILT = {"f": 0, "fr": 10, "r": 16, "br": 8, "b": 0}
GREEN = (0, 177, 64)
# The guide: 16:9, two rows of five squares (normal, then looking up), centred.
LAYOUT = dict(w=1920, h=1080, side=360, x0=60, y0=180)
VIEWS = [[d for d in DRAWN], [f"up-{d}" for d in DRAWN]]


def view_box(row, col, scale=1.0):
    """A view's square in the guide (or in a head image `scale` times the guide's size)."""
    s = LAYOUT["side"] * scale
    x = (LAYOUT["x0"] + col * LAYOUT["side"]) * scale
    y = (LAYOUT["y0"] + row * LAYOUT["side"]) * scale
    return int(round(x)), int(round(y)), int(round(x + s)), int(round(y + s))


def view_key(d, pose):
    base = MIRROR.get(d, d)
    return (f"up-{base}" if pose == "up" else base), d != base


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
    """His head in one frame: his hair, his face and neck (the skin under his hair, joined to it without
    crossing a line), what they enclose (eyes, mouth), and the dark outline round them. An arm or hand by
    his head is skin too, but it's drawn with a line between it and his face, so it stays; with
    `allowed` (where his head usually is, facing this way), nothing outside it goes either."""
    ball = ball_of(cell)
    hair = np.isin(cell, HAIR) & ~ball
    if hair.sum() < 8:
        return None, None
    # his head of hair: the biggest lump, and anything touching it (hair colours turn up in shading
    # elsewhere too)
    lumps = sorted(pieces(hair), key=len, reverse=True)
    main = np.zeros_like(hair)
    for p in lumps[0]:
        main[p] = True
    near = grow(main, 2)
    for lump in lumps[1:]:
        if any(near[p] for p in lump):
            for p in lump:
                main[p] = True
    hair = main
    neck = neck_of(cell)
    if neck is None:
        return None, None
    ys, xs = np.where(hair)
    above = np.zeros_like(hair)
    above[: neck + 3] = True
    x0, x1 = xs.min() - 1, xs.max() + 1
    band = np.zeros_like(hair)
    band[:, max(0, x0):x1 + 1] = True
    inset = int((x1 - x0) * 0.2)  # below the shoulders' top only the middle (the chin)
    band[neck:, : max(0, x0 + inset)] = False
    band[neck:, x1 - inset + 1:] = False
    zone = above & band & ~ball
    # and round: a head-sized circle under his hair (not his shoulders or a hand beside him)
    top = ys.min()
    r = max(xs.max() - xs.min(), neck - top) * 0.55
    cyy, cxx = top + (neck - top) * 0.55, xs.mean()
    yy, xx = np.ogrid[: hair.shape[0], : hair.shape[1]]
    zone &= (yy - cyy) ** 2 + (xx - cxx) ** 2 <= r * r
    if allowed is not None:
        zone &= allowed
    skin = np.isin(cell, SKIN) & zone
    # where his face starts: skin with hair just above it (his forehead, sideburns)
    hair_above = np.zeros_like(hair)
    for k in (1, 2):
        hair_above[k:] |= hair[:-k]
    face = flood4(skin, skin & hair_above)
    head = hair | face
    # what his head encloses: small bits (eyes, mouth, lines on his face) are head; a big patch of skin
    # inside is an arm across him, and stays
    for comp in pieces(fill_holes(head) & ~head):
        if len(comp) <= 6 or not any(skin[p] for p in comp):
            for p in comp:
                head[p] = True
    head &= ~ball
    outline = np.isin(cell, dark) & grow(head, 1) & above & ~ball & ~grow(np.isin(cell, SKIN) & ~head & ~zone, 1)
    return head | outline, neck


def flood4(allowed, seed):
    """Grows `seed` through `allowed`, four ways (so a one-pixel line stops it)."""
    out = seed & allowed
    while True:
        g = out.copy()
        g[1:] |= out[:-1]
        g[:-1] |= out[1:]
        g[:, 1:] |= out[:, :-1]
        g[:, :-1] |= out[:, 1:]
        g &= allowed
        if (g == out).all():
            return out
        out = g


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

    # every distinct frame once, with the move it first appears in
    frames = {}
    for name, lst in meta["frames"].items():
        for i, f in enumerate(lst):
            frames.setdefault(f"{f[0]},{f[1]}", (name, f))
    pose_of = lambda name: "up" if name.split("-")[0] in UP_MOVES else ""

    info = {}
    for key, (name, f) in frames.items():
        x, y, w, h = f[:4]
        cell = a[y:y + h, x:x + w]
        head, neck = head_mask(cell, dark)
        if head is None:
            continue
        hy, hx = np.where(head)
        ry, rx = np.where(head & np.isin(cell, HAIR))
        info[key] = dict(name=name, pose=pose_of(name), head=head, neck=neck, cx=float(rx.mean()), cy=float(ry.mean()),
                         top=int(hy.min()), left=int(hx.min()), right=int(hx.max()), desc=descriptor(cell, head))

    # the guide frames: each view's square, relative to the middle of his hair
    det = json.load(open(DET / "sprites.json"))
    pix_of = det["printsFrom"]["frames"]
    K = det["printsFrom"]["scale"]
    det_atlas = Image.open(DET / "sprites.webp").convert("RGBA")
    cells, refs, shapes = {}, {}, {}
    guide = Image.new("RGBA", (LAYOUT["w"], LAYOUT["h"]), GREEN + (255,))
    side = LAYOUT["side"]
    squares = {}  # each normal view's guide square, and where his hair is in it (pixel-sized)
    for row, keys in enumerate(VIEWS):
        for col, vk in enumerate(keys):
            name, i = REF[vk]
            dx, dy, dw, dh = det["frames"][name][i][:4]
            key = pix_of[f"{dx},{dy}"]
            it = info[key]
            bx, by, _, _ = view_box(row, col)
            if row == 1:
                # looking up: where his head is and what comes off are from the shot frame; the picture
                # is the normal head tipped back, placed by the middle of its hair
                base = vk[3:]
                shapes[vk] = (it["head"], it["cx"], it["cy"])
                big, hair_sq, c = squares[base]
                tipped = Image.fromarray((hair_sq * 255).astype(np.uint8)).rotate(TILT[base], Image.NEAREST)
                hy, hx = np.where(np.asarray(tipped) > 0)
                cells[vk] = dict(w=c["w"], h=c["h"], ox=-float(hx.mean()), oy=-float(hy.mean()), neck=c["neck"])
                guide.alpha_composite(big.rotate(TILT[base], Image.NEAREST), (bx, by))
                continue
            size = max(it["neck"] - it["top"], it["right"] - it["left"]) * 1.5
            sx = int(round((it["left"] + it["right"]) / 2 - size / 2))
            sy = int(round(it["top"] - size * 0.15))
            s = int(round(size))
            cells[vk] = c = dict(w=s, h=s, ox=sx - it["cx"], oy=sy - it["cy"], neck=it["neck"] - sy)
            shapes[vk] = (it["head"], it["cx"], it["cy"])
            refs[vk] = it["desc"]
            # the guide square, from the full-detail frame at the same place (K times finer), his head only
            frame = Image.new("RGBA", det_atlas.size, (0, 0, 0, 0))
            frame.paste(det_atlas.crop((dx, dy, dx + dw, dy + dh)), (dx, dy))
            crop = frame.crop((dx + sx * K, dy + sy * K, dx + (sx + s) * K, dy + (sy + s) * K))
            keep = np.zeros((s, s), bool)
            hair_sq = np.zeros((s, s), bool)
            hm = it["head"]
            cellpx = a[frames[key][1][1]:, frames[key][1][0]:]
            for yy in range(s):
                for xx in range(s):
                    fy, fx = sy + yy, sx + xx
                    if 0 <= fy < hm.shape[0] and 0 <= fx < hm.shape[1]:
                        keep[yy, xx] = hm[fy, fx]
                        hair_sq[yy, xx] = hm[fy, fx] and cellpx[fy, fx] in HAIR
            # clean: just the head in one piece, with no holes (no specks, no stray bits of hand)
            lumps = sorted(pieces(keep), key=len, reverse=True)
            keep = np.zeros_like(keep)
            for p in lumps[0]:
                keep[p] = True
            keep = fill_holes(keep)
            # and inside an oval from the top of his hair to just under his chin, as wide as his hair
            # (narrow at the bottom: not a hand by his chin, or his collar)
            hy, hx = np.where(hair_sq)
            if len(hy):
                top, bottom = hy.min(), c["neck"] + 1
                ey, ex = (top + bottom) / 2, (hx.min() + hx.max()) / 2
                ry, rx = (bottom - top) / 2 + 1, (hx.max() - hx.min()) / 2 * 1.08 + 1
                yy, xx = np.ogrid[:s, :s]
                keep &= ((yy - ey) / ry) ** 2 + ((xx - ex) / rx) ** 2 <= 1
            km = Image.fromarray((grow(keep, 1) * 255).astype(np.uint8)).resize(crop.size, Image.NEAREST)
            cut = Image.new("RGBA", crop.size, (0, 0, 0, 0))
            cut.paste(crop, (0, 0), km)
            big = cut.resize((side, side), Image.NEAREST)
            squares[vk] = (big, hair_sq, c)
            guide.alpha_composite(big, (bx, by))

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
        vk, flip = view_key(d, it["pose"])
        # where his head usually is in this view: the guide frame's head, moved to this frame's hair
        # (flipped for the left-facing ones), grown a little
        shape, rcx, rcy = shapes[vk]
        if flip:
            shape, rcx = shape[:, ::-1], shape.shape[1] - 1 - rcx
        allowed = np.zeros((h, w), bool)
        sy, sx = np.where(shape)
        ty, tx = sy + int(round(it["cy"] - rcy)), sx + int(round(it["cx"] - rcx))
        ok = (ty >= 0) & (ty < h) & (tx >= 0) & (tx < w)
        allowed[ty[ok], tx[ok]] = True
        cell = a[y:y + h, x:x + w]
        head, _ = head_mask(cell, dark, grow(allowed, 2))
        if it["pose"] == "up":
            # in a shot only his hair comes off: his face, neck and arms (mostly in front of his face)
            # stay as drawn, recoloured like the rest, and the new hair shows round them
            lines = np.isin(cell, dark) & head
            head = head & (np.isin(cell, HAIR) | (lines & grow(cell == 0, 1)) | (lines & ~grow(np.isin(cell, SKIN), 1)))
        region = body[y:y + h, x:x + w]
        region[head] = 0
        region[:] = fold_into_parts(region, rgb, keep=ball_of(region))
        # specks left floating near where his head was (bits of its outline)
        near = grow(head, 6)
        solid = region > 0
        for comp in pieces(solid & near):
            if len(comp) < 12 and not any(solid[yy, xx] and not near[yy, xx] for (cy_, cx_) in comp for (yy, xx) in around(cy_, cx_, h, w)):
                for (yy, xx) in comp:
                    region[yy, xx] = 0
        rig_frames[key] = [d, round(it["cx"], 2), round(it["cy"], 2), it["pose"]]

    OUT.mkdir(parents=True, exist_ok=True)
    o = Image.fromarray(body, "P")
    o.putpalette(pal)
    o.save(OUT / "body.png", transparency=0, optimize=True)
    rig = {k: v for k, v in meta.items()}
    rig["heads"] = {"cells": cells, "frames": rig_frames, "mirror": MIRROR}
    json.dump(rig, open(OUT / "rig.json", "w"), separators=(",", ":"))
    HEADS.mkdir(parents=True, exist_ok=True)
    guide.convert("RGB").save(HEADS / "template-orson.png")
    guide.convert("RGB").save(HEADS / "head-orson.png")
    counts = {}
    for v in rig_frames.values():
        k = view_key(v[0], v[3])[0]
        counts[k] = counts.get(k, 0) + 1
    print(len(rig_frames), "frames with a head; views", counts)


if __name__ == "__main__":
    main()
