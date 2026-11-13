"""Points the builder's video kids at their rebuilt sheets: the last step after rebuilding a kid from video.

For each kid named, its entry in assets/characters/bases/index.json gets the kid's full-detail sheet
(`assets/characters/<kid>-detail/`), with `?v=` stamps from the files' contents so a rebuilt sheet always
reaches players, `"video": true`, the kid's colours and pronoun, and a `card`: the frame and square for
their card picture, the same crop as the game's picker cards. The card frame is `recover-fl` frame 6
(standing, hands empty); thumb.webp is drawn from it, with keyed parts (hair stored at a mid-tone) shown
in the kid's own colours. Names and ids stay, so kids' saved players keep them.

Last, it makes each kid's smaller (2/3 size) sheet and gear for phones and tablets (small_sheet.py), so they always
match the full ones. Orson isn't a builder body, but run it for him too after rebuilding his sheets
(it only makes his smaller copies).

  python tools/pixelart/video_bases.py curly buns
  python tools/pixelart/video_bases.py orson
"""
import hashlib
import json
import sys

import numpy as np
from PIL import Image

import small_sheet

INDEX = "assets/characters/bases/index.json"
PRONOUN = {"curly": "he", "buns": "she"}
CARD_FRAME = ("recover-fl", 6)
PARTS = ((1, "skin"), (2, "hair"), (3, "jersey"), (4, "team"), (5, "shoes"))


def stamp(path):
    return hashlib.md5(open(path, "rb").read()).hexdigest()[:8]


def card_of(sheet, m):
    """The card frame, and where it sits in the card's square: [x, y, w, h, dx, dy, side]."""
    x, y, w, h = m["frames"][CARD_FRAME[0]][CARD_FRAME[1]][:4]
    f = sheet.crop((x, y, x + w, y + h))
    bx0, by0, bx1, by1 = f.getbbox()
    f = f.crop((bx0, by0, bx1, by1))
    side = round(f.height * 0.44)  # tighter than the game card, like the other bodies' cards
    head = np.asarray(f)[..., 3][: round(f.height * 0.3)] > 0
    xs = np.where(head.any(0))[0]
    cx = (xs.min() + xs.max()) / 2
    dx, dy = round(side / 2 - cx) - bx0, round(f.height * 0.02) - by0
    return [x, y, w, h, dx, dy, side]


def thumb(sheet, regions, m, card):
    """The card's square at 96 px, with parts stored in another colour than the kid's own (keyed hair)
    recoloured as the game shows them."""
    x, y, w, h, dx, dy, side = card
    fr = np.asarray(sheet.crop((x, y, x + w, y + h))).astype(float).copy()
    rg = np.asarray(regions.crop((x, y, x + w, y + h)))[..., 0]
    for pid, part in PARTS:
        own = m.get("art", {}).get(part)
        if not own or own == m["colours"][part]:
            continue
        ref = m["regions"][part]
        ref_l = max(1, 0.299 * ref[0] + 0.587 * ref[1] + 0.114 * ref[2])
        t = np.array([int(m["colours"][part][j:j + 2], 16) for j in (1, 3, 5)], float)
        k = (0.299 * fr[..., 0] + 0.587 * fr[..., 1] + 0.114 * fr[..., 2]) / ref_l
        if ref_l < 70:
            k = 0.35 + 0.65 * k
        mask = (rg == pid) & (fr[..., 3] > 0)
        for c in range(3):
            v = np.where(k <= 1, t[c] * k, np.minimum(255, t[c] + (255 - t[c]) * (k - 1) * 0.6))
            fr[..., c] = np.where(mask, v, fr[..., c])
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    # only the frame's own pixels, not its neighbours' on the sheet
    sq.alpha_composite(Image.fromarray(fr.clip(0, 255).astype(np.uint8)), (max(0, dx), max(0, dy)),
                       (max(0, -dx), max(0, -dy)))
    return sq.resize((96, 96), Image.LANCZOS)


def main(kids):
    bases = json.load(open(INDEX))
    for b in bases:
        kid = b["id"]
        if kid not in kids:
            continue
        d = f"assets/characters/{kid}-detail"
        m = json.load(open(f"{d}/sprites.json"))
        sheet = Image.open(f"{d}/sprites.webp").convert("RGBA")
        regions = Image.open(f"{d}/regions.png").convert("RGBA")
        card = card_of(sheet, m)
        tp = f"assets/characters/bases/{kid}/thumb.webp"
        thumb(sheet, regions, m, card).save(tp, lossless=True)
        b.update({
            "atlas": f"{d}/sprites.webp?v={stamp(d + '/sprites.webp')}",
            "meta": f"{d}/sprites.json?v={stamp(d + '/sprites.json')}",
            "regions": f"{d}/regions.png?v={stamp(d + '/regions.png')}",
            "thumb": f"{tp}?v={stamp(tp)}",
            "colours": m["colours"],
            "pronoun": PRONOUN.get(kid, b.get("pronoun")),
            "video": True,
            "card": card,
        })
        print(kid, card, m["colours"])
    json.dump(bases, open(INDEX, "w"), indent=1)
    small_sheet.main(kids)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
