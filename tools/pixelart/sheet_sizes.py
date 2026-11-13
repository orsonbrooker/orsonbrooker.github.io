"""Smaller copies of a kid's full-detail sheet and of their gear, for screens that draw it smaller.

A full-detail sheet is 4096 wide and up to 18 megapixels. Where the game or the builder draws it shrunk
(a phone's court is about 780 pixels across), a smaller copy shows exactly as much, and is much quicker to
load, recolour, dress and stretch. players/recolor.js picks the smallest size that isn't drawn enlarged
(pickSize). On iOS a canvas can't hold more than 16.7 megapixels, so a sheet that can't fit there with gear
and the biggest build also gets the largest size that can.

SIZES (name: fraction of full size):
  small   2/3    every kid
  medium  4/5    only a kid whose full sheet can't fit an iOS canvas (Buns)

For each kid (`<kid>-detail/`) and size:
  sprites@<size>.webp, regions@<size>.png, sprites@<size>.json   every frame at that size, packed afresh:
      frames, offsets, held balls and the print frames' keys moved to match, `res` scaled (`fullRes` keeps
      the full sheet's, for sizes worked out from it)
and its entry in assets/characters/bases/index.json (or Orson's in assets/characters/index.json) gets
`pixels` (the full sheet's) and `sizes`: { <size>: { scale, pixels, atlas, meta, regions, card } }, with
?v= stamps. For each gear item made for the kid:
  gear/<item>/<kid>@<size>.webp, .png, .json     the same pieces at that size, keyed by that sheet's frames,
      stamped in gear/index@<size>.json ({item: {kid: stamp}}, like gear/index.json)

Colours are averaged over the area each new pixel covers (as the browser would shrink them); the region map
takes the region covering most of it, so labels stay exact; a gear piece hides a body pixel if it hid any
part of it, so no hair pokes out round a hat. Frames and gear pieces start on whole blocks (3 pixels for
2/3), so every frame shrinks the same way and gear lines up with the body exactly; a piece's box only grows.

It runs as the last step of a rebuild, so the copies never go stale: video_bases.py for the kids it points
at, gear_key.py for each gear layer it writes.

  python tools/pixelart/sheet_sizes.py curly buns orson    every kid named, and all their gear
  python tools/pixelart/sheet_sizes.py --gear beanie curly one item for one kid
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHARS = f"{ROOT}/assets/characters"
SIZES = {"small": (2, 3), "medium": (4, 5)}
IOS_LIMIT = 16_777_216  # pixels in one canvas on iOS
GROWTH = 1.2  # how much bigger a sheet gets with gear on and the tallest, broadest build
GAP = 2  # clear pixels between frames, so smoothing never picks up a neighbour
GEAR_W = 1024


def stamp(*paths):
    return hashlib.md5(b"".join(open(p, "rb").read() for p in paths)).hexdigest()[:8]


def rel(path):
    return os.path.relpath(path, ROOT)


def sizes_for(meta_pixels):
    """The sizes a kid's sheet gets: small always, medium when the full one can't fit an iOS canvas."""
    return [s for s in SIZES if s == "small" or meta_pixels * GROWTH > IOS_LIMIT]


class Size:
    def __init__(self, name):
        self.name = name
        self.n, self.d = SIZES[name]
        self.sheet_w = 4096 * self.n // self.d

    def of(self, v):
        """A full-size length or position at this size (whole when it comes out whole)."""
        s = v * self.n / self.d
        return int(round(s)) if abs(s - round(s)) < 1e-9 else round(s, 3)

    def blocks(self, v):
        """Pixels after shrinking v full pixels, padded up to whole blocks."""
        return -(-v // self.d) * self.n

    def layout(self, meta):
        """Where each full frame goes on this size's sheet: ({"x,y": (qx, qy, w, h)}, sheet height). Worked out
        from the full sheet's meta alone, so the sheet and its gear always agree."""
        px = py = shelf = 0
        at = {}
        for key, (x, y, w, h) in unique_frames(meta).items():
            w2, h2 = self.blocks(w), self.blocks(h)
            if px + w2 > self.sheet_w:
                px, py, shelf = 0, py + shelf + GAP, 0
            at[key] = (px, py, w2, h2)
            px += w2 + GAP
            shelf = max(shelf, h2)
        return at, py + shelf + GAP

    def padded(self, arr, x0, y0, w, h, left=0, top=0):
        """arr[y0:y0+h, x0:x0+w] placed at (left, top) in a zero array grown to whole blocks."""
        W2, H2 = -(-(left + w) // self.d) * self.d, -(-(top + h) // self.d) * self.d
        out = np.zeros((H2, W2, *arr.shape[2:]), arr.dtype)
        out[top:top + h, left:left + w] = arr[y0:y0 + h, x0:x0 + w]
        return out

    def shrink(self, rgba, labels=None, hide=None):
        """rgba: (h, w, 4) uint8, h and w whole blocks. Colour: the average of the drawn pixels each new pixel
        covers; alpha: their share. labels (h, w): the label covering most of the drawn part (0 if none drawn).
        hide (h, w) bool: hidden if any of it is. Returns (rgba, labels, hide) at this size."""
        h, w = rgba.shape[:2]
        size = (w * self.n // self.d, h * self.n // self.d)
        area = lambda a: np.asarray(Image.fromarray(a.astype(np.float32), "F").resize(size, Image.BOX))
        a = rgba[..., 3].astype(np.float32) / 255
        cov = area(a)
        out = np.zeros((size[1], size[0], 4), np.uint8)
        for c in range(3):
            out[..., c] = (area(rgba[..., c] * a) / np.maximum(cov, 1e-6)).round().clip(0, 255)
        out[..., 3] = (cov * 255).round().clip(0, 255)
        lab = None
        if labels is not None:
            drawn = a >= 0.5
            best = np.zeros(size[::-1], np.uint8)
            best_n = np.zeros(size[::-1], np.float32)
            for v in np.unique(labels):
                if v == 0:
                    continue
                n = area(((labels == v) & drawn).astype(np.float32))
                better = n > best_n + 1e-6
                best[better], best_n[better] = v, n[better]
            lab = best
        hid = None if hide is None else area(hide.astype(np.float32)) > 1e-6
        return out, lab, hid


def unique_frames(meta):
    """Each frame once, by its place on the sheet, in a fixed order: {"x,y": [x, y, w, h]}."""
    out = {}
    for frames in meta["frames"].values():
        for f in frames:
            out.setdefault(f"{f[0]},{f[1]}", f[:4])
    return dict(sorted(out.items(), key=lambda kv: (kv[1][1], kv[1][0])))


def sheet(kid, z, meta, img, reg):
    """The kid's sheet, region map and meta at size z; returns its `sizes` entry and the layout."""
    d = f"{CHARS}/{kid}-detail"
    at, H = z.layout(meta)
    out = np.zeros((H, z.sheet_w, 4), np.uint8)
    out_reg = np.zeros((H, z.sheet_w), np.uint8)
    for key, (x, y, w, h) in unique_frames(meta).items():
        qx, qy, w2, h2 = at[key]
        rgba, lab, _ = z.shrink(z.padded(img, x, y, w, h), z.padded(reg, x, y, w, h))
        out[qy:qy + h2, qx:qx + w2] = rgba
        out_reg[qy:qy + h2, qx:qx + w2] = lab
    base = f"{d}/sprites@{z.name}"
    Image.fromarray(out).save(f"{base}.webp", "WEBP", quality=82, method=6)
    reg_img = np.zeros((H, z.sheet_w, 4), np.uint8)
    reg_img[..., 0] = out_reg
    reg_img[..., 3] = np.where(out[..., 3] > 0, 255, 0)
    Image.fromarray(reg_img, "RGBA").save(f"{d}/regions@{z.name}.png", optimize=True)

    def moved(f):
        qx, qy, w2, h2 = at[f"{f[0]},{f[1]}"]
        return [qx, qy, w2, h2, z.of(f[4]), z.of(f[5])]

    key_of = lambda k: "{},{}".format(*at[k][:2])
    m = {**meta, "res": meta["res"] * z.n / z.d, "fullRes": meta.get("fullRes", meta["res"]),
         "frames": {name: [moved(f) for f in frames] for name, frames in meta["frames"].items()},
         "regionsFile": f"{rel(d)}/regions@{z.name}.png?v={stamp(f'{d}/regions@{z.name}.png')}"}
    if "balls" in meta:
        m["balls"] = {key_of(k): [z.of(v) for v in b] for k, b in meta["balls"].items() if k in at}
    if "printsFrom" in meta:
        m["printsFrom"] = {**meta["printsFrom"], "frames": {key_of(k): v for k, v in meta["printsFrom"]["frames"].items() if k in at}}
    json.dump(m, open(f"{base}.json", "w"))
    print(f"{kid} {z.name}: {img.shape[1]}x{img.shape[0]} ({img.shape[0] * img.shape[1] / 1e6:.1f} MP, {os.path.getsize(f'{d}/sprites.webp') // 1024} KB)"
          f" -> {z.sheet_w}x{H} ({H * z.sheet_w / 1e6:.1f} MP, {os.path.getsize(f'{base}.webp') // 1024} KB)")
    return {"scale": round(z.n / z.d, 4), "pixels": H * z.sheet_w,
            "atlas": f"{rel(base)}.webp?v={stamp(f'{base}.webp')}",
            "meta": f"{rel(base)}.json?v={stamp(f'{base}.json')}",
            "regions": f"{rel(d)}/regions@{z.name}.png?v={stamp(f'{d}/regions@{z.name}.png')}"}, at


def gear(item, kid, at=None, z=None):
    """One gear layer at size z (every size the kid has, if not given), keyed by that size's sheet."""
    g = f"{CHARS}/gear/{item}/{kid}"
    if not os.path.exists(f"{g}.json"):
        return
    if z is None:
        for name in kid_sizes(kid):
            gear(item, kid, None, Size(name))
        return
    if at is None:
        at, _ = z.layout(json.load(open(f"{CHARS}/{kid}-detail/sprites.json")))
    lay = json.load(open(f"{g}.json"))
    art = np.asarray(Image.open(f"{g}.webp").convert("RGBA"))
    part = np.asarray(Image.open(f"{g}.png").convert("RGBA"))
    pieces = {}
    for key, (ax, ay, pw, ph, ox, oy) in lay["frames"].items():
        if key not in at:
            continue
        # line the piece up with the frame's blocks: start it a whole number of blocks from the frame's corner
        # (its box grows outward to whole blocks, so no edge pixel is lost)
        left, top = ox % z.d, oy % z.d
        a = z.padded(art, ax, ay, pw, ph, left, top)
        p = z.padded(part, ax, ay, pw, ph, left, top)
        drawn = a[..., 3] >= 128
        rgba, lab, hid = z.shrink(a, np.where(drawn, p[..., 0], 0), p[..., 1] >= 128)
        q = np.zeros((*rgba.shape[:2], 4), np.uint8)
        q[..., 0] = lab
        q[..., 1] = np.where(hid, 255, 0)
        q[..., 3] = 255
        pieces[at[key][:2]] = (rgba, q, (ox - left) // z.d * z.n, (oy - top) // z.d * z.n)
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
    base = f"{g}@{z.name}"
    Image.fromarray(out).save(f"{base}.webp", lossless=True, method=6)
    Image.fromarray(out_part).save(f"{base}.png", optimize=True)
    json.dump({"refs": lay["refs"], "frames": frames}, open(f"{base}.json", "w"))
    # its own stamp (a change to the shrinking alone still reaches players), in gear/index@<size>.json
    ipath = f"{CHARS}/gear/index@{z.name}.json"
    index = json.load(open(ipath)) if os.path.exists(ipath) else {}
    index.setdefault(item, {})[kid] = stamp(f"{base}.webp", f"{base}.png", f"{base}.json")
    json.dump(dict(sorted((k, dict(sorted(v.items()))) for k, v in index.items())), open(ipath, "w"), indent=1)
    print(f"  {item} on {kid} {z.name}: {len(frames)} pieces, {GEAR_W}x{H}")


def kid_sizes(kid):
    d = f"{CHARS}/{kid}-detail"
    with Image.open(f"{d}/sprites.webp") as im:
        return sizes_for(im.width * im.height)


def set_entry(kid, pixels, sizes, ats):
    """Points the kid's index entry at its sizes."""
    for path in (f"{CHARS}/bases/index.json", f"{CHARS}/index.json"):
        before = open(path).read()
        entries = json.loads(before)
        hit = False
        for e in entries:
            if e.get("id") == kid and f"{kid}-detail/" in e.get("atlas", ""):
                e.pop("small", None)
                e["pixels"] = pixels
                e["sizes"] = {}
                for name, entry in sizes.items():
                    if "card" in e:
                        z, (x, y, w, h, dx, dy, side) = Size(name), e["card"]
                        qx, qy, w2, h2 = ats[name][f"{x},{y}"]
                        entry = {**entry, "card": [qx, qy, w2, h2, z.of(dx), z.of(dy), z.of(side)]}
                    e["sizes"][name] = entry
                hit = True
        if hit:
            with open(path, "w") as f:
                f.write(json.dumps(entries, indent=1) + ("\n" if before.endswith("\n") else ""))


def main(kids):
    for kid in kids:
        d = f"{CHARS}/{kid}-detail"
        meta = json.load(open(f"{d}/sprites.json"))
        img = np.asarray(Image.open(f"{d}/sprites.webp").convert("RGBA"))
        reg = np.asarray(Image.open(f"{d}/regions.png").convert("RGBA"))[..., 0]
        sizes, ats = {}, {}
        for name in sizes_for(img.shape[0] * img.shape[1]):
            z = Size(name)
            sizes[name], ats[name] = sheet(kid, z, meta, img, reg)
            for item in sorted(os.listdir(f"{CHARS}/gear")):
                if os.path.isdir(f"{CHARS}/gear/{item}"):
                    gear(item, kid, ats[name], z)
        set_entry(kid, img.shape[0] * img.shape[1], sizes, ats)


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "--gear":
        gear(args[1], args[2])
    else:
        main(args)
