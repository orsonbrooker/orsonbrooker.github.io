"""Builds the pictures shown when a page is shared (Open Graph / Twitter cards), one per page.

Usage: uv run --with pillow --with numpy python3 tools/build_share_images.py
Writes assets/share/{home,shootaround,players,ideas}.jpg (1200x630).
"""
import json, os, re
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..')
FONT = os.path.join(ROOT, 'art/fonts/PressStart2P-Regular.ttf')  # SIL Open Font Licence
W, H = 1200, 630
BG = (166, 121, 142)
INK = (43, 22, 34)
PANEL = (58, 31, 46)
ORANGE = (240, 138, 60)
YELLOW = (255, 224, 102)
WHITE = (255, 255, 255)
OUT = os.path.join(ROOT, 'assets/share')


def path(p):
    return os.path.join(ROOT, p.split('?')[0])


def font(size):
    return ImageFont.truetype(FONT, size)


def text(img, xy, s, size, fill, shadow=4, anchor='la', outline=0):
    d = ImageDraw.Draw(img)
    f = font(size)
    x, y = xy
    if shadow:
        d.text((x + shadow, y + shadow), s, font=f, fill=INK, anchor=anchor, stroke_width=outline, stroke_fill=INK)
    d.text((x, y), s, font=f, fill=fill, anchor=anchor, stroke_width=outline, stroke_fill=INK)


def wrap(s, size, width):
    f, lines, line = font(size), [], ''
    for word in s.split():
        test = f'{line} {word}'.strip()
        if f.getlength(test) > width and line:
            lines.append(line)
            line = word
        else:
            line = test
    return lines + [line]


def panel(img, box, radius=18):
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = box
    d.rounded_rectangle((x0 + 8, y0 + 8, x1 + 8, y1 + 8), radius, fill=INK)
    d.rounded_rectangle(box, radius, fill=PANEL)


def sprite(meta_path, atlas, anim='idle', frame=0):
    meta = json.load(open(path(meta_path)))
    x, y, w, h, ox, oy = meta['frames'][anim][frame]
    return atlas.crop((x, y, x + w, y + h)), meta


def fit_height(img, h):
    return img.resize((round(img.width * h / img.height), h), Image.LANCZOS)


# ---------- Home: Orson saying hi ----------

def home():
    img = Image.new('RGBA', (W, H), BG + (255,))
    atlas = Image.open(path('assets/sprites.webp')).convert('RGBA')
    orson, _ = sprite('assets/sprites.json', atlas)
    orson = fit_height(orson, 540)
    shadow = Image.new('RGBA', (W, H))
    ImageDraw.Draw(shadow).ellipse((110, 575, 110 + orson.width + 60, 605), fill=INK + (90,))
    img.alpha_composite(shadow)
    img.alpha_composite(orson, (140, 590 - orson.height))
    panel(img, (460, 110, 1130, 470))
    # The bubble's tail, pointing at Orson.
    ImageDraw.Draw(img).polygon([(462, 330), (420, 360), (462, 380)], fill=PANEL)
    text(img, (500, 150), "Hi, I'm Orson!", 40, ORANGE)
    y = 240
    for line in wrap('Welcome to my website. I make games. Play them, make your own player, and tell me your ideas!', 22, 590):
        text(img, (500, y), line, 22, WHITE, shadow=3)
        y += 42
    text(img, (1130, 560), 'orsonbrooker.com', 22, YELLOW, shadow=3, anchor='ra')
    return img


# ---------- Shootaround: the court with the game's logo ----------

def logo(s, size, angle=4):
    """The title screen's tilted logo: angle in degrees, anticlockwise (rising to the right)."""
    f = font(size)
    l, t, r, b = f.getbbox(s, stroke_width=6)
    layer = Image.new('RGBA', (r - l + 40, b - t + 40))
    d = ImageDraw.Draw(layer)
    d.text((20 - l + 8, 20 - t + 8), s, font=f, fill=INK, stroke_width=6, stroke_fill=INK)
    d.text((20 - l, 20 - t), s, font=f, fill=ORANGE, stroke_width=6, stroke_fill=INK)
    return layer.rotate(angle, resample=Image.BICUBIC, expand=True)


def shootaround():
    card = Image.open(path('assets/games/shootaround.webp')).convert('RGBA')
    card = card.resize((W, round(card.height * W / card.width)), Image.LANCZOS)
    img = card.crop((0, (card.height - H) // 2, W, (card.height - H) // 2 + H))
    mark = logo('SHOOTAROUND', 72)
    img.alpha_composite(mark, ((W - mark.width) // 2, 18))
    s = "Can you beat Orson's high score?"
    width = font(24).getlength(s)
    panel(img, (int((W - width) / 2) - 28, 538, int((W + width) / 2) + 28, 598), 12)
    text(img, (W // 2, 569), s, 24, YELLOW, shadow=3, anchor='mm')
    return img


# ---------- Players: a line-up of made-up players ----------

REGIONS = {1: 'skin', 2: 'hair', 3: 'jersey', 4: 'team', 5: 'shoes'}
luma = lambda c: 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]
hexrgb = lambda s: np.array([int(s[i:i + 2], 16) for i in (1, 3, 5)], float)


def recolor(base, colours):
    """Same idea as players/recolor.js: swap a region's colour, keeping each pixel's light and shade."""
    atlas = Image.open(path(base['atlas'])).convert('RGBA')
    regions = np.asarray(Image.open(path(base['regions'])).convert('RGB'))[..., 0]
    meta = json.load(open(path(base['meta'])))
    a = np.asarray(atlas).astype(float)
    for rid, name in REGIONS.items():
        if name not in colours:
            continue
        ref = np.array(meta['regions'][name], float)
        ref_l = max(1, luma(ref))
        m = regions == rid
        k = luma(a[..., :3])[m] / ref_l
        if ref_l < 70:
            k = 0.35 + 0.65 * k
        t = hexrgb(colours[name])
        px = np.where(k[:, None] <= 1, t * k[:, None], np.minimum(255, t + (255 - t) * (k[:, None] - 1) * 0.6))
        a[..., :3][m] = px
    img = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
    x, y, w, h, ox, oy = meta['frames']['idle'][0]
    return img.crop((x, y, x + w, y + h))


def players():
    img = Image.new('RGBA', (W, H), BG + (255,))
    bases = {b['id']: b for b in json.load(open(path('assets/characters/bases/index.json')))}
    lineup = [
        ('curly', {'jersey': '#d63a3a', 'team': '#f2f2ef', 'shoes': '#f2f2ef'}),
        ('ponytail', {'jersey': '#3fa65c', 'team': '#f2cf3d', 'hair': '#26222a'}),
        ('spiky', {'jersey': '#f2f2ef', 'team': '#2c3e7a'}),
        ('buns', {'jersey': '#8b5ad6', 'team': '#f2cf3d', 'shoes': '#e86fb0'}),
        ('cap', {'jersey': '#f08a3c', 'team': '#2b2b2f'}),
        ('mullet', {'jersey': '#59b7e8', 'team': '#2c3e7a', 'hair': '#e8c872'}),
    ]
    floor = Image.new('RGBA', (W, H))
    d = ImageDraw.Draw(floor)
    for i in range(len(lineup)):
        cx = 115 + i * 194
        d.ellipse((cx - 70, 588, cx + 70, 612), fill=INK + (80,))
    img.alpha_composite(floor)
    for i, (bid, colours) in enumerate(lineup):
        p = fit_height(recolor(bases[bid], colours), 380)
        img.alpha_composite(p, (115 + i * 194 - p.width // 2, 600 - p.height))
    text(img, (W // 2, 70), 'MAKE YOUR PLAYER', 48, WHITE, shadow=6, anchor='mm')
    text(img, (W // 2, 150), 'Pick a look, a number and a team', 22, YELLOW, shadow=3, anchor='mm')
    return img


# ---------- Ideas: a lightbulb and some ideas ----------

def pixel_icon(name, scale, colour):
    """Draws one of ui/icons.js's pixel icons (rectangles only) at a whole-number scale."""
    src = open(os.path.join(ROOT, 'ui/icons.js')).read()
    d_attr = re.search(name + r': "<path d=\\"([^\\]+)', src).group(1)
    img = Image.new('RGBA', (24 * scale, 24 * scale))
    draw = ImageDraw.Draw(img)
    x = y = 0
    pts = []
    for cmd, num in re.findall(r'([MmHhVvZz])\s*([-\d.\s]*)', d_attr):
        n = [float(v) for v in re.findall(r'-?\d*\.?\d+', num)]
        if cmd == 'M':
            x, y = n
            pts = [(x, y)]
        elif cmd == 'm':
            x, y = x + n[0], y + n[1]
            pts = [(x, y)]
        elif cmd in 'Hh':
            x = n[0] if cmd == 'H' else x + n[0]
            pts.append((x, y))
        elif cmd in 'Vv':
            y = n[0] if cmd == 'V' else y + n[0]
            pts.append((x, y))
        elif cmd in 'Zz':
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            draw.rectangle((min(xs) * scale, min(ys) * scale, max(xs) * scale - 1, max(ys) * scale - 1), fill=colour)
            x, y = pts[0]
    return img


def ideas():
    img = Image.new('RGBA', (W, H), BG + (255,))
    bulb = pixel_icon('idea', 15, YELLOW)
    glow = pixel_icon('idea', 15, INK)
    img.alpha_composite(glow, (88, 150))
    img.alpha_composite(bulb, (80, 142))
    text(img, (500, 120), 'IDEAS BOARD', 48, WHITE, shadow=6)
    y = 210
    for line in wrap('Vote for what Orson makes next, or send in your own idea!', 24, 620):
        text(img, (500, y), line, 24, YELLOW, shadow=3)
        y += 44
    # A few cards like the ones on the board.
    cards = [('1v1, 2v2, then 3v3', 'Top pick'), ('New courts', None), ('Gear and unlocks', 'Idea from Goop')]
    y = 350
    for title, tag in cards:
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((508, y + 6, 1128, y + 66), 10, fill=INK)
        d.rounded_rectangle((500, y, 1120, y + 60), 10, fill=WHITE)
        text(img, (524, y + 30), title, 20, INK, shadow=0, anchor='lm')
        if tag:
            tw = font(12).getlength(tag)
            d.rounded_rectangle((1060 - tw, y + 18, 1100, y + 42), 6, fill=YELLOW if tag == 'Top pick' else (255, 241, 194))
            text(img, (1080 - tw / 2, y + 31), tag, 12, INK, shadow=0, anchor='mm')
        y += 80
    return img


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, build in [('home', home), ('shootaround', shootaround), ('players', players), ('ideas', ideas)]:
        build().convert('RGB').save(os.path.join(OUT, f'{name}.jpg'), quality=88, optimize=True)
        print('saved assets/share/%s.jpg' % name)
