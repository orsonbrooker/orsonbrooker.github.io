"""Builds the favicons and home screen icons for the site (Orson's head) and for Shootaround.

art/icons/orson-head.png is Orson's head at its true pixel size (25x30), recovered from a big
picture by sampling the middle of each pixel-art cell. It's scaled up by whole numbers only, so
it stays crisp. art/icons/shootaround.jpg is the hoop picture for the game.

Usage: uv run --with pillow --with numpy python3 tools/build_favicons.py
"""
import json, os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
SITE_BG = (166, 121, 142, 255)  # page background


def save_set(out, small, big, bg):
    """small(size) gives a transparent favicon; big(size, safe) gives an icon filling size*safe."""
    os.makedirs(out, exist_ok=True)
    fav = [small(s) for s in (16, 32, 48)]
    fav[2].save(os.path.join(out, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)], append_images=fav[:2])
    fav[1].save(os.path.join(out, 'favicon-32.png'))

    def tile(size, safe):
        img = Image.new('RGBA', (size, size), bg)
        art = big(size, safe)
        img.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
        return img

    # iOS shows black behind see-through icons, so the home screen ones get a background.
    def save(img, name):
        # Few colours keeps the files small (the hoop picture is a noisy JPEG otherwise).
        img.convert('RGB').quantize(96, dither=Image.Dither.NONE).save(os.path.join(out, name), optimize=True)

    save(tile(180, 0.84), 'apple-touch-icon.png')
    save(tile(192, 0.84), 'icon-192.png')
    save(tile(512, 0.84), 'icon-512.png')
    # Maskable icons get cropped to a circle or squircle: keep the art inside the middle.
    save(tile(512, 0.6), 'icon-maskable-512.png')


# ---------- Orson ----------

head = Image.open(os.path.join(ROOT, 'art/icons/orson-head.png')).convert('RGBA')


def whole_scale(img, box):
    """The biggest whole-number scale-up that fits in box (crisp pixels)."""
    k = max(1, int(min(box / img.width, box / img.height)))
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def orson_small(size):
    img = Image.new('RGBA', (size, size))
    if size >= head.height:
        art = whole_scale(head, size)
    else:  # 16px: smaller than the head itself, so shrink it smoothly from a big copy
        big = whole_scale(head, 300)
        k = size / big.height
        art = big.resize((round(big.width * k), size), Image.LANCZOS)
    img.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return img


save_set(os.path.join(ROOT, 'icons'), orson_small, lambda size, safe: whole_scale(head, size * safe), SITE_BG)
# Browsers also look for /favicon.ico at the site root.
os.replace(os.path.join(ROOT, 'icons/favicon.ico'), os.path.join(ROOT, 'favicon.ico'))

# ---------- Shootaround ----------

hoop = Image.open(os.path.join(ROOT, 'art/icons/shootaround.jpg')).convert('RGB')
a = np.asarray(hoop).astype(int)
corner = np.median(a[:40, :40].reshape(-1, 3), 0)
GAME_BG = tuple(int(c) for c in corner) + (255,)
# Everything that isn't the plain background, without the faint speckles around the net.
fg = np.abs(a - corner).sum(2) > 60
ys, xs = np.where(fg)
x0, x1 = np.percentile(xs, [0.2, 99.8]).astype(int)
y0, y1 = np.percentile(ys, [0.2, 99.8]).astype(int)
side = max(x1 - x0, y1 - y0)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
square = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)
hoop_full = hoop.convert('RGBA').crop(square)


def shoot_small(size):
    # The white net disappears on light browser tabs, so small icons sit on a dark rounded tile.
    from PIL import ImageDraw
    img = Image.new('RGBA', (size, size))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, size - 1, size - 1), radius=max(2, size // 6), fill=GAME_BG)
    art = hoop_full.resize((round(size * 0.92),) * 2, Image.LANCZOS)
    img.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    mask = Image.new('L', (size, size))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=max(2, size // 6), fill=255)
    img.putalpha(mask)
    return img


def shoot_big(size, safe):
    s = round(size * safe)
    return hoop_full.resize((s, s), Image.LANCZOS)


out = os.path.join(ROOT, 'icons/shootaround')
save_set(out, shoot_small, shoot_big, GAME_BG)
print('Shootaround background', '#%02x%02x%02x' % GAME_BG[:3])
