"""Cuts every drawing of a kid's full-detail sheet into grids for Flow to repaint (key_hair.py, ball_key.py):
24 frames per 16:9 image (8 x 3) on green, angles mixed so each grid shows front, side and back.

  python tools/pixelart/frame_grids.py assets/characters/buns-detail <out dir> [--moves]

--moves keeps each move's frames together in one grid (for gear: every frame of a dribble then comes from
the same painting, so an item can't change from frame to frame within a move).

Writes <out>/grid-NN.jpg and <out>/grids.json (where each frame went: its sheet rect, grid, cell box and
scale). Upload the grids to Flow under names unique to the kid (e.g. buns-grid-NN.jpg).
"""
import json
import os
import sys

from PIL import Image

W, H, COLS, ROWS = 1376, 768, 8, 3


def facing(anim):
    return "b" if anim.endswith(("-b", "-bl", "-br")) else "s" if anim.endswith(("-l", "-r")) else "f"


def by_move(rects):
    """Whole moves per grid, biggest first, each into the first grid with room."""
    moves = {}
    for anim, r in rects:
        moves.setdefault(anim, []).append((anim, r))
    grids = []
    for frames in sorted(moves.values(), key=len, reverse=True):
        for g in grids:
            if len(g) + len(frames) <= COLS * ROWS:
                g.extend(frames)
                break
        else:
            grids.append(list(frames))
    order = []
    for g in grids:
        order.extend(g + [None] * (COLS * ROWS - len(g)))
    while order and order[-1] is None:
        order.pop()
    return order


def main(d, out, moves=False):
    os.makedirs(out, exist_ok=True)
    meta = json.load(open(f"{d}/sprites.json"))
    sheet = Image.open(f"{d}/sprites.webp").convert("RGBA")
    rects, seen = [], set()
    for anim, frames in meta["frames"].items():
        for f in frames:
            r = tuple(f[:4])
            if r not in seen:
                seen.add(r)
                rects.append((anim, r))
    if moves:
        order = by_move(rects)
    else:
        # dealt out round-robin by facing, so every grid has each angle
        groups = {k: [r for r in rects if facing(r[0]) == k] for k in "fsb"}
        order = []
        while any(groups.values()):
            for k in "fbs":
                if groups[k]:
                    order.append(groups[k].pop(0))
    cw, ch = W // COLS, H // ROWS
    layout = []
    for g in range(0, len(order), COLS * ROWS):
        im = Image.new("RGB", (W, H), (0, 177, 64))
        for k, cell in enumerate(order[g:g + COLS * ROWS]):
            if cell is None:
                continue
            anim, (x, y, w, h) = cell
            s = min((cw - 10) / w, (ch - 10) / h)
            cell = sheet.crop((x, y, x + w, y + h)).resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
            cx, cy = (k % COLS) * cw + (cw - cell.width) // 2, (k // COLS) * ch + (ch - cell.height) // 2
            im.paste(cell, (cx, cy), cell)
            layout.append({"grid": g // (COLS * ROWS), "rect": [x, y, w, h], "box": [cx, cy, cell.width, cell.height], "s": s, "anim": anim})
        im.save(f"{out}/grid-{g // (COLS * ROWS):02d}.jpg", quality=93)
    json.dump(layout, open(f"{out}/grids.json", "w"))
    print(sum(c is not None for c in order), "frames,", (len(order) + COLS * ROWS - 1) // (COLS * ROWS), "grids")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], "--moves" in sys.argv)
