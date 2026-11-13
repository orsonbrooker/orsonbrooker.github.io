"""Frame-by-frame check of gear on a kid from video, move by move, and the fix for what it finds.

Flow paints each frame of an item a little differently, and a frame it didn't paint has no item, so worn
gear can flash, wobble or break up. Within each move (the frames the game plays in a row), every frame's
item is compared with the rest of that move, measured against the body where the item sits (the head for a
hat, the feet for shoes):
- missing: no item in the frame (it flashes off)
- size: the item much bigger or smaller than in the rest of the move (it pulses)
- moved: the item off from where it sits in the rest of the move (it jumps)
- specks: small loose bits round the item
`steady()` puts specks away and gives every flagged frame the item from the nearest good frame of the same
move, lined up on the body there; gear_key.py build and rekey run it last.

  python tools/pixelart/gear_check.py check <kid> <item>     the report, move by move (nothing changes)
  python tools/pixelart/gear_check.py fix <kid> <item>       steady() on the layer as it is, and write it
  python tools/pixelart/gear_check.py all                    the report for every item made
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# where on the body each slot sits: a band of the frame's height, top to bottom
ZONE = {"head": (0, 0.34), "face": (0.08, 0.34), "jersey": (0.22, 0.62), "arms": (0.2, 0.7), "legs": (0.55, 1), "shoes": (0.78, 1)}
# what's mended where: a hat is rigid, so any odd frame is wrong; shoes and arms move and turn within a
# move, so only a missing one is
MEND = {"head": ("missing", "size", "moved"), "face": ("missing", "size", "moved"), "jersey": ("missing", "size"),
        "arms": ("missing",), "legs": ("missing",), "shoes": ("missing",)}
SIZE = (0.7, 1.4)  # an item this much smaller or bigger than the move's usual is flagged
MOVE = 0.12  # and this far (a share of the band's height, at least 3 pixels) from where it usually sits


def moves(meta):
    """Each move's frames in the order played: {anim: ["x,y", ...]} (each frame once per move)."""
    out = {}
    for anim, fr in meta["frames"].items():
        seen = []
        for f in fr:
            k = f"{f[0]},{f[1]}"
            if k not in seen:
                seen.append(k)
        out[anim] = seen
    return out


def anchor(sheet, rect, slot):
    """The middle of the body where the item sits (the drawn pixels in the slot's band), from the frame's corner."""
    x, y, w, h = rect
    z0, z1 = ZONE.get(slot, (0, 1))
    a = sheet[y + int(h * z0):y + int(h * z1), x:x + w, 3] > 0
    ys, xs = np.nonzero(a)
    if not len(ys):
        return None, h * (z1 - z0)
    return (float(xs.mean()), float(ys.mean()) + int(h * z0)), h * (z1 - z0)


def measure(p):
    """An item's size (its own pixels) and middle, in the frame's coordinates."""
    m = p["rgba"][..., 3] > 0
    if not m.any():
        return 0, None
    ys, xs = np.nonzero(m)
    return int(m.sum()), (float(xs.mean()) + p["dx"], float(ys.mean()) + p["dy"])


def specks(p):
    """The piece without small loose bits (anything under a seventh of its biggest shape)."""
    m = p["rgba"][..., 3] > 0
    lab, n = ndimage.label(m)
    if n < 2:
        return p, 0
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    small = np.isin(lab, 1 + np.flatnonzero(sizes < sizes.max() / 7))
    if not small.any():
        return p, 0
    rgba = p["rgba"].copy()
    rgba[small] = 0
    return {**p, "rgba": rgba}, int((sizes < sizes.max() / 7).sum())


def judge(meta, pieces, sheet, slot):
    """{anim: [(key, problem or None), ...]} for every move."""
    rects = {f"{f[0]},{f[1]}": f[:4] for fr in meta["frames"].values() for f in fr}
    out = {}
    for anim, keys in moves(meta).items():
        rows = []
        for k in keys:
            anc, band = anchor(sheet, rects[k], slot)
            if k not in pieces:
                rows.append((k, None, None, band))
                continue
            n, mid = measure(pieces[k])
            rel = (mid[0] - anc[0], mid[1] - anc[1]) if mid and anc else None
            rows.append((k, n, rel, band))
        have = [r for r in rows if r[1]]
        res = []
        if have:
            med_n = float(np.median([r[1] for r in have]))
            med_x = float(np.median([r[2][0] for r in have if r[2]])) if any(r[2] for r in have) else 0
            med_y = float(np.median([r[2][1] for r in have if r[2]])) if any(r[2] for r in have) else 0
        for k, n, rel, band in rows:
            if not n:
                res.append((k, "missing"))
            elif not SIZE[0] * med_n <= n <= SIZE[1] * med_n:
                res.append((k, f"size {n / med_n:.0%}"))
            elif rel and max(abs(rel[0] - med_x), abs(rel[1] - med_y)) > max(3, MOVE * band):
                res.append((k, f"moved {max(abs(rel[0] - med_x), abs(rel[1] - med_y)):.0f}px"))
            else:
                res.append((k, None))
        out[anim] = res
    return out


def steady(meta, pieces, sheet, slot):
    """Puts away specks, then gives each flagged frame the item from the nearest good frame of its move,
    lined up on the body. Returns how many frames were mended."""
    for k in list(pieces):
        pieces[k], _ = specks(pieces[k])
    rects = {f"{f[0]},{f[1]}": f[:4] for fr in meta["frames"].values() for f in fr}
    mended, good_once = 0, set()
    fixes = MEND.get(slot, ("missing",))
    verdict = {a: [(k, w if w and w.split()[0] in fixes else None) for k, w in r] for a, r in judge(meta, pieces, sheet, slot).items()}
    for anim, res in verdict.items():
        keys = [k for k, _ in res]
        ok = [i for i, (k, why) in enumerate(res) if not why]
        if not ok:
            continue
        for i, (k, why) in enumerate(res):
            if not why or k in good_once:
                continue
            j = min(ok, key=lambda j: min(abs(j - i), len(keys) - abs(j - i)))  # moves loop
            src = keys[j]
            a_to, _ = anchor(sheet, rects[k], slot)
            a_from, _ = anchor(sheet, rects[src], slot)
            if not a_to or not a_from:
                continue
            p = pieces[src]
            pieces[k] = {**p, "dx": p["dx"] + round(a_to[0] - a_from[0]), "dy": p["dy"] + round(a_to[1] - a_from[1])}
            good_once.add(k)  # a frame shared by several moves is mended once
            mended += 1
    # a move with no good frame at all (the standing one, when Flow skipped it): the closest frame of
    # another move facing the same way, which for standing is the turn's first frame
    missing = [k for k in rects if k not in pieces]
    if missing:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from gear_key import borrow
        layout = [{"rect": list(f[:4]), "anim": a} for a, fr in meta["frames"].items() for f in fr]
        mended += borrow(layout, pieces, sheet, limit=160)
    return mended


SIDES = ["", "-fr", "-r", "-br", "-b", "-bl", "-l", "-fl"]
HAIR_, SKIN_ = 2, 1


def head(sheet, regions, rect):
    """The head in a frame: its hair and skin (the shape that holds the hair, in the top of the frame),
    as a label map (1 skin, 2 hair) and its middle, from the frame's corner."""
    x, y, w, h = rect
    band = int(h * 0.42)
    a = sheet[y:y + band, x:x + w, 3] > 0
    r = regions[y:y + band, x:x + w]
    m = a & ((r == HAIR_) | (r == SKIN_))
    lab, n = ndimage.label(m)
    if not n:
        return None
    sizes = ndimage.sum(r == HAIR_, lab, range(1, n + 1))
    keep = lab == 1 + int(np.argmax(sizes))  # the one with the hair in it (not a raised hand)
    ys, xs = np.nonzero(keep)
    labels = np.where(keep, r, 0).astype(np.uint8)
    return {"map": labels, "mid": (float(xs.mean()), float(ys.mean())), "top": int(ys.min()), "band": band}


def likeness(a, b):
    """How alike two heads are (0..1): their hair and skin laid over each other, middles lined up."""
    ax, ay = a["mid"]
    bx, by = b["mid"]
    dx, dy = round(bx - ax), round(by - ay)
    ha, wa = a["map"].shape
    hb, wb = b["map"].shape
    H, W = max(ha, hb + abs(dy)) + abs(dy), max(wa, wb + abs(dx)) + abs(dx)
    A = np.zeros((H, W), np.uint8)
    B = np.zeros((H, W), np.uint8)
    oy, ox = abs(dy), abs(dx)
    A[oy:oy + ha, ox:ox + wa] = a["map"]
    B[oy - dy:oy - dy + hb, ox - dx:ox - dx + wb] = b["map"]
    both = (A > 0) | (B > 0)
    return float(((A == B) & both).sum()) / max(1, int(both.sum()))


def behind(p, rect, sheet, h):
    """The piece without the pixels that would cover the body in front of the head (a hand, an arm,
    the ball held up): anything drawn there that isn't this frame's head."""
    x, y, w, hh = rect
    ph, pw = p["rgba"].shape[:2]
    rgba, part = p["rgba"].copy(), p["part"].copy()
    body = sheet[y:y + hh, x:x + w, 3] > 0
    headmask = np.zeros((hh, w), bool)
    headmask[:h["band"]] = h["map"] > 0
    # a little room round the head (its outline), so the hat's own edge isn't eaten
    headmask = ndimage.binary_dilation(headmask, iterations=2)
    front = body & ~headmask
    ys, xs = np.mgrid[0:ph, 0:pw]
    fy, fx = ys + p["dy"], xs + p["dx"]
    inside = (fy >= 0) & (fx >= 0) & (fy < hh) & (fx < w)
    cover = np.zeros((ph, pw), bool)
    cover[inside] = front[fy[inside], fx[inside]]
    # only where the body in front sits over the head's height (not the hat's own brim over the shoulders)
    rgba[cover] = 0
    part[cover] = [0, 0, 0, 255]
    return {**p, "rgba": rgba, "part": part}


def rigid(meta, pieces, sheet, regions, slot):
    """A hat (or anything worn on the head) can't change shape: one good painting per facing, chosen as
    the most usual one of its move, goes on every frame, on the head that frame's head looks most like,
    lined up on the head. Returns how many frames took a painting from another frame."""
    rects = {f"{f[0]},{f[1]}": f[:4] for fr in meta["frames"].values() for f in fr}
    verdict = judge(meta, pieces, sheet, slot)
    heads = {k: head(sheet, regions, r) for k, r in rects.items()}
    picks = []  # (key, head)
    for side in SIDES:
        for move in ([f"idle"] if side == "" else []) + [f"dribble{side}", f"jog{side}"]:
            res = [(k, w) for k, w in verdict.get(move, []) if not w and k in pieces and heads.get(k)]
            if not res:
                continue
            # the fullest painting that isn't oversized (a painting can lose its top past the grid cell)
            sizes = sorted((measure(pieces[k])[0], k) for k, _ in res)
            med = sizes[len(sizes) // 2][0]
            k = max((n, k) for n, k in sizes if n <= 1.25 * med)[1]
            if k not in [p for p, _ in picks]:
                picks.append((k, heads[k]))
            break
    if not picks:
        return 0
    made = {}
    for k, h in heads.items():
        if not h:
            continue
        best = max(picks, key=lambda p: likeness(h, p[1]))
        src = pieces[best[0]]
        bx, by = best[1]["mid"]
        p = {**src, "dx": src["dx"] + round(h["mid"][0] - bx), "dy": src["dy"] + round(h["mid"][1] - by)}
        made[k] = behind(p, rects[k], sheet, h)
    changed = sum(1 for k in made if k not in pieces or made[k]["rgba"] is not pieces[k]["rgba"])
    pieces.clear()
    pieces.update(made)
    return changed


def load(kid, item):
    out = f"{ROOT}/assets/characters/gear/{item}"
    g = json.load(open(f"{out}/{kid}.json"))
    art = np.array(Image.open(f"{out}/{kid}.webp").convert("RGBA"))
    part = np.array(Image.open(f"{out}/{kid}.png"))
    pieces = {}
    for k, (ax, ay, w, h, dx, dy) in g["frames"].items():
        pieces[k] = {"rgba": art[ay:ay + h, ax:ax + w], "part": part[ay:ay + h, ax:ax + w], "dx": dx, "dy": dy}
    return pieces


def report(kid, item, quiet=False):
    d = f"{ROOT}/assets/characters/{kid}-detail"
    meta = json.load(open(f"{d}/sprites.json"))
    sheet = np.array(Image.open(f"{d}/sprites.webp").convert("RGBA"))
    slot = json.load(open(f"{ROOT}/content/gear.json"))[item]["slot"]
    verdict = judge(meta, load(kid, item), sheet, slot)
    total = sum(len(r) for r in verdict.values())
    fixes = MEND.get(slot, ("missing",))
    flagged = {a: [(k, w) for k, w in r if w and w.split()[0] in fixes] for a, r in verdict.items()}
    nbad = sum(len(v) for v in flagged.values())
    print(f"{item} on {kid}: {nbad} of {total} frames flagged, in {sum(1 for v in flagged.values() if v)} of {len(verdict)} moves")
    if not quiet:
        for a, v in flagged.items():
            if v:
                print(f"  {a}: " + ", ".join(w for _, w in v))
    return nbad


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "check":
        report(sys.argv[2], sys.argv[3])
    elif cmd == "all":
        idx = json.load(open(f"{ROOT}/assets/characters/gear/index.json"))
        for item, kids in idx.items():
            for kid in kids:
                report(kid, item, quiet=True)
    elif cmd == "fix":
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import gear_key
        kid, item = sys.argv[2:4]
        d = f"{ROOT}/assets/characters/{kid}-detail"
        meta = json.load(open(f"{d}/sprites.json"))
        sheet = np.array(Image.open(f"{d}/sprites.webp").convert("RGBA"))
        slot = json.load(open(f"{ROOT}/content/gear.json"))[item]["slot"]
        pieces = load(kid, item)
        regions = np.array(Image.open(f"{d}/regions.png"))[..., 0]
        print(gear_key.finish(json.load(open(f"{ROOT}/content/gear.json"))[item], meta, pieces, sheet, regions), "frames mended")
        gear_key.write(kid, item, pieces, meta, stretch=False)
        report(kid, item)
    else:
        sys.exit(__doc__)
