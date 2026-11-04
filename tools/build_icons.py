"""Builds the social share image. (Favicons and home screen icons: tools/build_favicons.py.)

Usage: python3 tools/build_icons.py <court-with-orson.jpg> <PressStart2P-Regular.ttf>
Needs: Pillow.
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

SCENE, FONT = sys.argv[1:3]
ROOT = os.path.join(os.path.dirname(__file__), '..')
INK = (43, 22, 34)

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
    build_social()
