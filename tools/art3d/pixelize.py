"""Turns the renders from render_body.py into an indexed-palette sprite sheet for the game.

Usage: uv run --with pillow --with numpy python3 tools/art3d/pixelize.py <render-dir> <out-dir>

Each art pixel is one 4x4 block of the render: its part is the block's most common part, its
light is the block's average grey, cut into four tones (dark, shadow, mid, light) plus a darker
outline tone round the edge and where shapes overlap. The palette is laid out part by part, five slots each, so changing a
player's colours is just rewriting those four palette slots (see PALETTE_PARTS in sprites.json):
no regions map and no per-pixel maths. The hair and the cap are separate sheets with the same frame
layout, drawn on top (a cap replaces the hair, since it brings its own hat hair).
"""
import colorsys, json, os, sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
meta = json.load(open(os.path.join(SRC, "poses.json")))
FW, FH = meta["frame"]
SS = meta["ss"]
ORDER = list(meta["parts"])
DEFAULT = {
    "skin": "#e0a983", "hair": "#9a6b3e", "jersey": "#f2f2ef", "team": "#2c3e7a", "shoes": "#3a3442",
    "socks": "#f2f2ef", "ball": "#e2702c", "line": "#2a1e26", "cap": "#d63a3a", "capteam": "#f2f2ef",
    "sole": "#ece6dc",
}
NEAR, FAR = meta["depth"]
CAP_PARTS = {ORDER.index("cap"), ORDER.index("capteam")}
# Palette parts: the rendered ones, then ones only painted on by hand (the eye highlights).
PAL_ORDER = ORDER + ["eyes"]
DEFAULT["eyes"] = "#fbf7f2"


SLOTS = 5  # palette slots per part: outline, dark, shadow, mid, light


def ramp(hexcol):
    """Five tones from one colour: outline, dark, shadow, mid, light. Shadows lean cooler and redder,
    light leans warmer, like hand-picked pixel-art ramps. ramp() in play/artlab.js does the same."""
    r, g, b = (int(hexcol[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    def tone(dh, lk, sk, lift=0):
        l2 = min(1, l * lk + (1 - l) * lift)
        return tuple(round(c * 255) for c in colorsys.hls_to_rgb((h + dh / 360) % 1, l2, min(1, s * sk)))
    return [tone(-16, 0.42, 0.95, 0.04), tone(-11, 0.62, 1.0, 0.04), tone(-6, 0.8, 1.0), tone(0, 1, 1), tone(6, 1, 0.95, 0.3)]


def srgb(c):
    return 255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)


ID_COLS = np.array([[srgb(c) for c in meta["parts"][p]] for p in ORDER])


def blocks(a):
    """Groups a 4x-size image into one row of 16 values per art pixel."""
    return a.reshape(FH, SS, FW, SS, *a.shape[2:]).swapaxes(1, 2).reshape(FH, FW, SS * SS, *a.shape[2:])


def load_pose(tag):
    """Per art pixel: its part, how lit it is, which object it is and how far away (in Blender units)."""
    rd = lambda kind: Image.open(os.path.join(SRC, f"{tag}_{kind}.png"))
    idimg = np.asarray(rd("id").convert("RGBA")).astype(float)
    # How lit: mostly the sun pass (clear light and shadow shapes), plus the studio pass with cavity
    # for creases and ridges.
    sun = np.asarray(rd("light").convert("L")).astype(float) / 255
    studio = np.asarray(rd("tone").convert("L")).astype(float) / 255
    lit = np.asarray(rd("light").convert("LA"))[..., 1] > 127
    norm = lambda a: (a - np.percentile(a[lit], 3)) / max(1e-3, np.percentile(a[lit], 97) - np.percentile(a[lit], 3))
    tone = np.clip(0.65 * norm(sun) + 0.35 * norm(studio), 0, 1)
    obj = np.asarray(rd("obj").convert("RGB")).astype(np.int64)
    obj = (obj[..., 0] << 16) | (obj[..., 1] << 8) | obj[..., 2]
    depth = NEAR + np.asarray(rd("depth")).astype(float) / 65535 * (FAR - NEAR)
    alpha = idimg[..., 3] > 127
    d = ((idimg[..., None, :3] - ID_COLS[None, None]) ** 2).sum(-1)
    part = np.where(alpha, d.argmin(-1), -1)
    pb, tb, ob, db = blocks(part), blocks(tone), blocks(obj), blocks(depth)
    out_part = np.full((FH, FW), -1)
    out_tone = np.zeros((FH, FW))
    out_obj = np.zeros((FH, FW), np.int64)
    out_depth = np.zeros((FH, FW))
    for y in range(FH):
        for x in range(FW):
            cell = pb[y, x]
            opaque = cell[cell >= 0]
            if len(opaque) < SS * SS * 0.45:
                continue
            vals, counts = np.unique(opaque, return_counts=True)
            p = vals[counts.argmax()]
            mine = cell == p
            ov, oc = np.unique(ob[y, x][mine], return_counts=True)
            out_part[y, x] = p
            out_tone[y, x] = tb[y, x][mine].mean()
            out_obj[y, x] = ov[oc.argmax()]
            out_depth[y, x] = np.median(db[y, x][mine])
    return out_part, out_tone, out_obj, out_depth


def inner_lines(part, obj, depth):
    """Where one object passes in front of another of the same part (an arm across the body, one
    leg in front of the other, fingers over the palm), the pixel just behind the edge gets the dark
    outline tone, the way a pixel artist separates overlapping shapes. True where a line goes."""
    H, W = part.shape
    line = np.zeros((H, W), bool)
    for y in range(H):
        for x in range(W):
            p = part[y, x]
            if p < 0:
                continue
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                yy, xx = y + dy, x + dx
                if not (0 <= yy < H and 0 <= xx < W) or part[yy, xx] < 0:
                    continue
                gap = depth[y, x] - depth[yy, xx]  # > 0: this pixel is behind its neighbour
                same_part = part[yy, xx] == p
                # Another object of the same part in front (arm over arm, leg over leg), or anything
                # at all well in front (a hand over the ball, fingers over the palm).
                if (obj[yy, xx] != obj[y, x] and same_part and gap > 0.04) or gap > 0.12:
                    line[y, x] = True
    return line


def tidy(part):
    """Pixel-art clean-up: a lone pixel unlike all four neighbours takes their most common part."""
    p = part.copy()
    H, W = p.shape
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            n = [part[y - 1, x], part[y + 1, x], part[y, x - 1], part[y, x + 1]]
            if part[y, x] not in n:
                vals, counts = np.unique(n, return_counts=True)
                p[y, x] = vals[counts.argmax()]
    return p


def to_index(part, tone, keep=None, line=None):
    """Palette index per pixel: 0 is see-through, then SLOTS slots per part (outline, dark, shadow, mid, light).
    line: pixels that get the outline tone inside the shape too (see inner_lines)."""
    H, W = part.shape
    idx = np.zeros((H, W), np.uint8)
    t = np.select([tone > 0.8, tone > 0.52, tone > 0.28], [4, 3, 2], 1)
    for y in range(H):
        for x in range(W):
            p = part[y, x]
            if p < 0 or (keep is not None and p not in keep):
                continue
            # Outline: next to empty space (or, for a layer, next to anything outside the layer).
            edge = False
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                yy, xx = y + dy, x + dx
                q = part[yy, xx] if 0 <= yy < H and 0 <= xx < W else -1
                if q < 0 or (keep is not None and q not in keep):
                    edge = True
            edge = edge or (line is not None and line[y, x])
            idx[y, x] = 1 + SLOTS * p + (0 if edge else t[y, x])
    return idx


poses = list(meta["poses"])
HAIR = {ORDER.index("hair")}
LAYERS = {"body": ("bald", None), "hair": ("hair", HAIR), "cap": ("cap", CAP_PARTS | HAIR)}
layers = {k: {} for k in LAYERS}

# The face, drawn by hand as letters (a face is only ~30 art pixels wide, too small to model):
# B brow (hair shadow), b brow end (hair mid), L upper lash (line), K pupil (line), W eye highlight
# (eyes light), e eye white (eyes mid), w lower lid (skin outline), N nose shade (skin shadow),
# n nostril (skin outline), M mouth (line), m lip corner / lower lip (skin outline), C cheek (skin light).
# Drawn looking to the left of the screen; flipped for the other way. A is the anchor (eye level,
# face centre) and is itself left alone.
FACE_34 = [
    "...bBB....BBBb..",
    "................",
    "...LLL....LLLL..",
    "...eKW....eKKW..",
    "...eKK.A..eKKK..",
    "....w......ww...",
    "........N.......",
    "..C..........C..",
    "................",
    "........MM......",
]
FACE_INK = {"B": ("hair", 1), "b": ("hair", 2), "L": ("line", 3), "K": ("line", 3), "W": ("eyes", 4),
            "e": ("eyes", 3), "w": ("skin", 0), "N": ("skin", 2), "n": ("skin", 1), "M": ("line", 3),
            "m": ("skin", 1), "C": ("skin", 4)}
SKIN = ORDER.index("skin")


def paint_face(idx, part, pose):
    """Stamps the face onto the body layer, only onto face pixels (so hands and the ball in front
    of the face, and the hair layer drawn over it, still cover it)."""
    if pose["facing"] < 0.35:
        return
    rows = FACE_34 if pose["yaw"] <= 0 else [r[::-1] for r in FACE_34]
    ay = next(i for i, r in enumerate(rows) if "A" in r)
    ax = rows[ay].index("A")
    fx, fy = round(pose["face"][0]), round(pose["face"][1])
    for ry, row in enumerate(rows):
        for rx, ch in enumerate(row):
            if ch not in FACE_INK:
                continue
            y, x = fy + ry - ay, fx + rx - ax
            if 0 <= y < FH and 0 <= x < FW and part[y, x] == SKIN and (idx[y, x] - 1) % SLOTS != 0:  # skip the outline
                p, t = FACE_INK[ch]
                idx[y, x] = 1 + SLOTS * PAL_ORDER.index(p) + t


for name in poses:
    for layer, (variant, keep) in LAYERS.items():
        p, t, o, dep = load_pose(name + "_" + variant)
        p = tidy(p)
        layers[layer][name] = to_index(p, t, keep=keep, line=inner_lines(p, o, dep))
        if layer == "body":
            paint_face(layers[layer][name], p, meta["poses"][name])

# Pack the frames side by side, each trimmed to what either layer covers, 2px apart.
rects, x0 = {}, 0
for name in poses:
    m = np.logical_or.reduce([layers[k][name] > 0 for k in LAYERS])
    ys, xs = np.nonzero(m)
    rects[name] = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    x0 += xs.max() + 1 - xs.min() + 2
H = max(r[3] - r[1] for r in rects.values())
sheets = {k: np.zeros((H, x0), np.uint8) for k in LAYERS}
frames, x = {}, 0
for name in poses:
    l, t, r, b = rects[name]
    w, h = r - l, b - t
    for k in LAYERS:
        sheets[k][:h, x:x + w] = layers[k][name][t:b, l:r]
    fx, fy = (round(v) for v in meta["poses"][name]["feet"])
    frames[name] = [int(x), 0, int(w), int(h), int(l - fx), int(t - fy)]
    x += int(w) + 2

palette = [(0, 0, 0)]
for part in PAL_ORDER:
    for rgb in ramp(DEFAULT[part]):
        # Every slot needs its own colour so the game can tell slots apart (white socks and a
        # white jersey are still two parts): nudge repeats by one step of blue.
        while rgb in palette:
            rgb = (rgb[0], rgb[1], rgb[2] - 1 if rgb[2] else 1)
        palette.append(rgb)
flat = [c for rgb in palette for c in rgb]


def save(arr, path):
    im = Image.fromarray(arr, "P")
    im.putpalette(flat)
    im.save(path, optimize=True, transparency=0)


FILES = {"body": "sprites.png", "hair": "hair.png", "cap": "cap.png"}
for k, fname in FILES.items():
    save(sheets[k], os.path.join(OUT, fname))

f = lambda n: frames[n]
hx, hy = meta["poses"]["rel0"]["hand"]
fx, fy = meta["poses"]["rel0"]["feet"]
sprites = {
    "res": 0.25,  # 4 court pixels per art pixel
    "frames": {
        "idle": [f("idle0"), f("idle1"), f("idle0")],
        # Only idle and release are drawn for this test; the rest borrow them.
        "turn": [f("idle0")] * 7,
        "dribble": [f("idle0"), f("idle1")] * 4 + [f("idle0")],
        "gather": [f("rel1")] * 7,
        "jump": [f("rel0")] * 7,
        "release": [f("rel0")] * 3 + [f("rel1")] * 4,
    },
    "releaseOffset": [round(hx - fx), round(hy - fy)],
    "palette": {part: list(range(1 + SLOTS * i, 1 + SLOTS * (i + 1))) for i, part in enumerate(PAL_ORDER)},
    "colours": DEFAULT,
    "rgb": [list(c) for c in palette],  # the default palette, so the game can map pixels back to slots
    # Drawn on top of the body in this order; a hat replaces the hair (it has its own hat hair).
    "layers": {"hair": "hair.png", "cap": "cap.png"},
    "hats": {"cap": {"hides": "hair"}},
}
json.dump(sprites, open(os.path.join(OUT, "sprites.json"), "w"), separators=(",", ":"))
for n in (*FILES.values(), "sprites.json"):
    print(n, os.path.getsize(os.path.join(OUT, n)), "bytes")
print("sheet", sheets["body"].shape[::-1])
