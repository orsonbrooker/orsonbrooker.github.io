"""Checks a player's or a builder body's art, for `node tools/dev/verify.mjs art <id>` (which runs it).

  uv run --with pillow --with numpy --with scipy python3 tools/pixelart/check_art.py <id> <out dir> [--base test-all]

<id> is a player in assets/characters/index.json (orson) or a body in assets/characters/bases/index.json
(curly, buns, spiky, ...). It writes into <out dir>:
  sheet-N.png      every move, frame by frame, lined up on the feet at one scale: on green, on clashing colours
                   (skin, hair, jersey, team colour and shoes each a loud colour, so a wrong region shows), and
                   above them the same frames before this branch (from --base) or, when unchanged, the pixel-art
                   twin the sheet borrows its jersey faces from, at the same scale
  held-ball.png    the held ball (in orange) and the hand round it, in every frame that holds it
  regions.png      tools/pixelart/check_regions.py's contact sheet and checks (sheets with a region map)
and prints JSON ({checks: [{name, ok, detail, images}]}) for verify.mjs. The checks flag:
  - frames whose size, feet or middle jump against the frames beside them, and moves drawn at a different
    size from standing (a zoom change);
  - sides that are just a copy of another side of the same move (e.g. dribble-fl the same as dribble-l);
  - a held ball away from the hand (no skin round it) or outside its frame, and a ball that jumps between
    frames of a move that holds it.
"""
import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SIDES = ["f", "fl", "l", "bl", "b", "br", "r", "fr", "t", ""]
MOVES = ["idle", "turn", "start", "dribble", "jog", "run", "spin", "gather", "jump", "release", "recover"]
ON_FLOOR = {"idle", "turn", "start", "dribble", "jog", "run", "spin", "recover"}
HOLDS_BALL = {"idle", "turn", "gather", "jump", "spin"}  # start drops the ball into the dribble
GREEN, CLASH_BG = (106, 170, 136, 255), (52, 30, 46, 255)
CLASH = {1: (246, 220, 200), 2: (42, 106, 214), 3: (214, 58, 58), 4: (242, 207, 61), 5: (43, 178, 76)}
PARTS = {1: "skin", 2: "hair", 3: "jersey", 4: "team", 5: "shoes"}


def clean(p):
    return p.split("?")[0] if p else p


def find(who):
    for entry in json.load(open(ROOT / "assets/characters/index.json")):
        if entry["id"] == who:
            meta = json.load(open(ROOT / clean(entry["meta"])))
            return clean(entry["atlas"]), clean(entry["meta"]), clean(meta.get("regionsFile"))
    for entry in json.load(open(ROOT / "assets/characters/bases/index.json")):
        if entry["id"] == who:
            return clean(entry["atlas"]), clean(entry["meta"]), clean(entry.get("regions"))
    sys.exit(f"no player or body called {who}")


def git_blob(base, path):
    """The file as it was at `base`, or None when it's the same as now (or wasn't there)."""
    if not path:
        return None
    try:
        then = subprocess.run(["git", "rev-parse", f"{base}:{path}"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        now = subprocess.run(["git", "hash-object", path], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        if not then or then == now:
            return None
        return subprocess.run(["git", "show", f"{base}:{path}"], cwd=ROOT, capture_output=True).stdout
    except Exception:
        return None


def load(atlas, meta_path, regions):
    meta = json.load(open(ROOT / meta_path)) if isinstance(meta_path, str) else meta_path
    img = np.array((Image.open(ROOT / atlas) if isinstance(atlas, str) else atlas).convert("RGBA"))
    reg = None
    if regions is not None:
        reg = np.array((Image.open(ROOT / regions) if isinstance(regions, str) else regions).convert("RGBA"))[..., 0]
    return meta, img, reg


def move_order(meta):
    def key(name):
        base, _, side = name.partition("-")
        return (MOVES.index(base) if base in MOVES else len(MOVES), base, SIDES.index(side) if side in SIDES else len(SIDES), side)
    return sorted(meta["frames"], key=key)


def crop(img, f):
    x, y, w, h = f[:4]
    return img[y:y + h, x:x + w]


def clash(pix, reg, meta):
    """The frame with each region in a loud colour, keeping its light and shade."""
    out = pix.astype(float).copy()
    luma = 0.299 * out[..., 0] + 0.587 * out[..., 1] + 0.114 * out[..., 2]
    for pid, col in CLASH.items():
        ref = meta.get("regions", {}).get(PARTS[pid])
        if not ref:
            continue
        k = luma / max(1, 0.299 * ref[0] + 0.587 * ref[1] + 0.114 * ref[2])
        m = (reg == pid) & (pix[..., 3] > 0)
        for c in range(3):
            out[..., c] = np.where(m, np.clip(col[c] * k, 0, 255), out[..., c])
    return out.astype(np.uint8)


def bbox(pix):
    ys, xs = np.nonzero(pix[..., 3] >= 128)
    if not len(ys):
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def box_stats(meta, img, reg):
    """Per frame, the body (not a drawn ball: region map parts only, when there is one) relative to the feet
    (the frame's anchor): top, bottom, middle, height."""
    out = {}
    for name, frames in meta["frames"].items():
        rows = []
        for f in frames:
            pix = crop(img, f)
            if reg is not None:
                pix = pix.copy()
                pix[..., 3] = np.where(crop(reg, f) > 0, pix[..., 3], 0)
            b = bbox(pix)
            if b is None:
                rows.append(None)
                continue
            x0, y0, x1, y1 = b
            ax, ay = f[4], f[5]
            rows.append({"top": y0 + ay, "bottom": y1 + ay, "mid": (x0 + x1) / 2 + ax, "h": y1 - y0, "w": x1 - x0})
        out[name] = rows
    return out


def jumps(meta, stats):
    """Frames whose size, feet or middle jump against their neighbours; moves at a different size from standing."""
    found = []
    stand = [r["h"] for n, rows in stats.items() if n.split("-")[0] == "idle" for r in rows if r]
    stand_h = float(np.median(stand)) if stand else None
    for name in move_order(meta):
        rows = stats[name]
        base = name.split("-")[0]
        hs = [r["h"] for r in rows if r]
        if not hs:
            continue
        med = float(np.median(hs))
        for i in range(1, len(rows)):
            a, b = rows[i - 1], rows[i]
            if not a or not b or meta["frames"][name][i][:6] == meta["frames"][name][i - 1][:6]:
                continue
            why = []
            # a running stride changes height more than standing or dribbling does
            if abs(b["h"] - a["h"]) > (0.12 if base in {"jog", "run"} else 0.08) * med and base in ON_FLOOR:
                why.append(f"height {a['h']}->{b['h']}")
            if base in ON_FLOOR - {"jog", "run"} and abs(b["bottom"] - a["bottom"]) > 0.04 * med:
                why.append(f"feet {a['bottom']}->{b['bottom']}")
            if abs(b["mid"] - a["mid"]) > 0.12 * med:
                why.append(f"middle {a['mid']:.0f}->{b['mid']:.0f}")
            if why:
                found.append(f"{name} {i - 1}->{i}: " + ", ".join(why))
        if stand_h and base in ON_FLOOR - {"idle", "dribble", "start"} and abs(med / stand_h - 1) > 0.10:
            found.append(f"{name}: drawn {med / stand_h * 100:.0f}% of standing height (zoom change?)")
    return found


def copies(meta, img, who):
    """Sides of a move that are just another side again (same frames, or the same pixels)."""
    cfg = ROOT / f"art/video/{who}.json"
    derived = {n for n, spec in (json.load(open(cfg)).get("derived", {}) if cfg.exists() else {}).items()
               if any(ref[0] != n for ref in spec.get("from", []))}
    by_base = {}
    for name in meta["frames"]:
        base, _, side = name.partition("-")
        # turn-l, turn-bl, turn-b are cut from the one turn clip (turn-t) on purpose: not facings
        if side and base != "turn":
            by_base.setdefault(base, []).append(name)
    digest = lambda f: crop(img, f).tobytes()
    same, mirrored = [], []
    for base, names in by_base.items():
        sig = {n: [digest(f) for f in meta["frames"][n]] for n in names}
        flip = {n: [np.ascontiguousarray(crop(img, f)[:, ::-1]).tobytes() for f in meta["frames"][n]] for n in names}
        groups = []  # sides drawn the same, each group listed once
        for a in names:
            for g in groups:
                b = g[0]
                if sig[a] == sig[b]:
                    g.append(a)
                    break
                if len(sig[a]) == len(sig[b]) and all(len(x) == len(y) for x, y in zip(sig[a], sig[b])):
                    d = np.mean([np.abs(crop(img, fa).astype(int) - crop(img, fb).astype(int)).mean() for fa, fb in zip(meta["frames"][a], meta["frames"][b])])
                    if d < 1.5:
                        g.append(a + f" (nearly, {d:.1f}/255 apart)")
                        break
            else:
                groups.append([a])
        for g in groups:
            if len(g) > 1:
                stand_in = [n for n in g if n in derived]
                same.append(" = ".join(g) + ": the same frames" + (f" ({', '.join(stand_in)} made from another side in art/video's \"derived\": a stand-in until it has its own video)" if stand_in else ""))
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                if sig[a] == flip[b]:
                    mirrored.append(f"{b} is {a} flipped")
    return same, mirrored


def held_ball(meta, img, reg, out):
    balls = meta.get("balls")
    if not balls or reg is None:
        return None
    off, outside, moved, tiles = [], [], [], []
    for name in move_order(meta):
        base = name.split("-")[0]
        prev = None
        for i, f in enumerate(meta["frames"][name]):
            b = balls.get(f"{f[0]},{f[1]}")
            if not b:
                prev = None
                continue
            cx, cy, r = b
            w, h = f[2], f[3]
            pix, rg = crop(img, f), crop(reg, f)
            yy, xx = np.mgrid[:h, :w]
            d2 = (xx - cx) ** 2 + (yy - cy) ** 2
            body = pix[..., 3] >= 128
            skin = int(((d2 <= (r * 1.3) ** 2) & (rg == 1) & body).sum())
            # how much of a ring round the ball is body: a ball held from behind (back views) has no hand
            # showing, but sits in the body; a ball off the hand has background round it
            ring = (d2 > r * r) & (d2 <= (r * 1.35) ** 2)
            cover = float((ring & body).sum()) / (np.pi * r * r * (1.35 ** 2 - 1))  # out of the frame counts as background
            bad = []
            if not (0 <= cx < w and 0 <= cy < h):
                bad.append("outside the frame")
                outside.append(f"{name} {i}")
            if base in HOLDS_BALL and skin < max(12, 0.03 * np.pi * r * r) and cover < 0.25:
                bad.append("off the hand")
                off.append(f"{name} {i} ({skin} skin px, {cover:.0%} of the ring round it is body)")
            if base in {"idle", "turn"} and prev is not None and np.hypot(cx + f[4] - prev[0], cy + f[5] - prev[1]) > 1.0 * r and f[:4] != prev[2]:
                moved.append(f"{name} {i - 1}->{i}")
            prev = (cx + f[4], cy + f[5], f[:4])
            if base in HOLDS_BALL or bad:
                R = int(r * 2.2)
                t = Image.new("RGBA", (2 * R, 2 * R), GREEN)
                fr = Image.fromarray(pix)
                t.paste(fr, (int(R - cx), int(R - cy)), fr)
                dr = ImageDraw.Draw(t)
                dr.ellipse([R - r, R - r, R + r, R + r], fill=(225, 110, 40, 255))
                # the hand in front of the ball (the game draws the ball behind the body)
                front = Image.fromarray(np.where((d2 <= r * r)[..., None] & (rg == 1)[..., None], pix, 0).astype(np.uint8))
                t.paste(front, (int(R - cx), int(R - cy)), front)
                if bad:
                    dr.rectangle([0, 0, 2 * R - 1, 2 * R - 1], outline=(230, 0, 0, 255), width=4)
                tiles.append((f"{name} {i}", t))
    if tiles:
        S = 96
        cols = 12
        sheet = Image.new("RGBA", (cols * S, ((len(tiles) + cols - 1) // cols) * (S + 14)), (30, 30, 30, 255))
        dr = ImageDraw.Draw(sheet)
        for k, (label, t) in enumerate(tiles):
            x, y = (k % cols) * S, (k // cols) * (S + 14)
            sheet.paste(t.resize((S - 2, S - 2), Image.NEAREST), (x, y))
            dr.text((x + 2, y + S - 1), label, fill=(230, 230, 230, 255))
        sheet.save(out / "held-ball.png")
    return off, outside, moved


def twin_frames(meta):
    """The pixel-art twin's frame for each frame of this sheet, scaled up to match, or None."""
    pf = meta.get("printsFrom")
    if not pf:
        return None
    tmeta = json.load(open(ROOT / clean(pf["meta"])))
    timg = np.array(Image.open(ROOT / clean(pf["atlas"])).convert("RGBA"))
    rects = {f"{f[0]},{f[1]}": f for frames in tmeta["frames"].values() for f in frames}
    k = pf.get("scale", 3)
    out = {}
    for frames in meta["frames"].values():
        for f in frames:
            t = rects.get(pf["frames"].get(f"{f[0]},{f[1]}", ""))
            if t:
                pix = Image.fromarray(crop(timg, t)).resize((t[2] * k, t[3] * k), Image.NEAREST)
                out[tuple(f[:4])] = (np.array(pix), t[4] * k, t[5] * k)
    return out


def sheets(meta, img, reg, compare, compare_label, out, scale):
    """Contact sheets: per move, the comparison row (if any), then on green, then on clashing colours."""
    order = move_order(meta)
    ext = [0, 0, 0, 0]  # left, top, right, bottom round the feet
    for frames in meta["frames"].values():
        for f in frames:
            ext = [min(ext[0], f[4]), min(ext[1], f[5]), max(ext[2], f[4] + f[2]), max(ext[3], f[5] + f[3])]
    if compare:
        for pix, ax, ay, *_ in compare.values():
            ext = [min(ext[0], ax), min(ext[1], ay), max(ext[2], ax + pix.shape[1]), max(ext[3], ay + pix.shape[0])]
    cw, ch = int((ext[2] - ext[0]) * scale) + 4, int((ext[3] - ext[1]) * scale) + 4
    label_w = 92
    most = max(len(meta["frames"][n]) for n in order)
    kinds = (["compare"] if compare else []) + ["green"] + (["clash"] if reg is not None else [])
    per_page = max(1, 2400 // (ch * len(kinds) + 6))
    names = []

    balls = meta.get("balls", {})

    def tile(pix, ax, ay, bg, ball=None):
        t = Image.new("RGBA", (cw, ch), bg)
        if ball:  # the game draws the held ball behind the body
            bx, by, br = ((ball[0] + ax - ext[0]) * scale + 2, (ball[1] + ay - ext[1]) * scale + 2, ball[2] * scale)
            ImageDraw.Draw(t).ellipse([bx - br, by - br, bx + br, by + br], fill=(225, 110, 40, 255))
        fr = Image.fromarray(pix)
        fr = fr.resize((max(1, round(fr.width * scale)), max(1, round(fr.height * scale))), Image.LANCZOS)
        t.alpha_composite(fr, (int((ax - ext[0]) * scale) + 2, int((ay - ext[1]) * scale) + 2))
        d = ImageDraw.Draw(t)
        fy = int(-ext[1] * scale) + 2
        d.line([0, fy, cw, fy], fill=(255, 255, 255, 90))  # the floor under the feet
        return t

    for p in range(0, len(order), per_page):
        page = order[p:p + per_page]
        im = Image.new("RGBA", (label_w + most * cw, len(page) * (ch * len(kinds) + 6)), (24, 24, 24, 255))
        d = ImageDraw.Draw(im)
        for row, name in enumerate(page):
            y0 = row * (ch * len(kinds) + 6)
            d.text((4, y0 + 4), name, fill=(240, 240, 240, 255))
            for k, kind in enumerate(kinds):
                d.text((4, y0 + k * ch + ch // 2), compare_label if kind == "compare" else kind, fill=(150, 150, 150, 255))
            for i, f in enumerate(meta["frames"][name]):
                x = label_w + i * cw
                pix = crop(img, f)
                for k, kind in enumerate(kinds):
                    y = y0 + k * ch
                    if kind == "compare":
                        c = compare.get((name, i)) or compare.get(tuple(f[:4]))
                        if c is not None:
                            im.paste(tile(c[0], c[1], c[2], GREEN, c[3] if len(c) > 3 else None), (x, y))
                    elif kind == "green":
                        im.paste(tile(pix, f[4], f[5], GREEN, balls.get(f"{f[0]},{f[1]}")), (x, y))
                    else:
                        im.paste(tile(clash(pix, crop(reg, f), meta), f[4], f[5], CLASH_BG, balls.get(f"{f[0]},{f[1]}")), (x, y))
                d.text((x + 3, y0 + 2), str(i), fill=(255, 255, 255, 200))
        fn = f"sheet-{p // per_page + 1}.png"
        im.save(out / fn)
        names.append(fn)
    return names


def main():
    who, out = sys.argv[1], Path(sys.argv[2])
    base = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else "test-all"
    scale = float(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 0.35
    out.mkdir(parents=True, exist_ok=True)
    atlas, meta_path, regions = find(who)
    meta, img, reg = load(atlas, meta_path, regions if regions and (ROOT / regions).exists() else None)
    checks = []

    # old art from the base branch, or the pixel twin, to compare against
    old_atlas, old_meta = git_blob(base, atlas), git_blob(base, meta_path)
    compare, label = None, ""
    if old_atlas or old_meta:
        om = json.loads(old_meta) if old_meta else meta
        oi = np.array(Image.open(io.BytesIO(old_atlas)).convert("RGBA")) if old_atlas else img
        ob = om.get("balls", {})
        compare = {(n, i): (crop(oi, f), f[4], f[5], ob.get(f"{f[0]},{f[1]}")) for n, frames in om["frames"].items() for i, f in enumerate(frames)}
        label = f"on {base}"
    else:
        twin = twin_frames(meta)
        if twin:
            compare, label = twin, "pixel twin"
    pages = sheets(meta, img, reg, compare, label, out, scale)
    nframes = sum(len(v) for v in meta["frames"].values())
    checks.append({"name": "contact sheets", "ok": True,
                   "detail": f"{len(meta['frames'])} moves, {nframes} frames; rows: " + ", ".join(
                       ([f"{label}" if label else ""] if compare else []) + ["on green"] + (["on clashing colours"] if reg is not None else [])) +
                   (". The art changed on this branch: the top row is the old art." if label.startswith("on ") else ". Unchanged from " + base + ".")
                   + " Look at every page.", "images": pages})

    found = jumps(meta, box_stats(meta, img, reg))
    checks.append({"name": "size and position steady between frames", "ok": not found,
                   "detail": "\n".join(found) if found else "no frame jumps against its neighbours", "images": []})

    same, mirrored = copies(meta, img, who)
    checks.append({"name": "each side drawn on its own", "ok": not same,
                   "detail": "\n".join(same + [f"(fine) {m}" for m in mirrored]) or "no side is a copy of another", "images": []})

    ball = held_ball(meta, img, reg, out)
    if ball is None:
        checks.append({"name": "held ball on the hand", "ok": True, "detail": "this sheet draws its own ball (no meta.balls), nothing to check", "images": []})
    else:
        off, outside, moved = ball
        # a ball jumping across a turn can be a hand swap the video really shows: listed to look at, not failed
        lines = ([f"off the hand: {', '.join(off)}"] if off else []) + ([f"outside the frame: {', '.join(outside)}"] if outside else []) + (
            [f"(look at these, not failed) the ball moves more than its size between frames: {', '.join(moved)}"] if moved else [])
        checks.append({"name": "held ball on the hand", "ok": not (off or outside),
                       "detail": "\n".join(lines) or "the ball is in the hand in every frame that holds it (red boxes in the picture are flagged)",
                       "images": ["held-ball.png"] if (out / "held-ball.png").exists() else []})

    d = ROOT / Path(atlas).parent
    # check_regions.py knows the kids' pipeline (tidy_regions, key_hair, ball_key); other sheets' maps are made
    # differently and it flags nearly every frame of them
    kid = any(e["id"] == who and e.get("video") for e in json.load(open(ROOT / "assets/characters/bases/index.json")))
    if kid and (d / "regions.png").exists() and (d / "sprites.webp").exists() and "regions" in meta:
        r = subprocess.run([sys.executable, str(ROOT / "tools/pixelart/check_regions.py"), str(d), str(out / "regions.png")],
                           cwd=ROOT, capture_output=True, text=True)
        text = (r.stdout + r.stderr).strip()
        first = text.splitlines()[0] if text else "no output"
        ok = r.returncode == 0 and ", 0 with issues" in first
        checks.append({"name": "colour regions (check_regions.py)", "ok": ok, "detail": text, "images": ["regions.png"] if (out / "regions.png").exists() else []})

    print(json.dumps({"checks": checks}))


if __name__ == "__main__":
    main()
