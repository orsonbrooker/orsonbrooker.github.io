"""Draws a checking sheet for a player: every pose side by side, marked up, so problems show before it goes live.

Usage: python3 tools/check_character.py <id> [out.png]
  e.g. python3 tools/check_character.py jethro /tmp/jethro-check.png
       python3 tools/check_character.py braids        (a builder base; writes .character-cache/check-braids.png)
<id> is orson, a hand-made player in assets/characters/, or a base body in assets/characters/bases/.

Each pose shows:
  - green line: the bottom of the feet in the standing pose (feet in other standing poses should reach it)
  - blue line: the top of the head in the standing pose, to spot poses that grow or shrink
  - yellow box: the drawn part of the pose
  - pink dots: where the shoes were found (the game puts shoe flames there)
  - for bases, a second copy tinted by colour region (skin, hair, jersey, team, shoes) and the number spots
Then it lists anything that looks off: feet higher or lower than the standing pose's in poses that should be on
the floor, and standing or turning poses much taller or shorter than the standing pose.
Needs: Pillow, numpy.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
POSE_NAMES = ['stand', 'stand 2', 'turn', 'turn 2', 'turn 3', 'dribble (low)', 'dribble', 'dribble 3', 'dribble 4',
              'crouch', 'jump', 'jump top', 'release', 'land']
ON_FLOOR = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 13}  # poses whose feet should touch the floor
REGION_COLOURS = {1: (255, 120, 200), 2: (140, 60, 255), 3: (60, 220, 120), 4: (255, 210, 0), 5: (255, 60, 40)}
SHOES = 5
PAD, LABEL = 12, 18


def find(id_):
    if id_ == 'orson':
        return os.path.join(ROOT, 'assets', 'sprites.webp'), os.path.join(ROOT, 'assets', 'sprites.json'), None
    for folder in (os.path.join(ROOT, 'assets', 'characters', 'bases', id_), os.path.join(ROOT, 'assets', 'characters', id_)):
        if os.path.exists(os.path.join(folder, 'sprites.json')):
            regions = os.path.join(folder, 'regions.png')
            return os.path.join(folder, 'sprites.webp'), os.path.join(folder, 'sprites.json'), regions if os.path.exists(regions) else None
    sys.exit(f'No player called {id_!r}')


def shoes(px, regions):
    """The bottom middle of each shoe, the same way the game finds them (see shoesIn in game.js)."""
    h, w = px.shape[:2]
    if regions is not None:
        mask = regions == SHOES
    else:
        r, g, b, a = [px[..., i].astype(int) for i in range(4)]
        mask = (a >= 128) & ~((r - b > 40) & (r >= g))
    mask[: int(h * 0.6)] = False
    bottom = np.array([np.nonzero(mask[:, x])[0].max() if mask[:, x].any() else -1 for x in range(w)])
    low = 0 if regions is not None else h * 0.8
    runs = []
    for x in range(w):
        if bottom[x] < low or bottom[x] < 0:
            continue
        if runs and x - runs[-1][1] <= 2:
            runs[-1][1] = x
        else:
            runs.append([x, x])
    runs = sorted([r for r in runs if r[1] - r[0] >= 3], key=lambda r: r[0] - r[1])[:2]
    if len(runs) == 1:
        x0, x1 = runs[0]
        runs = [[x0, (x0 + x1) // 2], [(x0 + x1) // 2 + 1, x1]]
    return sorted(((x0 + x1) / 2, int(bottom[x0:x1 + 1].max())) for x0, x1 in runs)


def main():
    id_ = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, '.character-cache', f'check-{id_}.png')
    atlas_path, meta_path, regions_path = find(id_)
    atlas = Image.open(atlas_path).convert('RGBA')
    A = np.asarray(atlas)
    R = np.asarray(Image.open(regions_path).convert('RGBA'))[..., 0] if regions_path else None
    meta = json.load(open(meta_path))

    # The distinct poses in pose order, as build_regions.py finds them.
    poses = []
    for frame in [f for anim in meta['frames'].values() for f in anim]:
        if frame[:4] not in [p[:4] for p in poses]:
            poses.append(frame)
    poses.sort(key=lambda f: (f[1], f[0]))

    # Line every pose up on the floor: a frame is drawn with its corner at (ox, oy) from the floor point.
    top = min(oy for *_, oy in poses)
    bottom = max(oy + h for _, _, _, h, _, oy in poses)
    cell_w = 2 * max(max(-ox, ox + w) for _, _, w, _, ox, _ in poses) + PAD * 2
    copies = 2 if R is not None else 1
    rows_h = bottom - top + PAD * 2 + LABEL
    sheet = Image.new('RGBA', (cell_w * len(poses), rows_h * copies), (34, 30, 44, 255))
    d = ImageDraw.Draw(sheet)
    floor_y = PAD - top

    stand = poses[0]
    head = lambda x, y, w, h: int(np.nonzero((A[y:y + h, x:x + w, 3] > 128).any(1))[0].min())
    stand_top = stand[5] + head(*stand[:4])
    stand_height = -stand_top
    # The game draws feet a little below the floor point, so compare each pose's feet with the standing pose's.
    lowest = lambda x, y, w, h: int(np.nonzero((A[y:y + h, x:x + w, 3] > 128).any(1))[0].max())
    stand_feet = stand[5] + lowest(*stand[:4]) + 1

    problems = []
    for i, (x, y, w, h, ox, oy) in enumerate(poses):
        name = POSE_NAMES[i] if i < len(POSE_NAMES) else f'pose {i}'
        px = A[y:y + h, x:x + w]
        reg = R[y:y + h, x:x + w] if R is not None else None
        drawn = px[..., 3] > 128
        ys, xs = np.nonzero(drawn)
        for c in range(copies):
            fx = i * cell_w + cell_w // 2  # the floor point
            left = fx + ox
            cy = c * rows_h + floor_y + oy
            tile = Image.fromarray(px)
            if c == 1:
                tint = px.copy()
                for r, col in REGION_COLOURS.items():
                    tint[reg == r, :3] = col
                tile = Image.fromarray(tint)
            sheet.paste(tile, (left, cy), tile)
            row_floor = c * rows_h + floor_y + stand_feet
            d.line((i * cell_w + 4, row_floor, (i + 1) * cell_w - 4, row_floor), fill=(60, 220, 120, 255))
            d.line((i * cell_w + 4, row_floor - stand_feet + stand_top, (i + 1) * cell_w - 4, row_floor - stand_feet + stand_top), fill=(90, 150, 255, 255))
            d.rectangle((left + xs.min(), cy + ys.min(), left + xs.max(), cy + ys.max()), outline=(255, 210, 0, 255))
            for sx, sy in shoes(px, reg):
                d.ellipse((left + sx - 4, cy + sy - 4, left + sx + 4, cy + sy + 4), outline=(255, 90, 200, 255), width=2)
            if c == 1:
                for key, spot in meta.get('numbers', {}).items():
                    nx, ny = map(int, key.split(','))
                    if (nx, ny) == (x, y):
                        px_, py_ = left + spot['x'] - x, cy + spot['y'] - y
                        d.line((px_ - 5, py_, px_ + 5, py_), fill=(255, 255, 255, 255))
                        d.line((px_, py_ - 5, px_, py_ + 5), fill=(255, 255, 255, 255))
            d.text((i * cell_w + 6, (c + 1) * rows_h - LABEL + 2), f'{i} {name}', fill=(255, 255, 255, 255))
        gap = oy + ys.max() + 1 - stand_feet  # how far its feet are below the standing pose's (0 = level)
        if i in ON_FLOOR and abs(gap) > 4:
            problems.append(f'{i} {name}: feet are {abs(gap)} px {"higher" if gap < 0 else "lower"} than in the standing pose')
        height = -(oy + ys.min())
        if i in (1, 2, 3, 4) and abs(height - stand_height) > stand_height * 0.06:
            problems.append(f'{i} {name}: {height} px tall, the standing pose is {stand_height} px')

    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)
    print(out)
    print('\n'.join(problems) if problems else 'Nothing looks off.')


if __name__ == '__main__':
    main()
