"""Converts a current player body into true pixel art written as text.

Usage: uv run --with pillow --with numpy python3 tools/pixelart/convert.py <base-id>
  e.g. tools/pixelart/convert.py spiky  ->  art/pixel/spiky.pix

The current sprite sheets are painted at 3 sheet pixels per art pixel with soft edges (res 0.75). This
shrinks every frame to the art grid (1 art pixel = 4 court pixels), lining the feet up on a whole
pixel so frames never jitter, and gives it an indexed palette:
- each recolourable part (skin, hair, jersey, team, shoes) gets 5 slots: outline, dark, shadow, mid,
  light, taken from the original's own shades (so it keeps its look and can still be palette-swapped);
- everything else (socks, the ball, eyes, mouth, outlines) shares a small fixed set of colours.
It writes the result as a .pix text file: the palette, then every frame as rows of letters, one letter
per pixel. tools/pixelart/build.py turns .pix files into the sheet and sprites.json the game loads.
"""
import json, os, string, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASE = sys.argv[1] if len(sys.argv) > 1 else "spiky"
SRC = os.path.join(ROOT, "assets", "characters", "bases", BASE)
OUT = os.path.join(ROOT, "art", "pixel", BASE + ".pix")
K = 3  # sheet pixels per art pixel (res 0.75 -> 0.25)
PARTS = ["skin", "hair", "jersey", "team", "shoes"]  # regions.png ids 1..5
SLOTS = 5  # outline, dark, shadow, mid, light
N_FIXED = 22  # colours shared by everything that isn't recoloured
# One letter per palette slot: '.' is see-through.
LETTERS = string.ascii_letters + string.digits + "!#$%&*+/<=>?@^~"

meta = json.load(open(os.path.join(SRC, "sprites.json")))
sheet = np.asarray(Image.open(os.path.join(SRC, "sprites.webp")).convert("RGBA")).astype(float)
regions = np.asarray(Image.open(os.path.join(SRC, "regions.png")))[..., 0]
colours = next(b for b in json.load(open(os.path.join(ROOT, "assets", "characters", "bases", "index.json"))) if b["id"] == BASE)["colours"]
luma = lambda rgb: rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
OUTLINE_LUMA = 58  # darker than this in the original is a drawn outline

# ---------- Shrink each frame to the art grid ----------
names = {}  # rect -> frame name
for anim, frames in meta["frames"].items():
    seen = []
    for f in frames:
        r = tuple(f[:4])
        if r not in names:
            names[r] = f"{anim}{len([n for n in names.values() if n.startswith(anim)])}"
rect_of = {tuple(f[:4]): f for frames in meta["frames"].values() for f in frames}

frames = {}  # name -> (rgb, part, alpha, feet_x, feet_y)
for r, name in names.items():
    x, y, w, h, ox, oy = rect_of[r]
    fx, fy = x - ox, y - oy  # the feet in sheet pixels
    kx, ky = -(-(fx - x) // K), -(-(fy - y) // K)  # art pixels from the crop's corner to the feet
    cx, cy = fx - kx * K, fy - ky * K  # crop corner, so the feet land on an art-pixel corner
    W, H = -(-(x + w - cx) // K), -(-(y + h - cy) // K)
    pad = np.zeros((H * K, W * K, 4))
    preg = np.zeros((H * K, W * K), np.uint8)
    sx0, sy0 = max(cx, x), max(cy, y)
    pad[sy0 - cy:y + h - cy, sx0 - cx:x + w - cx] = sheet[sy0:y + h, sx0:x + w]
    preg[sy0 - cy:y + h - cy, sx0 - cx:x + w - cx] = regions[sy0:y + h, sx0:x + w]
    blk = pad.reshape(H, K, W, K, 4).swapaxes(1, 2).reshape(H, W, K * K, 4)
    rblk = preg.reshape(H, K, W, K).swapaxes(1, 2).reshape(H, W, K * K)
    opaque = blk[..., 3] > 127
    alpha = opaque.sum(-1) >= 4
    rgb = np.zeros((H, W, 3))
    part = np.zeros((H, W), np.int64)
    for j in range(H):
        for i in range(W):
            if not alpha[j, i]:
                continue
            o = opaque[j, i]
            px = blk[j, i][o][:, :3]
            # A dark outline wins the block if any of it is outline: keeps outlines 1 pixel and unbroken.
            dark = luma(px) < OUTLINE_LUMA
            if dark.sum() >= 3:
                px = px[dark]
            rgb[j, i] = np.median(px, 0)
            reg = rblk[j, i][o]
            vals, counts = np.unique(reg, return_counts=True)
            part[j, i] = vals[counts.argmax()]
    frames[name] = (rgb, part, alpha, kx, ky)

# ---------- Palette ----------
def kmeans1d(v, k, iters=30):
    c = np.percentile(v, np.linspace(10, 90, k))
    for _ in range(iters):
        lab = np.abs(v[:, None] - c[None]).argmin(1)
        c = np.array([v[lab == i].mean() if (lab == i).any() else c[i] for i in range(k)])
    return np.sort(c)


palette = [(0, 0, 0)]
slot = {}  # (part id, tone) -> palette index
assign = {}
for pid, pname in enumerate(PARTS, 1):
    pix = np.concatenate([f[0][(f[1] == pid) & f[2]] for f in frames.values()])
    L = luma(pix)
    body = L >= OUTLINE_LUMA
    centres = kmeans1d(L[body], 4)  # dark, shadow, mid, light
    tones = [pix[~body].mean(0) if (~body).any() else pix[L.argmin()]]  # outline: the part's own dark line colour
    lab = np.abs(L[body][:, None] - centres[None]).argmin(1)
    for t in range(4):
        sel = pix[body][lab == t]
        tones.append(sel.mean(0) if len(sel) else np.array([centres[t]] * 3))
    for t, c in enumerate(tones):
        slot[(pid, t)] = len(palette)
        palette.append(tuple(int(round(v)) for v in c))
    assign[pid] = centres

# Everything else: a small fixed palette (outlines, socks, ball, eyes, mouth).
rest = np.concatenate([f[0][(f[1] == 0) & f[2]] for f in frames.values()] +
                      [f[0][(f[1] > 0) & f[2] & (luma(f[0]) < OUTLINE_LUMA - 20)] for f in frames.values()])
q = Image.fromarray(rest.reshape(1, -1, 3).astype(np.uint8)).quantize(colors=N_FIXED, method=Image.Quantize.MEDIANCUT)
fixed = np.array(q.getpalette()[:N_FIXED * 3]).reshape(-1, 3)
fixed_start = len(palette)
palette += [tuple(int(v) for v in c) for c in fixed]


def index_frame(rgb, part, alpha):
    H, W = part.shape
    idx = np.zeros((H, W), np.int64)
    for j in range(H):
        for i in range(W):
            if not alpha[j, i]:
                continue
            c, p = rgb[j, i], part[j, i]
            Lc = luma(c[None])[0]
            if p and Lc >= OUTLINE_LUMA - 20:
                if Lc < OUTLINE_LUMA:
                    idx[j, i] = slot[(p, 0)]
                else:
                    idx[j, i] = slot[(p, 1 + int(np.abs(assign[p] - Lc).argmin()))]
            else:
                idx[j, i] = fixed_start + int(((fixed - c) ** 2).sum(1).argmin())
    # Clean-up: a lone pixel unlike all four neighbours (and not an eye or a line) joins its neighbours.
    out = idx.copy()
    for j in range(1, H - 1):
        for i in range(1, W - 1):
            n = [idx[j - 1, i], idx[j + 1, i], idx[j, i - 1], idx[j, i + 1]]
            if idx[j, i] and idx[j, i] not in n and idx[j, i] < fixed_start and all(n):
                vals, counts = np.unique(n, return_counts=True)
                out[j, i] = vals[counts.argmax()]
    return out


# ---------- Write the .pix text ----------
os.makedirs(os.path.dirname(OUT), exist_ok=True)
assert len(palette) - 1 <= len(LETTERS)
lines = [f"# {BASE}: converted from assets/characters/bases/{BASE} by tools/pixelart/convert.py",
         "# 1 letter = 1 art pixel = 4 court pixels. '.' is see-through.",
         "# palette: letter colour [part tone] - tones are 0 outline, 1 dark, 2 shadow, 3 mid, 4 light",
         "palette"]
part_tone = {v: k for k, v in slot.items()}
for i, c in enumerate(palette[1:], 1):
    tag = ""
    if i in part_tone:
        p, t = part_tone[i]
        tag = f" {PARTS[p - 1]} {t}"
    lines.append(f"{LETTERS[i - 1]} #{c[0]:02x}{c[1]:02x}{c[2]:02x}{tag}")
lines.append(f"colours {json.dumps(colours)}")
anims = {anim: [names[tuple(f[:4])] for f in fl] for anim, fl in meta["frames"].items()}
lines.append(f"anims {json.dumps(anims)}")
for name, (rgb, part, alpha, kx, ky) in frames.items():
    idx = index_frame(rgb, part, alpha)
    lines.append("")
    lines.append(f"frame {name} feet {kx} {ky}")
    for row in idx:
        lines.append("".join("." if v == 0 else LETTERS[v - 1] for v in row))
open(OUT, "w").write("\n".join(lines) + "\n")
print(OUT, os.path.getsize(OUT), "bytes,", len(frames), "frames,", len(palette) - 1, "colours")
