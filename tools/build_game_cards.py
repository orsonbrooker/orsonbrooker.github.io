"""Builds the home page's game card pictures: the court with the player on it, no text.

Usage: uv run --with pillow python3 tools/build_game_cards.py
"""
import json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
BG = (166, 121, 142, 255)  # page background

# Same numbers as game.js: where the player stands at the start of a game.
ORIGIN, EU, EV = (1024, 816), (-115.3, 64.2), (114.4, 65.8)
SPOT = (4.6, 4.6)

court = Image.open(os.path.join(ROOT, 'assets/court.webp')).convert('RGBA')
atlas = Image.open(os.path.join(ROOT, 'assets/sprites.webp')).convert('RGBA')
meta = json.load(open(os.path.join(ROOT, 'assets/sprites.json')))

x, y, w, h, ox, oy = meta['frames']['idle'][0]
scale = 1 / meta['res']
frame = atlas.crop((x, y, x + w, y + h)).resize((round(w * scale), round(h * scale)), Image.LANCZOS)
fx = ORIGIN[0] + EU[0] * SPOT[0] + EV[0] * SPOT[1]
fy = ORIGIN[1] + EU[1] * SPOT[0] + EV[1] * SPOT[1]
scene = Image.new('RGBA', court.size, BG)
scene.alpha_composite(court)
scene.alpha_composite(frame, (round(fx + ox * scale), round(fy + oy * scale)))

# 16:9 around the room, which fills the middle of the square court picture.
cx, cy = 1024, 1020
cw = 1980
ch = round(cw * 9 / 16)
card = scene.crop((cx - cw // 2, cy - ch // 2, cx + cw // 2, cy + ch // 2)).resize((1200, 675), Image.LANCZOS)
card.convert('RGB').save(os.path.join(ROOT, 'assets/games/shootaround.webp'), quality=82)
print('saved assets/games/shootaround.webp')
