"""Builds the home page's game card picture: the gym shut on its street with its SHOOTAROUND billboard, as the game
opens on it (assets/courts/gym/loading.webp, at art pixels), no text.

Usage: uv run --with pillow python3 tools/build_game_cards.py
(then tools/build_share_images.py, which puts the logo on it for the share picture)
"""
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')

scene = Image.open(os.path.join(ROOT, 'assets/courts/gym/loading.webp')).convert('RGBA')
# 16:9 round the gym, which stands in the middle of the picture, its billboard near the top
w = scene.width
h = round(w * 9 / 16)
cy = 545
crop = scene.crop((0, cy - h // 2, w, cy - h // 2 + h))
# whole pixels first (2x), then smoothly down to the card's size
card = crop.resize((w * 2, h * 2), Image.NEAREST).resize((1200, 675), Image.LANCZOS)
card.convert('RGB').save(os.path.join(ROOT, 'assets/games/shootaround.webp'), quality=82)
print('saved assets/games/shootaround.webp')
