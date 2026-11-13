"""Smaller copies of a kid's full-detail sheet and of their gear (2/3 size), for phones and tablets.

A full-detail sheet is 4096 wide and up to 18 megapixels: more than a phone's court (about 780 pixels
across) can show, slow to recolour, dress and stretch on a phone, and on iOS more than a canvas can hold
(16.7 megapixels). At 2/3 size a sheet pixel is drawn at about one screen pixel on a phone, so nothing
shows lost. The game and the builder pick these copies there (players/recolor.js, `SMALL`). They run as
the last step of a rebuild, so they never go stale: video_bases.py makes the kids' it points at,
gear_key.py each gear layer it writes.

For each kid (`<kid>-detail/`):
  sprites@small.webp, regions@small.png, sprites@small.json   every frame at 2/3 size, packed afresh: frames,
      offsets, held balls and the print frames' keys moved to match, `res` scaled (`fullRes` keeps the
      full sheet's, for sizes worked out from it)
and its entry in assets/characters/bases/index.json (or Orson's in assets/characters/index.json) gets
`small`: { atlas, meta, regions, card } with ?v= stamps. For each gear item made for the kid:
  gear/<item>/<kid>@small.webp, .png, .json                    the same pieces at 2/3 size, keyed by the small
      sheet's frames (the index keeps the full layer's stamp; the small files change with it)

Colours are averaged over the area each new pixel covers (as the browser would shrink them); the region map
takes the region covering most of it, so labels stay exact, never mixed. Frames and gear pieces start on
whole blocks of 3 pixels, so every frame shrinks the same way and gear stays lined up with the body.

  python tools/pixelart/small_sheet.py curly buns orson    every kid named, and all their gear
  python tools/pixelart/small_sheet.py --gear beanie curly one item for one kid
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHARS = f"{ROOT}/assets/characters"
N, D = 2, 3  # the size: N/D of the full sheet
SHEET_W = 2730  # the full sheets' 4096 at that size
GAP = 2  # clear pixels between frames, so smoothing never picks up a neighbour
GEAR_W = 1024


def stamp(path):
    return hashlib.md5(open(path, "rb").read()).hexdigest()[:8]


def rel(path):
    return os.path.relpath(path, ROOT)


def sized(v):
    """A full-size length or position at the small size (whole when it comes out whole)."""
    s = v * N / D
    return int(round(s)) if abs(s - round(s)) < 1e-9 else round(s, 3)


def unique_frames(meta):
    """Each frame once, by its place on the sheet, in a fixed order: {"x,y": [x, y, w, h]}."""
    out = {}
    for frames in meta["frames"].values():
        for f in frames:
            out.setdefault(f"{f[0]},{f[1]}", f[:4])
    return dict(sorted(out.items(), key=lambda kv: (kv[1][1], kv[1][0])))


def blocks(n):
    """Pixels after shrinking n full pixels (padded up to a whole number of blocks)."""
    return -(-n // D) * N


def layout(meta):
    """Where each full frame goes on the small sheet: ({"x,y": (qx, qy, w, h)}, sheet height). Worked out from
    the full sheet's meta alone, so the sheet and its gear always agree."""
    px = py = shelf = 0
    at = {}
    for key, (x, y, w, h) in unique_frames(meta).items():
        w2, h2 = blocks(w), blocks(h)
        if px + w2 > SHEET_W:
            px, py, shelf = 0, py + shelf + GAP, 0
        at[key] = (px, py, w2, h2)
        px += w2 + GAP
        shelf = max(shelf, h2)
    return at, py + shelf + GAP


def area(a, size):
    """A float array (h, w) shrunk to size (w, h) by area."""
    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize(size, Image.BOX))


def shrink(rgba, labels=None, hide=None):
    """rgba: (h, w, 4) uint8, h and w whole blocks of D. Colour: the average of the drawn pixels each new pixel
    covers; alpha: their share. labels (h, w): the label covering most of the drawn part (0 if none drawn).
    hide (h, w) bool: hidden where at least a quarter is. Returns (rgba, labels, hide) at N/D size."""
    h, w = rgba.shape[:2]
    size = (w * N // D, h * N // D)
    a = rgba[..., 3].astype(np.float32) / 255
    cov = area(a, size)
    out = np.zeros((size[1], size[0], 4), np.uint8)
    for c in range(3):
        out[..., c] = (area(rgba[..., c] * a, size) / np.maximum(cov, 1e-6)).round().clip(0, 255)
    out[..., 3] = (cov * 255).round().clip(0, 255)
    lab = None
    if labels is not None:
        drawn = a >= 0.5
        best = np.zeros(size[::-1], np.uint8)
        best_n = np.zeros(size[::-1], np.float32)
        for v in np.unique(labels):
            if v == 0:
                continue
            n = area(((labels == v) & drawn).astype(np.float32), size)
            better = n > best_n + 1e-6
            best[better], best_n[better] = v, n[better]
        lab = best
    # hidden (hair under a hat) where a quarter or more of it is: a body pixel half under the hat would
    # otherwise poke out round its edge as a speck
    hid = None if hide is None else area(hide.astype(np.float32), size) >= 0.25
    return out, lab, hid


def padded(arr, x0, y0, w, h, left=0, top=0):
    """arr[y0:y0+h, x0:x0+w] placed at (left, top) in a zero array grown to whole blocks of D."""
    W2, H2 = -(-(left + w) // D) * D, -(-(top + h) // D) * D
    out = np.zeros((H2, W2, *arr.shape[2:]), arr.dtype)
    out[top:top + h, left:left + w] = arr[y0:y0 + h, x0:x0 + w]
    return out


def small_card(card, at):
    x, y, w, h, dx, dy, side = card
    qx, qy, w2, h2 = at[f"{x},{y}"]
    return [qx, qy, w2, h2, sized(dx), sized(dy), sized(side)]


def sheet(kid):
    """The kid's small sheet, region map and meta; returns the `small` entry for the index, and the layout."""
    d = f"{CHARS}/{kid}-detail"
    meta = json.load(open(f"{d}/sprites.json"))
    img = np.asarray(Image.open(f"{d}/sprites.webp").convert("RGBA"))
    reg = np.asarray(Image.open(f"{d}/regions.png").convert("RGBA"))[..., 0]
    at, H = layout(meta)
    out = np.zeros((H, SHEET_W, 4), np.uint8)
    out_reg = np.zeros((H, SHEET_W), np.uint8)
    for key, (x, y, w, h) in unique_frames(meta).items():
        qx, qy, w2, h2 = at[key]
        rgba, lab, _ = shrink(padded(img, x, y, w, h), padded(reg, x, y, w, h))
        out[qy:qy + h2, qx:qx + w2] = rgba
        out_reg[qy:qy + h2, qx:qx + w2] = lab
    Image.fromarray(out).save(f"{d}/sprites@small.webp", "WEBP", quality=82, method=6)
    reg_img = np.zeros((H, SHEET_W, 4), np.uint8)
    reg_img[..., 0] = out_reg
    reg_img[..., 3] = np.where(out[..., 3] > 0, 255, 0)
    Image.fromarray(reg_img, "RGBA").save(f"{d}/regions@small.png", optimize=True)

    def moved(f):
        qx, qy, w2, h2 = at[f"{f[0]},{f[1]}"]
        return [qx, qy, w2, h2, sized(f[4]), sized(f[5])]

    key_of = lambda k: "{},{}".format(*at[k][:2])
    small = {**meta, "res": meta["res"] * N / D, "fullRes": meta.get("fullRes", meta["res"]),
             "frames": {name: [moved(f) for f in frames] for name, frames in meta["frames"].items()},
             "regionsFile": f"{rel(d)}/regions@small.png?v={stamp(f'{d}/regions@small.png')}"}
    if "balls" in meta:
        small["balls"] = {key_of(k): [sized(v) for v in b] for k, b in meta["balls"].items() if k in at}
    if "printsFrom" in meta:
        small["printsFrom"] = {**meta["printsFrom"], "frames": {key_of(k): v for k, v in meta["printsFrom"]["frames"].items() if k in at}}
    json.dump(small, open(f"{d}/sprites@small.json", "w"))
    entry = {"atlas": f"{rel(d)}/sprites@small.webp?v={stamp(f'{d}/sprites@small.webp')}",
             "meta": f"{rel(d)}/sprites@small.json?v={stamp(f'{d}/sprites@small.json')}",
             "regions": f"{rel(d)}/regions@small.png?v={stamp(f'{d}/regions@small.png')}"}
    print(f"{kid}: {img.shape[1]}x{img.shape[0]} ({img.shape[0] * img.shape[1] / 1e6:.1f} MP, {os.path.getsize(f'{d}/sprites.webp') // 1024} KB)"
          f" -> {SHEET_W}x{H} ({H * SHEET_W / 1e6:.1f} MP, {os.path.getsize(f'{d}/sprites@small.webp') // 1024} KB)")
    return entry, at


def gear(item, kid, at=None):
    """One gear layer at the small size, keyed by the kid's small sheet."""
    g = f"{CHARS}/gear/{item}/{kid}"
    if not os.path.exists(f"{g}.json"):
        return
    if at is None:
        at, _ = layout(json.load(open(f"{CHARS}/{kid}-detail/sprites.json")))
    lay = json.load(open(f"{g}.json"))
    art = np.asarray(Image.open(f"{g}.webp").convert("RGBA"))
    part = np.asarray(Image.open(f"{g}.png").convert("RGBA"))
    pieces = {}
    for key, (ax, ay, pw, ph, ox, oy) in lay["frames"].items():
        if key not in at:
            continue
        # line the piece up with the frame's blocks: start it a whole number of blocks from the frame's corner
        left, top = ox % D, oy % D
        a = padded(art, ax, ay, pw, ph, left, top)
        p = padded(part, ax, ay, pw, ph, left, top)
        drawn = a[..., 3] >= 128
        rgba, lab, hid = shrink(a, np.where(drawn, p[..., 0], 0), p[..., 1] >= 128)
        q = np.zeros((*rgba.shape[:2], 4), np.uint8)
        q[..., 0] = lab
        q[..., 1] = np.where(hid, 255, 0)
        q[..., 3] = 255
        pieces[at[key][:2]] = (rgba, q, (ox - left) // D * N, (oy - top) // D * N)
    px = py = shelf = 0
    places = {}
    for k, (rgba, _, _, _) in pieces.items():
        h, w = rgba.shape[:2]
        if px + w > GEAR_W:
            px, py, shelf = 0, py + shelf + 1, 0
        places[k] = (px, py)
        px += w + 1
        shelf = max(shelf, h)
    H = py + shelf + 1
    out = np.zeros((H, GEAR_W, 4), np.uint8)
    out_part = np.zeros((H, GEAR_W, 4), np.uint8)
    out_part[..., 3] = 255
    frames = {}
    for k, (rgba, q, dx, dy) in pieces.items():
        x, y = places[k]
        h, w = rgba.shape[:2]
        out[y:y + h, x:x + w] = rgba
        out_part[y:y + h, x:x + w] = q
        frames[f"{k[0]},{k[1]}"] = [x, y, w, h, dx, dy]
    Image.fromarray(out).save(f"{g}@small.webp", lossless=True, method=6)
    Image.fromarray(out_part).save(f"{g}@small.png", optimize=True)
    json.dump({"refs": lay["refs"], "frames": frames}, open(f"{g}@small.json", "w"))
    print(f"  {item} on {kid}: {len(frames)} pieces, {GEAR_W}x{H}")


def set_entry(kid, entry, at):
    """Points the kid's index entry at its small sheet."""
    for path in (f"{CHARS}/bases/index.json", f"{CHARS}/index.json"):
        before = open(path).read()
        entries = json.loads(before)
        hit = False
        for e in entries:
            if e.get("id") == kid and f"{kid}-detail/" in e.get("atlas", ""):
                e["small"] = {**entry, **({"card": small_card(e["card"], at)} if "card" in e else {})}
                hit = True
        if hit:
            with open(path, "w") as f:
                f.write(json.dumps(entries, indent=1) + ("\n" if before.endswith("\n") else ""))


def main(kids):
    for kid in kids:
        entry, at = sheet(kid)
        set_entry(kid, entry, at)
        for item in sorted(os.listdir(f"{CHARS}/gear")):
            if os.path.isdir(f"{CHARS}/gear/{item}"):
                gear(item, kid, at)


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "--gear":
        gear(args[1], args[2])
    else:
        main(args)
