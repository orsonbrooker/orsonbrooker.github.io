"""Checks that iso_eval.py tells good isometric pixel art from bad: a block drawn to the spec passes every rule,
and copies of it with one thing broken fail that rule.

  uv run --with pillow --with numpy python3 -m unittest tools/pixelart/test_iso_eval.py
"""
import math
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso_eval as E  # noqa: E402

# One hue-shifted ramp per face: shadows cooler (bluer), lights warmer (yellower).
TOP = (232, 196, 120)
LEFT = (196, 134, 78)    # faces the light (upper left)
RIGHT = (130, 78, 70)    # away from it
OUTLINE_L = (92, 48, 58)
OUTLINE_R = (60, 34, 56)


def block(scale=4, size=24):
    """A crate seen from the game's camera: 2:1 edges, light from the upper left, a one-pixel outline round the
    outside only (darker than the face it's on), no lines inside, at `scale` screen pixels per art pixel."""
    n = size
    h = n // 2
    W, H = 2 * n + 1, n + h + n + 1
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    top = [(0, h), (n, 0), (2 * n, h), (n, 2 * h)]
    left = [(0, h), (n, 2 * h), (n, 2 * h + n), (0, h + n)]
    right = [(n, 2 * h), (2 * n, h), (2 * n, h + n), (n, 2 * h + n)]
    d.polygon(left, fill=LEFT)
    d.polygon(right, fill=RIGHT)
    d.polygon(top, fill=TOP)
    # board lines on the top (2:1, two shades of the same ramp), so there are long lines and a ramp to measure
    for k in range(4, n, 6):
        for x in range(0, 2 * n + 1):
            y = h - x // 2 + k
            if 0 <= y < H and im.getpixel((x, y))[:3] == TOP:
                im.putpixel((x, y), (214, 170, 104))
    a = np.array(im)
    # outline: transparent-neighbour pixels, coloured from the face they're on
    op = a[..., 3] > 0
    edge = op & ~(np.pad(op, 1)[:-2, 1:-1] & np.pad(op, 1)[2:, 1:-1] & np.pad(op, 1)[1:-1, :-2] & np.pad(op, 1)[1:-1, 2:])
    for y, x in zip(*np.nonzero(edge)):
        a[y, x, :3] = OUTLINE_L if x < n else OUTLINE_R
    im = Image.fromarray(a)
    return im.resize((W * scale, H * scale), Image.NEAREST)


def score(im, **kw):
    kw.setdefault("line_ratio", 0.5)  # the test block is drawn at 2:1
    with tempfile.TemporaryDirectory() as t:
        p = Path(t) / "a.png"
        im.save(p)
        card, _ = E.evaluate(p, **kw)
    return {c["name"]: c for c in card["checks"]}, card


class IsoEval(unittest.TestCase):
    def test_good_block_passes(self):
        checks, card = score(block())
        self.assertAlmostEqual(card["grid"]["cell"], 4, delta=0.02)
        bad = {k: v["detail"] for k, v in checks.items() if not v["ok"]}
        self.assertEqual(bad, {})

    def test_native_size_is_read_as_is(self):
        checks, card = score(block(scale=1))
        self.assertTrue(card["grid"]["native"])
        self.assertTrue(checks["pixel size is a whole number"]["ok"])

    def test_non_whole_scale_fails(self):
        im = block(scale=1)
        im = im.resize((round(im.width * 4.5), round(im.height * 4.5)), Image.NEAREST)
        checks, _ = score(im)
        self.assertFalse(checks["pixel size is a whole number"]["ok"])

    def test_blur_fails(self):
        im = block().filter(ImageFilter.GaussianBlur(1.2))
        checks, _ = score(im)
        self.assertFalse(checks["cells are flat colour"]["ok"] and checks["few colours"]["ok"] and checks["hard edges"]["ok"])

    def test_soft_edges_fail_for_props(self):
        im = block(scale=1).resize((49 * 4, 61 * 4), Image.BILINEAR)
        checks, _ = score(im, kind="prop")
        self.assertFalse(checks["hard edges"]["ok"])

    def test_stray_pixels_fail(self):
        a = np.array(block(scale=1))
        rng = np.random.default_rng(3)
        ys, xs = np.nonzero(a[..., 3] > 0)
        for i in rng.choice(len(xs), 40, replace=False):
            y, x = ys[i], xs[i]
            if 2 < y < a.shape[0] - 3 and 2 < x < a.shape[1] - 3:
                a[y, x, :3] = (40, 220, 90)
        im = Image.fromarray(a)
        checks, _ = score(im.resize((im.width * 4, im.height * 4), Image.NEAREST))
        self.assertFalse(checks["no stray pixels"]["ok"])

    def test_thick_outline_fails(self):
        a = np.array(block(scale=1))
        op = a[..., 3] > 0
        inner = op.copy()
        for _ in range(2):
            p = np.pad(inner, 1)
            inner = inner & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
        a[op & ~inner, :3] = OUTLINE_R
        im = Image.fromarray(a)
        checks, _ = score(im.resize((im.width * 4, im.height * 4), Image.NEAREST))
        self.assertFalse(checks["outlines one pixel wide"]["ok"])

    def test_gym_camera_is_not_2_to_1(self):
        checks, _ = score(block(), line_ratio=0.566)
        self.assertFalse(checks["lines match the camera"]["ok"])

    def test_wrong_angle_fails(self):
        im = block(scale=1)
        im = im.resize((im.width, round(im.height * 1.3)), Image.NEAREST)
        checks, _ = score(im.resize((im.width * 4, im.height * 4), Image.NEAREST))
        self.assertFalse(checks["lines match the camera"]["ok"])

    def test_flat_ramps_fail(self):
        a = np.array(block(scale=1)).astype(float)
        op = a[..., 3] > 0
        g = a[..., :3].mean(-1, keepdims=True)
        a[..., :3] = np.where(op[..., None], g * np.array([1.2, 0.8, 0.5]), 0)  # one hue, only lighter or darker
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        checks, _ = score(im.resize((im.width * 4, im.height * 4), Image.NEAREST))
        self.assertFalse(checks["ramps shift hue"]["ok"])


if __name__ == "__main__":
    unittest.main()


# ---------- folding panels ----------

import json  # noqa: E402

import iso_panels as P  # noqa: E402

K = 5  # court px per art pixel
GEO = {"origin": {"x": 500, "y": 300}, "eu": {"x": -40, "y": 20}, "ev": {"x": 40, "y": 20},
       "room": {"u": 6, "v": 6}, "pxPerM": 50, "size": 1000}
H = 4.0  # 200 court px, 40 art px


def make_panels(folder, broken=None):
    """A little box room drawn as panels at its own size (1 court px = 1/K), blown up by K: a floor, the hoop
    wall, the side wall, a hoop on the hoop wall and a crate on the floor."""
    def nat(x, y):
        return (x / K, y / K)

    def proj(u, v, z=0.0):
        g = GEO
        return nat(g["origin"]["x"] + u * g["eu"]["x"] + v * g["ev"]["x"], g["origin"]["y"] + u * g["eu"]["y"] + v * g["ev"]["y"] - z * g["pxPerM"])

    U, V = GEO["room"]["u"], GEO["room"]["v"]
    faces = {
        "floor": ([proj(0, 0), proj(U, 0), proj(U, V), proj(0, V)], (200, 150, 90)),
        "wall-hoop": ([proj(0, 0), proj(U, 0), proj(U, 0, H), proj(0, 0, H)], (150, 80, 70)),
        "wall-side": ([proj(0, 0), proj(0, V), proj(0, V, H), proj(0, 0, H)], (190, 110, 90)),
        "hoop": ([proj(3, 0, 2.4), proj(2.75, 0, 2.4), proj(2.75, 0, 2.8), proj(3, 0, 2.8)], (220, 60, 50)),
        "crate": ([proj(1, 3), proj(1.5, 3), proj(1.5, 3.5), proj(1, 3.5)], (120, 90, 60)),
    }
    if broken == "short floor":
        q = faces["floor"][0]
        faces["floor"] = ([q[0], (q[1][0] + 4, q[1][1] + 2), q[2], q[3]], faces["floor"][1])
    flat = Image.new("RGBA", (GEO["size"] // K, GEO["size"] // K), (0, 0, 0, 0))
    panels = []
    for pid, (poly, col) in faces.items():
        xs, ys = [x for x, _ in poly], [y for _, y in poly]
        x0, y0 = int(math.floor(min(xs))), int(math.floor(min(ys)))
        im = Image.new("RGBA", (int(math.ceil(max(xs))) - x0 + 1, int(math.ceil(max(ys))) - y0 + 1), (0, 0, 0, 0))
        ImageDraw.Draw(im).polygon([(x - x0, y - y0) for x, y in poly], fill=col + (255,))
        flat.alpha_composite(im, (x0, y0))
        big = im.resize((im.width * K, im.height * K), Image.NEAREST)
        kind = {"floor": "floor", "wall-hoop": "wall", "wall-side": "wall", "hoop": "hoop", "crate": "prop"}[pid]
        name = "prop-crate.webp" if pid == "crate" else f"{pid}.webp"
        big.save(Path(folder) / name, lossless=True)
        p = {"id": pid, "kind": kind, "image": name, "at": [x0 * K, y0 * K], "order": len(panels)}
        court = lambda u, v, z=0.0: [round(c * K) for c in proj(u, v, z)]  # noqa: E731
        if kind == "wall":
            p["plane"] = pid.split("-")[1]
            p["hinge"] = [court(0, 0), court(U, 0) if p["plane"] == "hoop" else court(0, V)]
        if pid == "hoop":
            p.update(on="wall-hoop", foot=[2.8, 2.4], hinge=[court(3, 0, 2.4), court(2.75, 0, 2.4)])
        if pid == "crate":
            p.update(on="floor", foot=[1.3, 3.3], hinge=[court(1, 3.5), court(1.5, 3.5)])
        panels.append(p)
    flat.resize((flat.width * K, flat.height * K), Image.NEAREST).save(Path(folder) / "court.webp", lossless=True)
    geo = json.loads(json.dumps(GEO))
    if broken == "missing wall":
        panels = [p for p in panels if p["id"] != "wall-side"]
    if broken == "off grid":
        panels[0]["at"][0] += 2
    if broken == "not 2:1":
        geo["eu"] = {"x": -45, "y": 20}
    if broken == "loose prop":
        panels[-1]["on"] = "shelf"
    if broken == "no hinge":
        del panels[1]["hinge"]
    if broken == "wrong order":
        panels[3]["order"] = 0
        panels[0]["order"] = 3
    m = {"geometry": geo, "scale": K, "wallHeight": H, "image": "court.webp", "panels": panels}
    (Path(folder) / "panels.json").write_text(json.dumps(m))
    return Path(folder) / "panels.json"


def panel_checks(broken=None):
    with tempfile.TemporaryDirectory() as t:
        return {c["name"]: c for c in P.check_panels(make_panels(t, broken), evaluate=E.evaluate)}


class Panels(unittest.TestCase):
    def test_good_panels_pass(self):
        bad = {k: v["detail"] for k, v in panel_checks().items() if not v["ok"]}
        self.assertEqual(bad, {})

    def test_missing_wall_fails(self):
        self.assertFalse(panel_checks("missing wall")["panels present"]["ok"])

    def test_off_grid_fails(self):
        c = panel_checks("off grid")
        self.assertFalse(c["hinges on the grid"]["ok"])

    def test_not_2_to_1_fails(self):
        self.assertFalse(panel_checks("not 2:1")["hinges on the grid"]["ok"])

    def test_short_floor_fails(self):
        c = panel_checks("short floor")
        self.assertFalse(c["panels the right size"]["ok"] and c["hinges closed"]["ok"])

    def test_missing_hinge_fails(self):
        self.assertFalse(panel_checks("no hinge")["handed over for folding"]["ok"])

    def test_wrong_order_fails(self):
        self.assertFalse(panel_checks("wrong order")["handed over for folding"]["ok"])

    def test_loose_prop_fails(self):
        self.assertFalse(panel_checks("loose prop")["panels present"]["ok"])
