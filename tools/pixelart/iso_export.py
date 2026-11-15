"""Copies a baked court's closed box into the game, for its opening, and writes what the game needs from the bake.

  python3 tools/pixelart/iso_export.py art/iso/gym art/iso/gym-contest art/iso/gym-box assets/courts/gym content/courts/gym.js art/iso/street

COURT is the court as it's played, CONTEST its 3-point contest version (racks' shadows only, iso_bake "game"
props) and BOX the same court shut in a box (its front walls from outside, its roof, and plain walls the game
turns into the front walls' inside faces).

Writes ASSETS/panels/ with the box's pictures and ASSETS/panels.json, which play/fold.js reads:

  {
    "size": 2400, "wallHeight": 6.46, "wallThick": 0.25,      metres: the walls' height and thickness
    "box": {"lid", "outLeft", "outRight", "inLeft", "inRight": {"image": "...", "at": [x, y]}}
  }

`at` is the picture's top left in court pixels. outLeft and outRight are the front walls standing, from outside;
inLeft and inRight are plain side and hoop walls, standing where those walls are, which the game moves to the
front and folds down.

STREET (optional) is the street round the court (art/iso/street): it's written as ASSETS/street.webp, one picture
at art pixels with the sky painted in behind, and panels.json gets "street": {"image", "at", "scale"} (its top left
in court pixels, and court pixels per art pixel), drawn behind the court while the box shows.

It also writes MODULE (content/courts/gym.js), what content/courts.js needs from the bake when the game starts: the
wall scoreboard (where its prop hangs, and its face from the prop's prop.json) and the 3-point contest's racks (each
one's picture's top left, in RACK_LAYOUT order, and its prop orientation). Generated: don't edit it by hand.
"""
import json
import random
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


SKY = ["#7fb3d9", "#a9d3ec", "#cfe8f5", "#f3d9b1"]  # top to a warm horizon, late afternoon (art/iso/palette.json)
HAZE = ("#c4bfc8", "#cfe8f5")  # the far city, lilac in the haze, and its windows
CLOUD = ("#f9f5f0", "#f3d9b1")  # lit from below by the low sun


def street(folder, assets, court_geo):
    """The street at art pixels, with a banded sky and a few clouds behind it."""
    from PIL import Image, ImageDraw
    sm = json.loads((folder / "panels.json").read_text())
    k = sm["scale"]
    e = sm["panels"][0]
    big = Image.open(folder / e["image"]).convert("RGBA")
    pic = big.resize((big.width // k, big.height // k), Image.NEAREST)
    w, h = pic.width + e["at"][0] // k, pic.height + e["at"][1] // k
    sky = Image.new("RGBA", (w, h))
    px = sky.load()
    bands = [0.0, 0.1, 0.17, 0.24]  # where each colour starts, as a share of the height; a checker blends the joins
    for y in range(h):
        f = y / h
        i = max(j for j, b in enumerate(bands) if f >= b)
        nxt = bands[i + 1] if i + 1 < len(bands) else 2
        for x in range(w):
            c = SKY[i]
            if i + 1 < len(SKY) and f > nxt - 0.02 and (x + y) % 2 == 0:
                c = SKY[i + 1]
            px[x, y] = tuple(int(c[n:n + 2], 16) for n in (1, 3, 5)) + (255,)
    d = ImageDraw.Draw(sky)
    rnd = random.Random(3)
    # the city far off, hazy, rising from behind the street (only what's above it shows)
    x = 0
    while x < w:
        bw, bh = rnd.randrange(14, 40), rnd.randrange(int(h * 0.12), int(h * 0.3))
        top = int(h * 0.42) - bh
        d.rectangle((x, top, x + bw, h), fill=HAZE[0])
        if rnd.random() < 0.3:  # a water tower on top, or an aerial
            d.rectangle((x + bw // 3, top - 7, x + bw // 3 + 8, top - 2), fill=HAZE[0])
            d.line((x + bw // 3 + 1, top - 2, x + bw // 3 + 1, top), fill=HAZE[0])
        elif rnd.random() < 0.4:
            d.line((x + bw // 2, top - 10, x + bw // 2, top), fill=HAZE[0])
        for wy in range(top + 4, h, 6):  # rows of faint windows
            for wx in range(x + 3, x + bw - 3, 5):
                if rnd.random() < 0.5:
                    d.point((wx, wy), fill=HAZE[1])
        x += bw + rnd.randrange(0, 6)
    for _ in range(12):
        cx, cy = rnd.randrange(20, w - 20), rnd.randrange(15, int(h * 0.3))
        puffs = [(cx + dx, cy + dy, r) for dx, dy, r in ((0, 0, 9), (-11, 3, 6), (11, 3, 7), (-4, -5, 6), (6, -4, 5))]
        for x, y, r in puffs:
            d.ellipse((x - r, y - r + 2, x + r, y + r + 2), fill=CLOUD[1])
        for x, y, r in puffs:
            d.ellipse((x - r, y - r, x + r, y + r), fill=CLOUD[0])
        d.rectangle((cx - 17, cy + 3, cx + 18, cy + 9), fill=CLOUD[0])
    for _ in range(9):  # birds: a little dark tick each
        bx, by = rnd.randrange(10, w - 10), rnd.randrange(10, int(h * 0.25))
        d.point([(bx - 2, by - 1), (bx - 1, by), (bx, by - 1), (bx + 1, by), (bx + 2, by - 1)], fill="#403751")
    sky.alpha_composite(pic, (e["at"][0] // k, e["at"][1] // k))
    sky.save(assets / "street.webp", lossless=True)
    # where it goes: art pixel (0, 0) of the street is this far from the court's (its origins are in art pixels)
    o, co = sm["geometry"]["origin"], court_geo["origin"]
    return {"image": str((assets / "street.webp").relative_to(ROOT)), "at": [co["x"] - o["x"], co["y"] - o["y"]], "scale": k}


def loading(assets, info):
    """ASSETS/loading.webp: the gym shut on its street, as the game draws it on the title, in one small picture at art
    pixels: shown while the game loads (games/shootaround/index.html, styles.css .court-loading), so the first paint
    is already the scene, before any code has run."""
    from PIL import Image
    st = info["street"]
    k = st["scale"]
    pic = Image.open(ROOT / st["image"]).convert("RGBA")
    for key in ("outRight", "outLeft", "lid"):
        part = info["box"][key]
        big = Image.open(ROOT / part["image"]).convert("RGBA")
        small = big.resize((big.width // k, big.height // k), Image.NEAREST)
        pic.alpha_composite(small, ((part["at"][0] - st["at"][0]) // k, (part["at"][1] - st["at"][1]) // k))
    pic.save(assets / "loading.webp", lossless=True, quality=100, method=6)


def main():
    court, contest, box, assets, module = (Path(a).resolve() for a in sys.argv[1:6])
    m = json.loads((court / "panels.json").read_text())
    cm = json.loads((contest / "panels.json").read_text())
    bm = json.loads((box / "panels.json").read_text())
    out = assets / "panels"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    names = {"lid": "lid", "out-left": "outLeft", "out-right": "outRight", "in-left": "inLeft", "in-right": "inRight"}
    info = {"size": bm["geometry"]["size"], "wallHeight": bm["wallHeight"], "wallThick": bm["geometry"]["wallThick"], "box": {}}
    for p in bm["panels"]:
        shutil.copyfile(box / p["image"], out / p["image"])
        info["box"][names[p["id"]]] = {"image": str((out / p["image"]).relative_to(ROOT)), "at": p["at"]}
    if len(sys.argv) > 6:
        info["street"] = street(Path(sys.argv[6]).resolve(), assets, m["geometry"])
        info["slab"] = m["geometry"].get("slab", 0)  # the floor's thickness: the street covers its sides
        loading(assets, info)
    (assets / "panels.json").write_text(json.dumps(info, indent=1) + "\n")
    # what the game needs when it starts: the scoreboard and the contest racks
    sb = next(p for p in m["panels"] if p["id"] == "prop-scoreboard")
    face = json.loads((ROOT / sb["prop"] / "prop.json").read_text())["orientations"][sb["along"]]["face"]
    keep = ("start", "out", "size", "segments", "digit", "windows", "labelGap", "colours")
    racks = sorted((p for p in cm["panels"] if p.get("game")), key=lambda p: int(p["id"].split("-")[1]))
    art = {"scoreboard": {"foot": sb["foot"], "face": {k: face[k] for k in keep}},
           "racks": [{"at": p["at"], "way": p["along"]} for p in racks]}
    module.write_text("// Made by tools/pixelart/iso_export.py from the baked court: don't edit by hand.\n"
                      f"export default {json.dumps(art)};\n")
    print(f"wrote {len(list(out.iterdir()))} pictures, {assets / 'panels.json'} and {module}")


if __name__ == "__main__":
    main()
