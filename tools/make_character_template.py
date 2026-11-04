"""Makes the pose template for redrawing characters as a sprite sheet.

Takes Orson's 14 key poses from the video frames, removes the backdrop, and lines them up on a
grid with every character's feet on the same baseline. Give the result to an image tool as the
reference: "recreate this exact sprite sheet, same poses and grid, as <new character>".

Usage: python3 tools/make_character_template.py <frames-dir> <font.ttf>
  <frames-dir>  the folder build_assets.py extracted the video frames into
Writes art/character-template.png (clean, for the image tool) and
art/character-template-labelled.png (with pose names, for people).
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FRAMES, FONT = sys.argv[1], sys.argv[2]
sys.argv = [sys.argv[0], '', FRAMES]  # build_assets reads its own arguments on import
sys.path.insert(0, os.path.dirname(__file__))
import build_assets as ba

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'art')

# (label, video, frame) in the order the game plays them.
POSES = [
    ('1 stand', 'turn', 1),
    ('2 stand', 'turn', 25),
    ('3 turn', 'turn', 40),
    ('4 turn', 'turn', 46),
    ('5 turn', 'turn', 55),
    ('6 dribble low', 'shoot', 73),
    ('7 dribble up', 'shoot', 77),
    ('8 dribble hand', 'shoot', 82),
    ('9 dribble down', 'shoot', 88),
    ('10 crouch', 'shoot', 109),
    ('11 jump', 'shoot', 118),
    ('12 jump top', 'shoot', 124),
    ('13 release', 'shoot', 151),
    ('14 land', 'shoot', 163),
]
COLS = 7
# 7x2 cells of 320x630 make the sheet exactly 16:9 (2240x1260), an aspect image tools offer.
CELL_W, CELL_H = 320, 630
BASELINE = 560  # feet line inside each cell
SCALE = 0.85
BACKDROP = (176, 170, 163)  # the plain grey the original videos used
LABEL_H = 44


def pose(video, frame):
    rgba, _, _ = ba.key(video, frame, only_body=(frame >= 148))
    scale = SCALE * ba.TARGET_HEIGHT / ba.VIDEO_HEIGHT[video]
    img = Image.fromarray(rgba, 'RGBA')
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    gx, gy = ba.GROUND[video]
    return img, round(gx * scale), round(gy * scale)


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = (len(POSES) + COLS - 1) // COLS
    clean = Image.new('RGB', (COLS * CELL_W, rows * CELL_H), BACKDROP)
    for i, (_, video, frame) in enumerate(POSES):
        img, gx, gy = pose(video, frame)
        cx, cy = (i % COLS) * CELL_W, (i // COLS) * CELL_H
        # Ground point (centre of the feet) goes to the middle of the cell's baseline.
        clean.paste(img, (cx + CELL_W // 2 - gx, cy + BASELINE - gy), img)
    clean.save(os.path.join(OUT, 'character-template.png'), optimize=True)

    font = ImageFont.truetype(FONT, 16)
    labelled = Image.new('RGB', (clean.width, clean.height + rows * LABEL_H), (43, 22, 34))
    d = ImageDraw.Draw(labelled)
    for r in range(rows):
        top = r * (CELL_H + LABEL_H)
        labelled.paste(clean.crop((0, r * CELL_H, clean.width, (r + 1) * CELL_H)), (0, top + LABEL_H))
        for c in range(COLS):
            i = r * COLS + c
            if i >= len(POSES):
                continue
            x = c * CELL_W
            d.text((x + 12, top + 14), POSES[i][0].upper(), font=font, fill=(240, 138, 60))
            d.rectangle((x, top + LABEL_H, x + CELL_W - 1, top + LABEL_H + CELL_H - 1), outline=(43, 22, 34), width=2)
            y = top + LABEL_H + BASELINE
            d.line((x + 20, y, x + CELL_W - 20, y), fill=(120, 110, 105), width=1)
    labelled.save(os.path.join(OUT, 'character-template-labelled.png'), optimize=True)
    print(f'{len(POSES)} poses, {COLS}x{rows} grid of {CELL_W}x{CELL_H} cells -> art/')


if __name__ == '__main__':
    main()
