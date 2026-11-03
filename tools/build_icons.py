"""Builds the favicon, app icons and social share image.

Usage: python3 tools/build_icons.py <portrait.jpg> <court-with-orson.jpg> <PressStart2P-Regular.ttf>
Needs: Pillow, numpy.
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

PORTRAIT, SCENE, FONT = sys.argv[1:4]
ROOT = os.path.join(os.path.dirname(__file__), '..')
BG = (166, 121, 142)  # page background
INK = (43, 22, 34)

# Orson's head in the 1024px portrait.
HEAD_BOX = (393, 178, 625, 410)


def head():
    im = Image.open(PORTRAIT).convert('RGB').crop(HEAD_BOX)
    a = np.asarray(im).astype(int)
    backdrop = np.abs(a - np.array([188, 188, 189])).sum(2) < 18
    rgba = np.dstack([a.astype(np.uint8), np.where(backdrop, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, 'RGBA')


def icon(size, pad, background=None):
    img = Image.new('RGBA', (size, size), background + (255,) if background else (0, 0, 0, 0))
    inner = size - 2 * pad
    face = head()
    resample = Image.NEAREST if inner > face.width else Image.LANCZOS
    face = face.resize((inner, inner), resample)
    img.alpha_composite(face, (pad, pad))
    return img


def build_icons():
    out = os.path.join(ROOT, 'icons')
    os.makedirs(out, exist_ok=True)
    fav = [icon(s, 0) for s in (16, 32, 48)]
    fav[2].save(os.path.join(ROOT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)], append_images=fav[:2])
    icon(32, 0).save(os.path.join(out, 'favicon-32.png'))
    icon(180, 18, BG).convert('RGB').save(os.path.join(out, 'apple-touch-icon.png'))
    icon(192, 16, BG).save(os.path.join(out, 'icon-192.png'))
    icon(512, 40, BG).save(os.path.join(out, 'icon-512.png'))
    # Maskable icons get cropped to a circle, so keep the face inside the safe zone.
    icon(512, 96, BG).save(os.path.join(out, 'icon-maskable-512.png'))


def build_social():
    W, H = 1200, 630
    scene = Image.open(SCENE).convert('RGB').resize((640, 640), Image.LANCZOS)
    img = Image.new('RGB', (W, H), scene.getpixel((4, 4)))  # match the scene's backdrop so there's no seam
    img.paste(scene, (W - 640 + 20, -5))
    d = ImageDraw.Draw(img)

    def text(xy, s, size, fill, shadow=4):
        f = ImageFont.truetype(FONT, size)
        x, y = xy
        d.text((x + shadow, y + shadow), s, font=f, fill=INK)
        d.text((x, y), s, font=f, fill=fill)

    text((56, 150), 'ORSON', 64, (255, 255, 255), 6)
    text((56, 236), 'BROOKER', 64, (255, 255, 255), 6)
    text((60, 360), 'Shootaround!', 26, (255, 159, 67))
    text((60, 410), 'Can you beat', 22, (255, 255, 255), 3)
    text((60, 446), 'my high score?', 22, (255, 255, 255), 3)
    text((60, 540), 'orsonbrooker.com', 18, (255, 224, 102), 3)
    img.save(os.path.join(ROOT, 'og-image.jpg'), quality=90, optimize=True)


if __name__ == '__main__':
    build_icons()
    build_social()
