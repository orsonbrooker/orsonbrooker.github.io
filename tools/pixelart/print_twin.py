"""The jersey-only copy of a kid's pixel sheet, for printing the number and team name on their video sheets.

A video sheet (`<kid>-detail/`) prints the number and team name from its pixel-art twin (`printsFrom`,
play/players.js twinPrints). The game only reads the twin's jersey and trim pixels for that (the jersey's
shape in each frame, players/pixelkit.js), so the twin it downloads is `<kid>-pixel/prints.png`: the same
sheet, same size and places, with every other pixel see-through. It's a fraction of the size of the whole
sheet, which `?pixel` still plays from.

  uv run --with pillow --with numpy python3 tools/pixelart/print_twin.py orson curly buns

writes each kid's prints.png and points every `<kid>-detail/sprites*.json` at it. video_body.py does the
same when it rebuilds a kid.
"""

import glob
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

CHARS = "assets/characters"


def stamp(path):
    """A short stamp of a file's contents, for cache-busting its URL."""
    return hashlib.sha1(open(path, "rb").read()).hexdigest()[:8]


def write_prints(pixel_dir):
    """Writes `pixel_dir`/prints.png (only the jersey and trim pixels) and returns its URL, stamped."""
    meta = json.load(open(os.path.join(pixel_dir, "sprites.json")))
    img = np.array(Image.open(os.path.join(pixel_dir, "sprites.png")).convert("RGBA"))
    slots = [s for part in ("jersey", "team") for s in meta["palette"].get(part, [])]
    keep_rgb = {tuple(meta["rgb"][s][:3]) for s in slots}
    rgb = img[..., :3].astype(np.uint32)
    key = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
    keep = np.isin(key, [(r << 16) | (g << 8) | b for r, g, b in keep_rgb]) & (img[..., 3] > 0)
    # An indexed PNG: index 0 see-through, then the ten jersey and trim colours exactly.
    colours = sorted(keep_rgb)
    index = np.zeros(key.shape, np.uint8)
    for i, (r, g, b) in enumerate(colours, 1):
        index[keep & (key == ((r << 16) | (g << 8) | b))] = i
    out = Image.fromarray(index, "P")
    out.putpalette([0, 0, 0] + [v for c in colours for v in c])
    path = os.path.join(pixel_dir, "prints.png")
    out.save(path, optimize=True, transparency=0)
    return f"{pixel_dir}/prints.png?v={stamp(path)}"


def main(kids):
    for kid in kids:
        pixel_dir = f"{CHARS}/{kid}-pixel"
        url = write_prints(pixel_dir)
        for path in sorted(glob.glob(f"{CHARS}/{kid}-detail/sprites*.json")):
            meta = json.load(open(path))
            if "printsFrom" not in meta:
                continue
            meta["printsFrom"]["atlas"] = url
            json.dump(meta, open(path, "w"), separators=(",", ":"))
        whole = os.path.getsize(f"{pixel_dir}/sprites.png") // 1024
        print(f"{kid}: prints.png {os.path.getsize(f'{pixel_dir}/prints.png') // 1024} KB (whole sheet {whole} KB)")


if __name__ == "__main__":
    main(sys.argv[1:] or ["orson", "curly", "buns"])
