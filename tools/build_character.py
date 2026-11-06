"""Turns a redrawn pose sheet (made from art/character-template.png) into a playable character.

Usage: python3 tools/build_character.py <sheet.png|jpg> <id> "<Name>" [--base]
  e.g. python3 tools/build_character.py art/characters/jethro.jpg jethro "Jethro"
       python3 tools/build_character.py --clean-orson   (tidies the edges of Orson's video-made sprites)
Writes assets/characters/<id>/sprites.webp + sprites.json + thumb.webp and adds the character to
assets/characters/index.json, which the game reads for its character picker.

With --base it builds a base body for the player builder instead: files go to
assets/characters/bases/<id>/, it isn't added to the picker, and a lossless copy of the atlas is
kept in .character-cache/ for tools/build_regions.py to map its colours.
Needs: Pillow, numpy, cwebp.
"""
import hashlib, json, os, subprocess, sys, tempfile
from collections import deque
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CHARACTERS = os.path.join(ROOT, 'assets', 'characters')

# Must match tools/make_character_template.py.
COLS, ROWS = 7, 2
CELL_W, CELL_H = 320, 630
BASELINE = 560
TEMPLATE_SCALE = 0.85  # template pixels per court pixel
SPRITE_RES = 0.75  # atlas pixels per court pixel, same as Orson's

# The sheet has 14 poses; the game's animations expect Orson's frame counts, so poses repeat
# to keep the same timing. Pose numbers are zero-based: 0-1 stand, 2-4 turn, 5-8 dribble,
# 9 crouch, 10 jump, 11 jump top, 12 release, 13 land.
ANIMS = {
    'idle': [0, 1, 0],
    'turn': [2, 2, 3, 3, 4, 4, 4],
    'dribble': [5, 5, 6, 6, 7, 7, 8, 8, 8],  # pose 5 has the ball on the floor: the bounce sound
    'gather': [8, 8, 9, 9, 9, 9, 9],
    'jump': [10, 10, 11, 11, 11, 10, 10],  # the 4th frame is the top of the jump
    'release': [12, 12, 12, 13, 13, 13, 13],
}
JUMP_TOP = 11


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


def key(cell, backdrop):
    """Removes the flat backdrop and any specks, keeping the character (and a loose ball).

    Backdrop-coloured pixels joined to the edge of the cell are backdrop. A patch the outside can't reach
    is only backdrop if it's the backdrop colour itself (the gap between an arm and the body): pale
    shading inside the clothes is near the backdrop colour too, and cutting it out left see-through holes
    in the jersey.
    """
    rgb = cell.astype(int)
    dist = np.abs(rgb - backdrop).sum(2)
    near = dist <= 48
    lab, sizes = components(near)
    # Each patch's average distance from the backdrop colour (true gaps average well under 14; jersey
    # shading 30 or more).
    mean = np.bincount(lab.ravel(), dist.ravel(), len(sizes)) / np.maximum(sizes, 1)
    is_bg = mean <= 14
    is_bg[np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))] = True
    is_bg[0] = False
    fg = ~is_bg[lab]
    lab, sizes = components(fg)
    keep = sizes > max(150, sizes.max() * 0.02)
    keep[0] = False
    return keep[lab]


def clean_edges(img):
    """Tidies a pose's cut-out edge (RGBA, alpha 0 or 255, edited in place).

    Cutting a character off a light backdrop leaves a fringe of paler pixels where the dark outline blended
    into it, and resizing leaves a few loose specks. A pixel on the edge that is clearly lighter than the
    pixels just inside it is fringe, so it's cleared (twice, for two-pixel fringes); white jerseys and caps
    stay, because the pixels inside them are just as light. Then any loose bit under 12 pixels goes.
    """
    rgb = img[..., :3].astype(int)
    luma = rgb @ np.array([299, 587, 114]) / 1000
    for _ in range(2):
        op = img[..., 3] > 0
        pad = np.pad(op, 1)
        edge = op & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
        # Average lightness of each pixel's solid neighbours that aren't on the edge themselves.
        inner = op & ~edge
        lsum = np.zeros(op.shape)
        n = np.zeros(op.shape)
        pl, pi = np.pad(luma * inner, 1), np.pad(inner, 1).astype(int)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy or dx:
                    lsum += pl[1 + dy:pl.shape[0] - 1 + dy, 1 + dx:pl.shape[1] - 1 + dx]
                    n += pi[1 + dy:pi.shape[0] - 1 + dy, 1 + dx:pi.shape[1] - 1 + dx]
        fringe = edge & (luma > 90) & (n > 0) & (luma - lsum / np.maximum(n, 1) > 45)
        img[fringe, 3] = 0
    lab, sizes = components(img[..., 3] > 0)
    small = sizes < 12
    small[0] = False
    img[small[lab], 3] = 0
    return img


def clean_orson():
    """Orson's sprites come from video (build_assets.py) and can't be rebuilt here; tidy his atlas in place."""
    path = os.path.join(ROOT, 'assets', 'sprites.webp')
    atlas = np.asarray(Image.open(path).convert('RGBA')).copy()
    atlas[..., 3] = np.where(atlas[..., 3] > 110, 255, 0)
    meta = json.load(open(os.path.join(ROOT, 'assets', 'sprites.json')))
    done = set()
    for frame in [f for anim in meta['frames'].values() for f in anim]:
        x, y, w, h = frame[:4]
        if (x, y) in done:
            continue
        done.add((x, y))
        atlas[y:y + h, x:x + w] = clean_edges(atlas[y:y + h, x:x + w].copy())
    tmp = os.path.join(tempfile.mkdtemp(), 'atlas.png')
    Image.fromarray(atlas).save(tmp)
    subprocess.run(['cwebp', '-quiet', '-q', '86', '-sharp_yuv', '-alpha_q', '100', '-exact', tmp, '-o', path], check=True)
    print('Orson tidied:', os.path.relpath(path, ROOT))


def main():
    sheet_path, cid, name = sys.argv[1], sys.argv[2], sys.argv[3]
    is_base = '--base' in sys.argv
    sheet = Image.open(sheet_path).convert('RGB')
    a = np.asarray(sheet)
    sx, sy = sheet.width / (COLS * CELL_W), sheet.height / (ROWS * CELL_H)  # sheet px per template px
    edges = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    backdrop = np.median(edges, axis=0)
    to_atlas = SPRITE_RES / TEMPLATE_SCALE  # template px -> atlas px

    poses = []
    for i in range(COLS * ROWS):
        c, r = i % COLS, i // COLS
        x0, y0 = round(c * CELL_W * sx), round(r * CELL_H * sy)
        x1, y1 = round((c + 1) * CELL_W * sx), round((r + 1) * CELL_H * sy)
        cell = a[y0:y1, x0:x1]
        mask = key(cell, backdrop)
        rgba = np.dstack([cell, (mask * 255).astype(np.uint8)])
        # Scale from sheet pixels to atlas pixels (premultiplied, so edges don't pick up grey).
        img = Image.fromarray(rgba, 'RGBA').convert('RGBa')
        w, h = round(img.width / sx * to_atlas), round(img.height / sy * to_atlas)
        img = np.asarray(img.resize((w, h), Image.LANCZOS).convert('RGBA')).copy()
        img[..., 3] = np.where(img[..., 3] > 110, 255, 0)
        clean_edges(img)
        ys, xs = np.nonzero(img[..., 3])
        bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        # Ground point: middle of the cell, on the template's feet line.
        gx, gy = CELL_W / 2 * to_atlas, BASELINE * to_atlas
        poses.append({'img': img[by0:by1, bx0:bx1], 'ox': round(bx0 - gx), 'oy': round(by0 - gy)})
        if i == JUMP_TOP:
            # Where the ball leaves his hands: the orange ball held overhead.
            px = img[..., :3].astype(int)
            ball = (img[..., 3] > 0) & (px[..., 0] > 150) & (px[..., 1] > 60) & (px[..., 1] < 140) & (px[..., 2] < 90)
            byy, bxx = np.nonzero(ball)
            top = byy < np.percentile(byy, 50) if len(byy) else byy
            release = [round((bxx[top].mean() - gx) / SPRITE_RES), round((byy[top].mean() - gy) / SPRITE_RES)]

    # Pack the 14 poses in one row-wrapped atlas.
    W, x, y, row_h, rects = 2048, 0, 0, 0, []
    for p in poses:
        h, w = p['img'].shape[:2]
        if x + w > W:
            x, y, row_h = 0, y + row_h + 2, 0
        rects.append((x, y, w, h))
        x += w + 2
        row_h = max(row_h, h)
    atlas = np.zeros((y + row_h, max(r[0] + r[2] for r in rects), 4), np.uint8)
    for p, (x, y, w, h) in zip(poses, rects):
        atlas[y:y + h, x:x + w] = p['img']

    out = os.path.join(CHARACTERS, 'bases', cid) if is_base else os.path.join(CHARACTERS, cid)
    os.makedirs(out, exist_ok=True)
    frames = {anim: [list(rects[i]) + [poses[i]['ox'], poses[i]['oy']] for i in idx] for anim, idx in ANIMS.items()}
    meta = {'res': SPRITE_RES, 'frames': frames, 'releaseOffset': release}
    tmp = os.path.join(tempfile.mkdtemp(), 'atlas.png')
    Image.fromarray(atlas).save(tmp)
    subprocess.run(['cwebp', '-quiet', '-q', '86', '-sharp_yuv', '-alpha_q', '100', '-exact', tmp, '-o', os.path.join(out, 'sprites.webp')], check=True)
    with open(os.path.join(out, 'sprites.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    make_thumb(Image.fromarray(poses[0]['img']), os.path.join(out, 'thumb.webp'))
    if is_base:
        cache = os.path.join(ROOT, '.character-cache')
        os.makedirs(cache, exist_ok=True)
        Image.fromarray(atlas).save(os.path.join(cache, f'{cid}.png'))
    else:
        register(cid, name, f'assets/characters/{cid}/sprites', f'assets/characters/{cid}/thumb.webp')
    kb = os.path.getsize(os.path.join(out, 'sprites.webp')) / 1024
    print(f'{name}: 14 poses -> {os.path.relpath(out, ROOT)}/ ({kb:.0f} KB), release offset {release}')


def make_thumb(img, path):
    """Head-and-shoulders picture for the character picker."""
    head = img.crop((0, 0, img.width, round(img.height * 0.45)))
    side = max(head.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.alpha_composite(head, ((side - head.width) // 2, side - head.height))
    square.resize((96, 96), Image.LANCZOS).save(path, 'WEBP', quality=90)


def version(path):
    with open(os.path.join(ROOT, path), 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:8]


def register(cid, name, sprites, thumb):
    """Adds or updates the character in assets/characters/index.json, with cache-busting versions."""
    index_path = os.path.join(CHARACTERS, 'index.json')
    index = json.load(open(index_path)) if os.path.exists(index_path) else []
    entry = {
        'id': cid,
        'name': name,
        'atlas': f'{sprites}.webp?v={version(sprites + ".webp")}',
        'meta': f'{sprites}.json?v={version(sprites + ".json")}',
        'thumb': f'{thumb}?v={version(thumb)}',
    }
    index = [c for c in index if c['id'] != cid] + [entry]
    with open(index_path, 'w') as f:
        json.dump(index, f, indent=1)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--clean-orson':
        clean_orson()
    elif len(sys.argv) > 1 and sys.argv[1] == '--register-orson':
        # Orson's sprites come from build_assets.py (video frames); this just adds him to the list.
        atlas = Image.open(os.path.join(ROOT, 'assets', 'sprites.webp')).convert('RGBA')
        meta = json.load(open(os.path.join(ROOT, 'assets', 'sprites.json')))
        x, y, w, h = meta['frames']['idle'][0][:4]
        os.makedirs(os.path.join(CHARACTERS, 'orson'), exist_ok=True)
        make_thumb(atlas.crop((x, y, x + w, y + h)), os.path.join(CHARACTERS, 'orson', 'thumb.webp'))
        register('orson', 'Orson', 'assets/sprites', 'assets/characters/orson/thumb.webp')
        print('Orson registered')
    else:
        main()
