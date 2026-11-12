"""Checks a kid's region map frame by frame for paint in the wrong place, and draws a contact sheet of
every frame in clashing colours (very light skin, blue hair, red jersey, yellow team colour, green shoes)
so anything that changes with the wrong part shows.

  python tools/pixelart/check_regions.py assets/characters/buns-detail <out.png> [--fix]

Flags per frame: jersey, team or shoe pixels above the jersey's top (eyes, teeth: they'd change with the
kit), shoe pixels in the top two-thirds, hair below the jersey's top, and bits of the old ball's outline
left loose round the held ball (the outline still joined to a hand stays: the game's ball sits under it). --fix returns them to fixed
colours in the region map (and takes the ball's leftovers off the sheet) (run it last, after ball_key.py).
"""
import hashlib
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

PARTS = {1: "skin", 2: "hair", 3: "jersey", 4: "team", 5: "shoes"}
CLASH = {"skin": "#f6dcc8", "hair": "#2a6ad6", "jersey": "#d63a3a", "team": "#f2cf3d", "shoes": "#2bb24c"}


def recolour(f, r, meta):
    luma = lambda a: 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    out = f.copy()
    for pid, part in PARTS.items():
        ref = meta["regions"].get(part)
        if not ref:
            continue
        refL = max(1, 0.299 * ref[0] + 0.587 * ref[1] + 0.114 * ref[2])
        t = np.array([int(CLASH[part][i:i + 2], 16) for i in (1, 3, 5)], float)
        k = luma(f) / refL
        if refL < 70:
            k = 0.35 + 0.65 * k
        m = (r == pid) & (f[..., 3] > 0)
        for c in range(3):
            v = np.where(k <= 1, t[c] * k, np.minimum(255, t[c] + (255 - t[c]) * (k - 1) * 0.6))
            out[..., c] = np.where(m, v, out[..., c])
    return out


def main(d, out, fix=False):
    meta = json.load(open(f"{d}/sprites.json"))
    sheet_im = np.array(Image.open(f"{d}/sprites.webp").convert("RGBA"))
    sheet = sheet_im.astype(float)
    reg_im = np.array(Image.open(f"{d}/regions.png").convert("RGBA"))
    reg = reg_im[..., 0].copy()
    rects = []
    for anim, frames in meta["frames"].items():
        for f in frames:
            if tuple(f[:4]) not in {tuple(r[1]) for r in rects}:
                rects.append((anim, f[:4]))
    issues, tiles = [], []
    for anim, (x, y, w, h) in rects:
        r = reg[y:y + h, x:x + w]
        on = sheet[y:y + h, x:x + w, 3] >= 128
        per_row = (r == 3).sum(1)
        rows = np.where(per_row >= 0.3 * per_row.max())[0] if per_row.max() else per_row[:0]
        top = rows[0] if len(rows) else h
        found = {}
        above = np.zeros_like(on)
        above[: max(0, top - 2)] = True
        # kit up by the face that isn't joined to the jersey below it (a jersey's own straps are)
        kit = on & np.isin(r, [3, 4, 5])
        lab, n = ndimage.label(kit, structure=np.ones((3, 3)))
        joined = np.unique(lab[top:][lab[top:] > 0])
        stray = kit & above & ~np.isin(lab, joined)
        found["kit on face"] = int(stray.sum())
        hi = np.zeros_like(on)
        hi[: int(h * 0.66)] = True
        found["shoes high"] = int((on & hi & (r == 5)).sum())
        below = np.zeros_like(on)
        below[top + 3:] = True
        found["hair low"] = int((on & below & (r == 2)).sum())
        # the old ball's outline left behind round where the ball was cut out: bits near the ball not joined
        # to the body
        b = meta.get("balls", {}).get(f"{x},{y}")
        loose = np.zeros_like(on)
        if b:
            lab, n = ndimage.label(on)
            if n > 1:
                main = int(np.argmax(ndimage.sum(on, lab, range(1, n + 1)))) + 1
                yy, xx = np.mgrid[:h, :w]
                near = (yy - b[1]) ** 2 + (xx - b[0]) ** 2 <= (b[2] * 1.4) ** 2
                for i in range(1, n + 1):
                    piece = lab == i
                    if i != main and (piece & near).sum() >= 0.6 * piece.sum():
                        loose |= piece
            # dark outline specks and lines left inside the hole (not fingers: those are skin, and joined to
            # the hand outside the hole)
            yy, xx = np.mgrid[:h, :w]
            inner = (yy - b[1]) ** 2 + (xx - b[0]) ** 2 <= (b[2] * 0.92) ** 2
            bits = on & (r == 0) & inner
            lab, n = ndimage.label(bits, structure=np.ones((3, 3)))
            for i in range(1, n + 1):
                piece = lab == i
                if piece.sum() < 80 and not (ndimage.binary_dilation(piece, iterations=2) & on & ~inner & (r == 1)).any():
                    loose |= piece
        found["ball leftovers"] = int(loose.sum())
        if fix:
            wrong = stray | (on & hi & (r == 5)) | (on & below & (r == 2))
            reg[y:y + h, x:x + w][wrong | loose] = 0
            r = reg[y:y + h, x:x + w]
            sheet_im[y:y + h, x:x + w, 3][loose] = 0
            sheet[y:y + h, x:x + w, 3][loose] = 0
        bad = {k: v for k, v in found.items() if v >= 6}
        if bad:
            issues.append((anim, (x, y), bad))
        tiles.append(Image.fromarray(recolour(sheet[y:y + h, x:x + w], r, meta).clip(0, 255).astype(np.uint8)))
    cw = max(t.width for t in tiles) + 4
    ch = max(t.height for t in tiles) + 4
    cols = 20
    o = Image.new("RGBA", (cw * cols, ch * ((len(tiles) + cols - 1) // cols)), (52, 30, 46, 255))
    for i, t in enumerate(tiles):
        o.alpha_composite(t, ((i % cols) * cw, (i // cols) * ch))
    o.save(out)
    if fix:
        reg_im[..., 0] = reg
        Image.fromarray(reg_im).save(f"{d}/regions.png")
        Image.fromarray(sheet_im).save(f"{d}/sprites.webp", quality=90, method=6)
        # the region map's version stamp, so browsers fetch the new one
        stamp = hashlib.md5(open(f"{d}/regions.png", "rb").read()).hexdigest()[:8]
        meta["regionsFile"] = meta["regionsFile"].split("?")[0] + "?v=" + stamp
        json.dump(meta, open(f"{d}/sprites.json", "w"))
    totals = {}
    for _, _, bad in issues:
        for k, v in bad.items():
            totals[k] = totals.get(k, 0) + 1
    print(f"{len(rects)} frames, {len(issues)} with issues: {totals}")
    for anim, at, bad in issues[:12]:
        print(" ", anim, at, bad)
    return totals


if __name__ == "__main__":
    fix = "--fix" in sys.argv
    totals = main(sys.argv[1], sys.argv[2], fix)
    # taking a loose bit off can leave another one loose (it was only joined through that bit): go again
    for _ in range(3):
        if not (fix and totals.get("ball leftovers")):
            break
        totals = main(sys.argv[1], sys.argv[2], fix)
