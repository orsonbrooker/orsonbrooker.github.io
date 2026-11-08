"""Builds a .pix text file (pixel art written as letters) into the sheet and sprites.json the game loads.

Usage: uv run --with pillow --with numpy python3 tools/pixelart/build.py art/pixel/spiky.pix [out-dir]
  (default out-dir: assets/characters/lab/<name>/)

.pix format (tools/pixelart/convert.py writes the first version of one):
  palette                       then one line per colour:  <letter> #rrggbb [part tone]
  colours {...}                 the body's own part colours
  anims {"idle": [...], ...}    frame names for each animation, in order (played at the game's speed)
  frame <name> feet <x> <y>     then the frame's rows, one letter per pixel ('.' see-through);
                                feet: where the feet are, in pixels from the frame's top-left corner
  timeline <anim> <fps>         an animation made by code from the drawn frames, played at its own
                                speed; then one line per frame, until a blank line:
      <frame> [x <n>] [y <n>] [sink <neck|waist|row> <n>] [lift <neck|waist|row> <n>]
              [bend <pivot x> <end x> <from y> <n>] [ball <sprite> <x> <y> [squash] [flip] [under]]
        x, y   move the whole drawing n pixels (y < 0 is up)
        sink   squash: everything above the neck (top of the jersey) or the waist (bottom of the
               jersey) sinks n pixels, the rows just below absorbing it - breathing, crouching, landing
        lift   stretch: the same, rising n pixels - taking off, reaching
        bend   swings a limb down about a joint: every column left of pivot x (and below from y)
               sinks, more the further it is, n pixels at end x - a forearm pushing down
        ball   draws another frame (a sprite, e.g. the ball cut out by tools/pixelart/ball.py) on top,
               its centre (its "feet") x, y pixels from this frame's feet; squash makes it a pixel
               flatter (sitting on the same bottom), flip mirrors it (a spinning ball), under draws
               it behind the frame's own pixels (a hand on top of the ball)
      A timeline replaces that animation in anims.
Writes an indexed PNG (sprites.png, palette slot = letter) and sprites.json with res 0.25 (4 court
pixels per art pixel), the frames, each timeline's fps, and which palette slots belong to which part.
"""
import json, os, sys
import numpy as np
from PIL import Image

src = sys.argv[1]
name = os.path.splitext(os.path.basename(src))[0]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "..", "assets", "characters", "lab", name)
os.makedirs(out, exist_ok=True)

palette, letters, parts = [(0, 0, 0)], {".": 0}, {}
colours, anims, frames, fps, timelines = {}, {}, {}, {}, {}
cur = None
section = None
for raw in open(src):
    line = raw.rstrip("\n")
    if not line:
        section = None if section == "timeline" else section
        cur = None
        continue
    if line.startswith("#"):
        continue
    word = line.split()[0]
    if word == "palette":
        section = "palette"
    elif word == "colours":
        colours = json.loads(line[len("colours"):])
        section = None
    elif word == "anims":
        anims = json.loads(line[len("anims"):])
        section = None
    elif word == "frame":
        _, fname, _, fx, fy = line.split()
        cur = fname
        frames[cur] = {"feet": (int(fx), int(fy)), "rows": []}
        section = "frame"
    elif word == "timeline":
        _, anim, speed = line.split()
        cur = anim
        timelines[anim] = []
        fps[anim] = float(speed)
        section = "timeline"
    elif section == "palette":
        bits = line.split()
        letters[bits[0]] = len(palette)
        palette.append(tuple(int(bits[1][i:i + 2], 16) for i in (1, 3, 5)))
        if len(bits) == 4:
            parts.setdefault(bits[2], [None] * 5)[int(bits[3])] = len(palette) - 1
    elif section == "frame" and cur:
        frames[cur]["rows"].append(line)
    elif section == "timeline" and cur:
        bits = line.split()
        step = {"frame": bits[0], "x": 0, "y": 0, "ops": []}
        i = 1
        while i < len(bits):
            if bits[i] in ("x", "y"):
                step[bits[i]] = int(bits[i + 1])
                i += 2
            elif bits[i] in ("sink", "lift"):
                step["ops"].append((bits[i], bits[i + 1], int(bits[i + 2])))
                i += 3
            elif bits[i] == "bend":
                step["ops"].append(("bend", "", tuple(int(v) for v in bits[i + 1:i + 5])))
                i += 5
            elif bits[i] == "ball":
                flags = []
                j = i + 4
                while j < len(bits) and bits[j] in ("squash", "flip", "under"):
                    flags.append(bits[j])
                    j += 1
                step["ops"].append(("ball", bits[i + 1], (round(float(bits[i + 2])), round(float(bits[i + 3])), tuple(flags))))
                i = j
            else:
                raise SystemExit(f"timeline {cur}: don't know '{bits[i]}' in: {line}")
        timelines[cur].append(step)

grids = {}
for fname, f in frames.items():
    w = max(len(r) for r in f["rows"])
    grids[fname] = np.array([[letters[c] for c in r.ljust(w, ".")] for r in f["rows"]], np.uint8)

jersey = set(parts.get("jersey", [])) - {None}
team = set(parts.get("team", [])) - {None}


def line_row(g, where):
    """The row a squash or stretch happens at: the neck (top of the jersey), the waist (bottom of
    the jersey) or a row number."""
    if where.isdigit():
        return int(where)
    rows = [i for i, r in enumerate(g) if np.isin(r, list(jersey)).any()]
    if where == "neck":
        return rows[0]
    return max(i for i in rows if not np.isin(g[i], list(team)).any())


def squash(g, cut, n):
    """Everything above row `cut` sinks n pixels; the rows just below take it, drawn-over pixels winning."""
    g = g.copy()
    for _ in range(n):
        moved = np.vstack([np.zeros((1, g.shape[1]), g.dtype), g[:cut]])
        merged = np.where(moved[cut] != 0, moved[cut], g[cut])
        g = np.vstack([moved[:cut], merged[None], g[cut + 1:]])
    return g


def stretch(g, cut, n):
    """Everything above row `cut` rises n pixels; row `cut` is repeated to fill the gap. The grid grows
    by n rows at the top so nothing is cut off."""
    for _ in range(n):
        g = np.vstack([np.zeros((1, g.shape[1]), g.dtype), g])
        cut += 1
        g = np.vstack([g[1:cut], g[cut - 1:cut], g[cut:]])
    return g


def bend(g, fx, fy, pivot, end, top, n):
    """Columns left of `pivot` (x from the feet), below row `top` (y from the feet), sink by up to n
    pixels, in proportion to how far they are from the pivot (n at `end`). The grid grows at the
    bottom if anything sinks past it."""
    g = np.vstack([g, np.zeros((n, g.shape[1]), g.dtype)])
    out = g.copy()
    y0 = fy + top
    for col in range(g.shape[1]):
        x = col - fx
        if x >= pivot:
            continue
        d = round(n * min(1.0, (pivot - x) / (pivot - end)))
        if d <= 0:
            continue
        column = g[y0:, col]
        out[y0:, col] = 0
        out[y0 + d:, col] = column[:len(column) - d]
    return out


def overlay(g, fx, fy, sprite, x, y, flags):
    """Draws `sprite` over g with its centre x, y pixels from g's feet, growing g if it pokes out."""
    b = grids[sprite]
    bx, by = frames[sprite]["feet"]
    if "flip" in flags:
        b = b[:, ::-1]
        bx = b.shape[1] - 1 - bx
    if "squash" in flags:  # one pixel flatter: drop the middle row, keep the bottom where it was
        mid = b.shape[0] // 2
        b = np.vstack([b[:mid], b[mid + 1:]])
        by -= 1
    top, left = fy + y - by, fx + x - bx  # where the sprite's corner lands in g
    pad_t, pad_l = max(0, -top), max(0, -left)
    pad_b = max(0, top + b.shape[0] - g.shape[0])
    pad_r = max(0, left + b.shape[1] - g.shape[1])
    g = np.pad(g, ((pad_t, pad_b), (pad_l, pad_r)))
    top, left, fx, fy = top + pad_t, left + pad_l, fx + pad_l, fy + pad_t
    region = g[top:top + b.shape[0], left:left + b.shape[1]]
    if "under" in flags:  # only where the frame is see-through
        g[top:top + b.shape[0], left:left + b.shape[1]] = np.where(region != 0, region, b)
    else:
        g[top:top + b.shape[0], left:left + b.shape[1]] = np.where(b != 0, b, region)
    return g, fx, fy


# Frames made by the timelines: the drawing with its squashes and stretches applied.
made = {}  # key -> (grid, feet x, feet y)
steps_of = {}
for anim, steps in timelines.items():
    names = []
    for s in steps:
        if s["frame"] not in grids:
            raise SystemExit(f"timeline {anim}: no frame called {s['frame']}")
        key = s["frame"] + "".join(f"_{op}{where}{n}".replace(" ", "").replace("'", "").replace(",", "_").replace("(", "").replace(")", "") for op, where, n in s["ops"])
        if key not in made and key not in grids:
            g = grids[s["frame"]]
            fx, fy = frames[s["frame"]]["feet"]
            for op, where, n in s["ops"]:
                if op == "ball":
                    g, fx, fy = overlay(g, fx, fy, where, *n)
                    continue
                if op == "bend":
                    g = bend(g, fx, fy, *n)
                    continue
                cut = line_row(g, where)
                if op == "sink":
                    g = squash(g, cut, n)
                else:
                    g = stretch(g, cut, n)
                    fy += n
            made[key] = (g, fx, fy)
        names.append((key, s["x"], s["y"]))
    steps_of[anim] = names
for key, (g, fx, fy) in made.items():
    grids[key] = g
    frames[key] = {"feet": (fx, fy)}

# Pack the frames side by side, 2 pixels apart.
H = max(g.shape[0] for g in grids.values())
W = sum(g.shape[1] + 2 for g in grids.values())
sheet = np.zeros((H, W), np.uint8)
rects, x = {}, 0
for fname, g in grids.items():
    h, w = g.shape
    sheet[:h, x:x + w] = g
    fx, fy = frames[fname]["feet"]
    rects[fname] = [x, 0, w, h, -fx, -fy]
    x += w + 2

out_frames = {a: [rects[n] for n in names] for a, names in anims.items()}
for anim, names in steps_of.items():
    out_frames[anim] = [[*rects[k][:4], rects[k][4] + dx, rects[k][5] + dy] for k, dx, dy in names]

im = Image.fromarray(sheet, "P")
im.putpalette([c for rgb in palette for c in rgb])
im.save(os.path.join(out, "sprites.png"), optimize=True, transparency=0)
sprites = {
    "res": 0.25,
    "frames": out_frames,
    "palette": parts,
    "colours": colours,
    "rgb": [list(c) for c in palette],
    "layers": {},
    "fps": fps,
}
json.dump(sprites, open(os.path.join(out, "sprites.json"), "w"), separators=(",", ":"))
for f in ("sprites.png", "sprites.json"):
    print(f, os.path.getsize(os.path.join(out, f)), "bytes")
print("sheet", W, "x", H, len(grids), "drawings,", ", ".join(f"{a} {len(v)} frames" for a, v in out_frames.items()))
