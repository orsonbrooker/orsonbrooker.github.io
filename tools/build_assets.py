"""Builds the game's sprite atlas, background and hoop overlay.

Usage: python3 tools/build_assets.py <source-dir> <frames-dir>
  <source-dir>  folder with basketball-court.jpg and the two Orson videos
  <frames-dir>  scratch folder; frames are extracted here with ffmpeg
Needs: ffmpeg, cwebp, Pillow, numpy.
"""
import json, os, subprocess, sys
from collections import deque
import numpy as np
from PIL import Image

SRC, FRAMES = sys.argv[1], sys.argv[2]
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
SHADOW = np.array([83, 86, 94.])

# Court art is 2048px; Orson is ~447px tall in it, so sprites are scaled to match.
TARGET_HEIGHT = 447
# Sprites are stored smaller than court pixels to keep the download light; the game scales them back up.
SPRITE_RES = 0.75
# Orson's standing height in each video, used to make both videos the same size.
VIDEO_HEIGHT = {'turn': 489, 'shoot': 457}
# Ground point (centre of his shadow) in each video, in video pixels.
GROUND = {'turn': (643, 571), 'shoot': (642, 586)}

ANIMS = {
    'idle':    ('turn',  [1, 13, 25]),
    'turn':    ('turn',  [37, 40, 43, 46, 49, 52, 55]),
    'dribble': ('shoot', list(range(73, 91, 2))),
    'gather':  ('shoot', [94, 97, 100, 103, 106, 109, 112]),
    'jump':    ('shoot', [115, 118, 121, 124, 127, 130, 133]),
    'release': ('shoot', [151, 154, 157, 160, 163, 166, 169]),
}
VIDEOS = {'turn': 'orson-correct-turn.mp4', 'shoot': 'orson-correct-bounce-and-shoot.mp4'}


def extract():
    for name, file in VIDEOS.items():
        d = os.path.join(FRAMES, name)
        if not os.path.isdir(d):
            os.makedirs(d)
            subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(SRC, file), f'{d}/%03d.png'], check=True)


def components(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    sizes = [0]
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]:
            continue
        n = len(sizes)
        lab[y0, x0] = n
        q, c = deque([(y0, x0)]), 0
        while q:
            y, x = q.popleft()
            c += 1
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    q.append((yy, xx))
        sizes.append(c)
    return lab, np.array(sizes)


def key(video, i, only_body=False):
    """Returns an RGBA frame with the grey backdrop and floor shadow removed."""
    a = np.asarray(Image.open(f'{FRAMES}/{video}/{i:03d}.png').convert('RGB')).astype(float)
    bg = np.median(np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3)]), axis=0)
    d = SHADOW - bg
    t = np.clip(((a - bg) @ d) / (d @ d), 0, 1)
    fg = np.linalg.norm(a - (bg + t[..., None] * d), axis=2) > 14
    lab, sizes = components(fg)
    if only_body:  # drop the ball once it has left his hands
        keep = sizes == sizes[1:].max()
    else:
        keep = sizes > 300
    keep[0] = False
    alpha = keep[lab]
    rgba = np.dstack([a.astype(np.uint8), (alpha * 255).astype(np.uint8)])
    return rgba, lab, sizes


def scaled(rgba, scale):
    im = Image.fromarray(rgba, 'RGBA').convert('RGBa')
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS).convert('RGBA')
    arr = np.asarray(im).copy()
    arr[..., 3] = np.where(arr[..., 3] > 110, 255, 0)  # crisp pixel-art edges
    return arr


def build_sprites():
    scales = {v: TARGET_HEIGHT * SPRITE_RES / h for v, h in VIDEO_HEIGHT.items()}

    frames, cells = {}, []
    for anim, (video, idx) in ANIMS.items():
        frames[anim] = []
        for i in idx:
            rgba, _, _ = key(video, i, only_body=(anim == 'release'))
            scale = scales[video]
            arr = scaled(rgba, scale)
            yy, xx = np.nonzero(arr[..., 3])
            x0, x1, y0, y1 = xx.min(), xx.max() + 1, yy.min(), yy.max() + 1
            gx, gy = GROUND[video]
            cells.append((anim, arr[y0:y1, x0:x1], round(x0 - gx * scale), round(y0 - gy * scale)))

    # Where the ball leaves his hands (shoot frame 148), relative to the ground point, in court pixels.
    gx, gy = GROUND['shoot']
    hand = (565, 55)
    release_offset = [round((hand[0] - gx) * scales['shoot'] / SPRITE_RES), round((hand[1] - gy) * scales['shoot'] / SPRITE_RES)]

    # Shelf-pack into one atlas.
    W, x, y, row_h, placed = 2048, 0, 0, 0, []
    for anim, img, ox, oy in cells:
        h, w = img.shape[:2]
        if x + w > W:
            x, y, row_h = 0, y + row_h + 2, 0
        placed.append((anim, img, x, y, ox, oy))
        x += w + 2
        row_h = max(row_h, h)
    atlas = np.zeros((y + row_h, W, 4), np.uint8)
    meta = {'res': SPRITE_RES, 'frames': {k: [] for k in ANIMS}, 'releaseOffset': release_offset}
    for anim, img, x, y, ox, oy in placed:
        h, w = img.shape[:2]
        atlas[y:y + h, x:x + w] = img
        meta['frames'][anim].append([x, y, w, h, ox, oy])
    used = max(r[0] + r[2] for f in meta['frames'].values() for r in f)
    atlas = atlas[:, :used]
    save_webp(atlas, 'sprites.webp', quality=86)
    with open(os.path.join(OUT, 'sprites.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))


def build_court():
    court = np.asarray(Image.open(os.path.join(SRC, 'basketball-court.jpg')).convert('RGB'))
    save_webp(court, 'court.webp', quality=88)

    # Front half of the rim plus the net, drawn over the ball so it drops through the hoop.
    x0, y0, x1, y1 = 515, 735, 705, 945
    crop = court[y0:y1, x0:x1].astype(int)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    cx, cy = 611, 790
    outer = ((xx - cx) / 81) ** 2 + ((yy - cy) / 48) ** 2 <= 1
    inner = ((xx - cx) / 66) ** 2 + ((yy - (cy - 2)) / 29) ** 2 <= 1
    rim_front = outer & ~inner & (yy >= cy - 4)
    r, g, b = crop[..., 0], crop[..., 1], crop[..., 2]
    net = (yy > cy + 20) & (r > 150) & (g > 160) & (b > 175) & (xx > 540) & (xx < 690)
    mask = rim_front | net
    rgba = np.dstack([crop.astype(np.uint8), (mask * 255).astype(np.uint8)])
    save_webp(rgba, 'hoop-front.webp', lossless=True)
    print('hoop overlay at', x0, y0)


def save_webp(arr, name, lossless=False, quality=90):
    tmp = os.path.join(FRAMES, name + '.png')
    Image.fromarray(arr).save(tmp)
    args = ['cwebp', '-quiet', '-mt']
    args += ['-lossless', '-z', '9'] if lossless else ['-q', str(quality), '-sharp_yuv', '-alpha_q', '100', '-exact']
    subprocess.run(args + [tmp, '-o', os.path.join(OUT, name)], check=True)


if __name__ == '__main__':
    extract()
    build_sprites()
    build_court()
