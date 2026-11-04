"""Maps which pixels of a base body are skin, hair, jersey and team colour, for the player builder.

Usage: python3 tools/build_regions.py <base-id> [--preview out.png]
Reads the lossless atlas that `build_character.py --base` left in .character-cache/ and writes
assets/characters/bases/<id>/regions.png (red channel = region) plus each region's average
colour into sprites.json, which the game uses to recolour while keeping the shading.

Jersey, team colour and the ball separate by colour alone. Hair and shadowed skin overlap, so
each base teaches itself: the top of the head in back-view poses is hair, arms and legs in the
front pose are skin, and every other warm pixel goes to whichever it looks more like (hair is
only allowed in the top half of a pose).
"""
import colorsys, json, os, sys
from collections import deque
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
KEEP, SKIN, HAIR, JERSEY, TEAM, SHOES = 0, 1, 2, 3, 4, 5
NAMES = {SKIN: 'skin', HAIR: 'hair', JERSEY: 'jersey', TEAM: 'team', SHOES: 'shoes'}
# Which poses show the front or back of the jersey (for the player's number). 2-4 are side-on.
FRONT_POSES, BACK_POSES = (0, 1), tuple(range(5, 14))
# Pose numbers (see build_character.py): 0 front stand, 6-7 back-view dribble.
FRONT, BACKS = 0, (6, 7)


def lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.9505, 1, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def hsv(rgb):
    flat = rgb.reshape(-1, 3) / 255.0
    out = np.array([colorsys.rgb_to_hsv(*p) for p in flat])
    return out.reshape(rgb.shape)


def components(mask):
    h, w = mask.shape
    lab_ = np.zeros((h, w), np.int32)
    sizes = [0]
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab_[y0, x0]:
            continue
        n = len(sizes)
        lab_[y0, x0] = n
        q, c = deque([(y0, x0)]), 0
        while q:
            y, x = q.popleft()
            c += 1
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab_[yy, xx]:
                    lab_[yy, xx] = n
                    q.append((yy, xx))
        sizes.append(c)
    return lab_, np.array(sizes)


def classify_colours(rgb, alpha):
    """Colour-only pass: jersey, team, warm (skin or hair, decided later) and everything else."""
    h, s, v = [hsv(rgb)[..., i] for i in range(3)]
    deg = h * 360
    op = alpha > 0
    ball = op & (s > 0.62) & (v > 0.3) & (deg > 4) & (deg < 32)
    team = op & (deg > 195) & (deg < 245) & (s > 0.3) & (v > 0.2)
    white = op & (s < 0.2) & (v > 0.68)
    warm = op & ~ball & (s > 0.15) & (v > 0.18) & ((deg < 50) | (deg > 335))
    return ball, team, white, warm


def neighbours(regions, value):
    """How many of each pixel's 8 neighbours have the given region."""
    pad = np.pad(regions == value, 1).astype(np.uint8)
    h, w = regions.shape
    return sum(pad[1 + dy:h + 1 + dy, 1 + dx:w + 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx)


def tidy(regions, alpha, vals, near_ball):
    """Fills shading holes inside regions and clears lone specks.

    A pixel left as drawn but surrounded by one region (a grey fold in a jersey, a highlight on a shoe) joins
    it, unless it's dark outline or part of the ball. A labelled pixel with at most one neighbour like it,
    sitting among another region, takes that region.
    """
    labels = (SKIN, HAIR, JERSEY, TEAM, SHOES)
    for _ in range(2):
        counts = {r: neighbours(regions, r) for r in labels}
        holes = (regions == KEEP) & (alpha > 0) & (vals[..., 2] > 0.35) & ~near_ball
        for r in labels:
            regions[holes & (counts[r] >= 6)] = r
        counts = {r: neighbours(regions, r) for r in labels}
        for r in labels:
            alone = (regions == r) & (counts[r] <= 1)
            for other in labels:
                if other != r:
                    regions[alone & (counts[other] >= 5)] = other


def main():
    base = sys.argv[1]
    folder = os.path.join(ROOT, 'assets', 'characters', 'bases', base)
    atlas = np.asarray(Image.open(os.path.join(ROOT, '.character-cache', f'{base}.png')).convert('RGBA'))
    meta = json.load(open(os.path.join(folder, 'sprites.json')))
    rgb, alpha = atlas[..., :3].astype(float), atlas[..., 3]
    regions = np.zeros(alpha.shape, np.uint8)

    # The 14 distinct poses, in pose order (animations repeat them).
    poses = []
    for frame in [f for anim in meta['frames'].values() for f in anim]:
        if frame[:4] not in [p[:4] for p in poses]:
            poses.append(frame)
    poses.sort(key=lambda f: (f[1], f[0]))

    ball, team, white, warm = classify_colours(rgb, alpha)
    regions[team] = TEAM
    labs = lab(rgb)
    vals = hsv(rgb)
    # Round the ball: its shaded side is less orange than the colour test above, so look near it too.
    near_ball = ball.copy()
    for _ in range(4):
        near_ball |= np.roll(near_ball, 1, 0) | np.roll(near_ball, -1, 0) | np.roll(near_ball, 1, 1) | np.roll(near_ball, -1, 1)
    ball_zone = near_ball.copy()
    for _ in range(10):
        ball_zone |= np.roll(ball_zone, 1, 0) | np.roll(ball_zone, -1, 0) | np.roll(ball_zone, 1, 1) | np.roll(ball_zone, -1, 1)

    # Jersey: big patches of white. Small white bits (eyes, socks, soles, stripes) stay as drawn.
    for x, y, w, h, *_ in poses:
        sl = (slice(y, y + h), slice(x, x + w))
        comp, sizes = components(white[sl])
        big = sizes > 0.03 * (alpha[sl] > 0).sum()
        big[0] = False
        # White on the head (caps, headbands) stays as drawn: only patches below the head are jersey.
        for c in np.nonzero(big)[0]:
            if np.nonzero(comp == c)[0].mean() < 0.28 * h:
                big[c] = False
        regions[sl][big[comp]] = JERSEY

    # Shoes have bluish highlights; keep the team colour off them (the bottom of every pose).
    for x, y, w, h, *_ in poses:
        feet = (slice(y + int(h * 0.86), y + h), slice(x, x + w))
        block = regions[feet]
        block[block == TEAM] = KEEP

    # Learn this base's hair and skin colours from places where they're certain.
    def samples(pose, top, bottom, left=0.0, right=1.0):
        x, y, w, h, *_ = poses[pose]
        rows = slice(y + int(h * top), y + int(h * bottom))
        cols = slice(x + int(w * left), x + int(w * right))
        return labs[rows, cols][warm[rows, cols]]

    hair = np.concatenate([samples(p, 0.0, 0.16) for p in BACKS])
    # Arms, legs and the middle of the face (which matters when hair and skin are close in colour).
    skin = np.concatenate([samples(FRONT, 0.45, 0.62), samples(FRONT, 0.7, 0.82), samples(FRONT, 0.16, 0.22, 0.35, 0.6)])
    rng = np.random.default_rng(0)
    hair = hair[rng.choice(len(hair), min(1500, len(hair)), replace=False)]
    skin = skin[rng.choice(len(skin), min(1500, len(skin)), replace=False)]

    for x, y, w, h, *_ in poses:
        sl = (slice(y, y + h), slice(x, x + w))
        m = warm[sl]
        px = labs[sl][m]
        d_hair = np.sort(((px[:, None] - hair[None]) ** 2).sum(2), 1)[:, :5].mean(1)
        d_skin = np.sort(((px[:, None] - skin[None]) ** 2).sum(2), 1)[:, :5].mean(1)
        is_hair = d_hair < d_skin
        ys = np.nonzero(m)[0] / h
        is_hair &= ys < 0.5  # no hair below the shoulders
        cls = np.where(is_hair, HAIR, SKIN).astype(np.uint8)
        # The ball: a disc round each patch of ball colour. Inside it, only pixels that closely match skin or
        # hair (a hand or head in front of the ball) are recoloured; its shaded side, outline and seams stay.
        # A hand often hides the top or bottom of the ball, so the disc is sized from its width and placed
        # wherever it covers the most ball. Its outer band is the ball's dark outline, which can be as brown as
        # shaded skin: dark pixels there, and the sprite's edge, stay as drawn unless they look like hair.
        disc = np.zeros((h, w), bool)
        rim = np.zeros((h, w), bool)
        comp, sizes = components(ball[sl])
        yy, xx = np.mgrid[0:h, 0:w]
        for c in np.nonzero(sizes > 80)[0]:
            ys_, xs_ = np.nonzero(comp == c)
            r = (xs_.max() - xs_.min()) / 2 + 3
            cx = (xs_.max() + xs_.min()) / 2
            best = None
            for cy in (ys_.min() - 1 + r, ys_.max() + 1 - r, ys_.mean()):
                inside = ((ys_ - cy) ** 2 + (xs_ - cx) ** 2 <= r * r).sum()
                if best is None or inside > best[0]:
                    best = (inside, cy)
            d2 = (yy - best[1]) ** 2 + (xx - cx) ** 2
            disc |= d2 <= r * r
            rim |= (d2 <= r * r) & (d2 >= (r - 5) ** 2)
        close = np.minimum(d_hair, d_skin) < 100
        op = alpha[sl] > 0
        pad = np.pad(op, 1)
        cut = op & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])  # the sprite's own edge
        outline = rim[m] & ((vals[sl][..., 2][m] < 0.55) | cut[m]) & (d_skin <= d_hair)
        is_ball = disc[m] & (~close | outline)
        block = np.zeros((h, w), np.uint8)
        block[m] = cls
        # Tidy speckles: each warm pixel takes the majority of its warm neighbours.
        padded = np.pad(block, 1)
        votes_hair = sum(np.roll(np.roll(padded, dy, 0), dx, 1)[1:-1, 1:-1] == HAIR for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        votes_skin = sum(np.roll(np.roll(padded, dy, 0), dx, 1)[1:-1, 1:-1] == SKIN for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        tidied = np.where(votes_hair > votes_skin, HAIR, SKIN)
        tidied[m] = np.where(is_ball, KEEP, tidied[m])
        region_block = regions[sl]
        region_block[m] = tidied[m]

    # Shoes: the dark parts of the feet (white soles and socks stay white, and the ball's
    # black seams are left alone when it's bounced low).
    for x, y, w, h, *_ in poses:
        feet = (slice(y + int(h * 0.85), y + h), slice(x, x + w))
        block = regions[feet]
        dark = (alpha[feet] > 0) & (vals[feet][..., 2] < 0.62) & (vals[feet][..., 1] < 0.5) & ~near_ball[feet]
        block[(block == KEEP) & dark] = SHOES

    tidy(regions, alpha, vals, ball_zone & ~(regions == SHOES))

    # Where a number goes on each pose: the middle of the jersey, higher up on the back.
    numbers = {}
    for i, (x, y, w, h, *_) in enumerate(poses):
        if i not in FRONT_POSES + BACK_POSES:
            continue
        sl = (slice(y, y + h), slice(x, x + w))
        comp, sizes = components(regions[sl] == JERSEY)
        if len(sizes) < 2:
            continue
        ys, xs = np.nonzero(comp == int(np.argmax(sizes[1:]) + 1))
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        back = i in BACK_POSES
        jersey = comp == int(np.argmax(sizes[1:]) + 1)
        size = float(min((y1 - y0) * (0.36 if back else 0.2), (x1 - x0) * (0.3 if back else 0.18)))
        cx = int((x0 + x1) / 2)
        cy = y0 + (y1 - y0) * (0.42 if back else 0.6)
        if not back:
            # On the front, the team name sits above the number: start below the V-neck, where the
            # middle of the chest is solid jersey for a few rows.
            band = slice(max(0, cx - int(size * 2)), cx + int(size * 2))
            solid = [r for r in range(y0, y1 - 3) if jersey[r:r + 3, band].all()]
            if solid:
                cy = max(cy, solid[0] + size * 2.1)
        # Tilt to follow the shoulders: fit a line to the top edge of the jersey across its middle.
        cols = [c for c in range(x0 + (x1 - x0) // 5, x1 - (x1 - x0) // 5) if jersey[:, c].any()]
        tops = [np.argmax(jersey[:, c]) for c in cols]
        angle = -float(np.degrees(np.arctan(np.polyfit(cols, tops, 1)[0]))) if len(cols) > 4 else 0.0
        # Centre on the jersey at the number's own height (the bounding box leans toward the trim).
        rows = slice(int(cy - size / 2), int(cy + size / 2) + 1)
        xs_at = np.nonzero(jersey[rows])[1]
        if back and len(xs_at):
            cx = int((np.percentile(xs_at, 5) + np.percentile(xs_at, 95)) / 2)
        numbers[f'{x},{y}'] = {
            'x': int(x + cx),
            'y': int(y + cy),
            'size': round(size, 1),
            'width': int(x1 - x0),
            'angle': round(max(-12.0, min(12.0, angle * 0.6)), 1),
        }
    meta['numbers'] = numbers

    means = {NAMES[r]: [round(float(c)) for c in rgb[regions == r].mean(0)] for r in NAMES if (regions == r).any()}
    out = np.zeros((*regions.shape, 4), np.uint8)
    out[..., 0] = regions
    out[..., 3] = 255
    Image.fromarray(out).save(os.path.join(folder, 'regions.png'), optimize=True)
    meta['regions'] = means
    with open(os.path.join(folder, 'sprites.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    share = {NAMES[r]: f'{100 * (regions == r).sum() / (alpha > 0).sum():.0f}%' for r in NAMES}
    print(base, share, 'regions.png', f'{os.path.getsize(os.path.join(folder, "regions.png")) // 1024} KB')

    register(base, meta)

    if '--preview' in sys.argv:
        colours = np.array([[0, 0, 0], [255, 120, 200], [140, 60, 255], [60, 220, 120], [255, 210, 0], [255, 60, 40]], np.uint8)
        tiles = []
        for p in (FRONT, 5, 7, 11, 12):
            x, y, w, h, *_ = poses[p]
            view = atlas[y:y + h, x:x + w, :3].copy()
            r = regions[y:y + h, x:x + w]
            tint = view.copy()
            tint[r > 0] = colours[r[r > 0]]
            tiles += [view, tint]
        H = max(t.shape[0] for t in tiles)
        sheet = np.full((H, sum(t.shape[1] for t in tiles), 3), 255, np.uint8)
        x = 0
        for t in tiles:
            sheet[:t.shape[0], x:x + t.shape[1]] = t
            x += t.shape[1]
        Image.fromarray(sheet).save(sys.argv[sys.argv.index('--preview') + 1])


def register(base, meta):
    """Lists the base in assets/characters/bases/index.json for the builder and the game."""
    import hashlib
    rel = f'assets/characters/bases/{base}'

    def v(name):
        with open(os.path.join(ROOT, rel, name), 'rb') as f:
            return f'{rel}/{name}?v={hashlib.sha1(f.read()).hexdigest()[:8]}'

    path = os.path.join(ROOT, 'assets', 'characters', 'bases', 'index.json')
    index = json.load(open(path)) if os.path.exists(path) else []
    old = next((b for b in index if b['id'] == base), {})
    entry = {
        'id': base,
        'name': old.get('name', base.capitalize()),  # rename in index.json; reruns keep it
        'atlas': v('sprites.webp'),
        'meta': v('sprites.json'),
        'regions': v('regions.png'),
        'thumb': v('thumb.webp'),
        'colours': {k: '#%02x%02x%02x' % tuple(c) for k, c in meta['regions'].items()},
    }
    index = [b for b in index if b['id'] != base] + [entry]
    with open(path, 'w') as f:
        json.dump(index, f, indent=1)


if __name__ == '__main__':
    main()
