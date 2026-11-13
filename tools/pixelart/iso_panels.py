"""Checks a court made of flat panels that can fold up like a box (docs/art/isometric.md, "Courts are made of
panels"). Used by iso_eval.py --panels FILE.

A panel set is a folder per court, assets/courts/<court id>/, holding:

  panels.json      the list below
  floor.webp       the floor, with its markings
  wall-hoop.webp   the hoop wall (the plane v = 0), with what's painted on it
  wall-side.webp   the side wall (the plane u = 0)
  hoop.webp        backboard, rim and net
  prop-<name>.webp each prop on its own (prop-bench, prop-scoreboard, ...); racks are rack-<n>.webp
  court.webp       the panels laid out flat: the picture the game shows until the fold-up intro exists

panels.json:

  {
    "court": "arena",                  the court in content/courts.js it is (its origin, eu, ev, room, pxPerM),
    "geometry": {...},                 ...or those numbers here instead (same names as courts.js)
    "scale": 5,                        court pixels per art pixel
    "wallHeight": 4.0,                 game metres, both walls
    "image": "court.webp",             the flat court the panels must add up to
    "panels": [
      {"id": "floor", "kind": "floor", "image": "floor.webp", "at": [x, y], "order": 0},
      {"id": "wall-hoop", "kind": "wall", "plane": "hoop", "image": "wall-hoop.webp", "at": [x, y], "order": 1,
       "hinge": [[x0, y0], [x1, y1]]},
      {"id": "wall-side", "kind": "wall", "plane": "side", ..., "order": 2, "hinge": [[x0, y0], [x1, y1]]},
      {"id": "hoop", "kind": "hoop", "on": "wall-hoop", "foot": [u, z], "image": "hoop.webp", "at": [x, y],
       "order": 3, "hinge": [[x0, y0], [x1, y1]]},
      {"id": "rack-1", "kind": "prop", "on": "floor", "foot": [u, v], "image": "rack-1.webp", "at": [x, y],
       "order": 4, "hinge": [[x0, y0], [x1, y1]]}
    ]
  }

`at` is where the image's top-left corner goes on the court, in court pixels. The hoop wall is the plane v = 0
(u along it, z up), the side wall the plane u = 0 (v along it, z up). A prop's `foot` is where it stands on
the panel it folds with (`on`): [u, v] on the floor, [u, z] on the hoop wall, [v, z] on the side wall.
`hinge` is the line, in court pixels on the unfolded court, the panel turns about: for a wall, the floor edge
it stands on; for the hoop and props, the line where they meet their panel (they fold flat onto it first).
The floor is the base and has no hinge. `order` is the drawing order on the unfolded court, back to front
(each number once; a panel after the one it stands on).
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

REQUIRED = {("floor", None), ("wall", "hoop"), ("wall", "side"), ("hoop", None)}


def _check(name, ok, value, limit, detail):
    return {"name": name, "ok": bool(ok), "value": value, "limit": limit, "detail": detail}


def _p(g, u, v, z=0.0):
    o, eu, ev = g["origin"], g["eu"], g["ev"]
    return (o["x"] + u * eu["x"] + v * ev["x"], o["y"] + u * eu["y"] + v * ev["y"] - z * g["pxPerM"])


def _quad(g, p, H):
    U, V = g["room"]["u"], g["room"]["v"]
    if p["kind"] == "floor":
        return [_p(g, 0, 0), _p(g, U, 0), _p(g, U, V), _p(g, 0, V)]
    if p.get("plane") == "hoop":
        return [_p(g, 0, 0), _p(g, U, 0), _p(g, U, 0, H), _p(g, 0, 0, H)]
    return [_p(g, 0, 0), _p(g, 0, V), _p(g, 0, V, H), _p(g, 0, 0, H)]


def _on_grid(x, k):
    return abs(x / k - round(x / k)) < 1e-6


def check_panels(manifest_path, court_def=None, evaluate=None):
    """Returns a list of checks (the same shape as iso_eval's). `court_def(id)` loads a court; `evaluate(path)`
    scores one image (iso_eval.evaluate) for the per-panel pixel rules."""
    mp = Path(manifest_path)
    m = json.loads(mp.read_text())
    g = m.get("geometry") or (court_def(m["court"]) if m.get("court") and court_def else None)
    if g is None:
        return [_check("panels have geometry", False, None, "court or geometry", "the panel set names no court and has no geometry")]
    k = m.get("scale", 5)
    H = m.get("wallHeight", 0)
    panels = m.get("panels", [])
    byid = {p["id"]: p for p in panels}
    checks = []

    # 1. the panels are there, each on its own layer
    have = {(p["kind"], p.get("plane")) for p in panels}
    missing = [f"{kind} ({plane})" if plane else kind for kind, plane in REQUIRED - have]
    loose = [p["id"] for p in panels if p["kind"] in ("hoop", "prop") and p.get("on") not in byid]
    no_file = [p["id"] for p in panels if not (mp.parent / p["image"]).exists()]
    checks.append(_check("panels present", not missing and not loose and not no_file,
                         {"panels": len(panels), "missing": missing, "loose": loose, "no_file": no_file}, "floor, both walls, hoop; props on a panel",
                         f"{len(panels)} panels" + (f"; missing {', '.join(missing)}" if missing else "")
                         + (f"; not on a panel: {', '.join(loose)}" if loose else "")
                         + (f"; no image: {', '.join(no_file)}" if no_file else "")))
    if no_file:
        return checks
    imgs = {p["id"]: np.asarray(Image.open(mp.parent / p["image"]).convert("RGBA")) for p in panels}

    # 2. hinge edges on the grid: 2:1 floor directions in whole art pixels, every corner and panel on the grid
    off = []
    eu, ev, o = g["eu"], g["ev"], g["origin"]
    if not (eu["x"] == -2 * eu["y"] and ev["x"] == 2 * ev["y"]):
        off.append(f"floor directions aren't exactly 2:1 (eu {eu['x']}, {eu['y']}; ev {ev['x']}, {ev['y']})")
    for name, (x, y) in {"back corner": (o["x"], o["y"]), "hoop-wall end": _p(g, g["room"]["u"], 0), "side-wall end": _p(g, 0, g["room"]["v"]),
                         "front corner": _p(g, g["room"]["u"], g["room"]["v"]), "wall top": _p(g, 0, 0, H)}.items():
        if not (_on_grid(x, k) and _on_grid(y, k)):
            off.append(f"{name} at ({x:g}, {y:g})")
    for p in panels:
        if not (_on_grid(p["at"][0], k) and _on_grid(p["at"][1], k)):
            off.append(f"{p['id']} placed at {p['at']}")
    checks.append(_check("hinges on the grid", not off, off, f"every {k} court px, 2:1",
                         "every hinge corner and panel position is on the art grid" if not off else "; ".join(off)))

    # 2b. handed over for the fold-up intro: file names, a hinge line for every panel but the floor, a drawing order
    hand = []
    want_name = {"floor": lambda p: p["image"] == "floor.webp", "hoop": lambda p: p["image"] == "hoop.webp",
                 "wall": lambda p: p["image"] == f"wall-{p.get('plane')}.webp",
                 "prop": lambda p: p["image"].startswith(("prop-", "rack-")) and p["image"].endswith(".webp")}
    names = [p["id"] for p in panels if not want_name[p["kind"]](p)]
    if names:
        hand.append("file names not as the spec says: " + ", ".join(names))
    orders = [p.get("order") for p in panels]
    if any(o is None for o in orders) or len(set(orders)) != len(orders):
        hand.append("every panel needs its own order number")
    else:
        for p in panels:
            host = byid.get(p.get("on")) or (next((q for q in panels if q["kind"] == "floor"), None) if p["kind"] == "wall" else None)
            if host and host["order"] >= p["order"]:
                hand.append(f"{p['id']} is drawn before {host['id']}, which it stands on")
    U, V = g["room"]["u"], g["room"]["v"]
    for p in panels:
        hg = p.get("hinge")
        if p["kind"] == "floor":
            continue
        if not hg or len(hg) != 2:
            hand.append(f"{p['id']} has no hinge line")
            continue
        if not all(_on_grid(v, k) for pt in hg for v in pt):
            hand.append(f"{p['id']}'s hinge {hg} is off the grid")
        if p["kind"] == "wall":
            edge = [_p(g, 0, 0), _p(g, U, 0)] if p.get("plane") == "hoop" else [_p(g, 0, 0), _p(g, 0, V)]
            d = min(max(math.dist(hg[0], edge[0]), math.dist(hg[1], edge[1])), max(math.dist(hg[0], edge[1]), math.dist(hg[1], edge[0])))
            if d > k:
                hand.append(f"{p['id']}'s hinge isn't the floor edge it stands on ({d:.0f} px off)")
    checks.append(_check("handed over for folding", not hand, hand, "spec file names, hinge lines, drawing order",
                         "file names, hinge lines and drawing order are all there" if not hand else "; ".join(hand)))

    # 3. sizes: each floor and wall panel covers its own face of the box, to within one art pixel
    wrong = []
    for p in panels:
        if p["kind"] not in ("floor", "wall"):
            continue
        q = _quad(g, p, H)
        want = (min(x for x, _ in q), min(y for _, y in q), max(x for x, _ in q), max(y for _, y in q))
        a = imgs[p["id"]][..., 3] > 0
        ys, xs = np.nonzero(a)
        if not len(xs):
            wrong.append(f"{p['id']} is empty")
            continue
        got = (p["at"][0] + xs.min(), p["at"][1] + ys.min(), p["at"][0] + xs.max() + 1, p["at"][1] + ys.max() + 1)
        d = max(abs(a_ - b_) for a_, b_ in zip(got, want))
        if d > k:
            wrong.append(f"{p['id']} covers {tuple(int(v) for v in got)}, its face is {tuple(round(v) for v in want)} ({d:.0f} px out)")
    checks.append(_check("panels the right size", not wrong, wrong, f"within {k} px",
                         "the floor and walls each cover their face of the box" if not wrong else "; ".join(wrong)))

    # 4. hinges closed: along each hinge, both panels reach the line (no gap a fold would open or close wrongly)
    def canvas(pid):
        a = imgs[pid][..., 3] > 0
        return a, byid[pid]["at"]

    def edge_y(pid, x, lowest):
        a, at = canvas(pid)
        cx = int(x) - at[0]
        if not 0 <= cx < a.shape[1]:
            return None
        ys = np.nonzero(a[:, cx])[0]
        return None if not len(ys) else at[1] + (ys.max() + 1 if lowest else ys.min())

    gaps = []
    floor = next((p["id"] for p in panels if p["kind"] == "floor"), None)
    walls = {p.get("plane"): p["id"] for p in panels if p["kind"] == "wall"}
    for plane, end in (("hoop", lambda t: _p(g, t * g["room"]["u"], 0)), ("side", lambda t: _p(g, 0, t * g["room"]["v"]))):
        if floor is None or plane not in walls:
            continue
        x0, _ = end(0)
        x1, _ = end(1)
        n = max(2, int(abs(x1 - x0) / k))
        worst = 0.0
        for i in range(1, n):  # stop short of the ends, where the corner pixels belong to both
            x, y = end(i / n)
            wy, fy = edge_y(walls[plane], x, True), edge_y(floor, x, False)
            if wy is None or fy is None:
                worst = math.inf
                break
            worst = max(worst, abs(wy - y), abs(fy - y))
        if worst > k:
            gaps.append(f"floor and {walls[plane]}: {'a panel stops short' if worst == math.inf else f'{worst:.0f} px off the hinge'}")
    if "hoop" in walls and "side" in walls and H:
        ah, ath = canvas(walls["hoop"])
        as_, ats = canvas(walls["side"])
        x = o["x"]
        worst = 0.0
        for z in np.linspace(0.1, 0.9, 9) * H:
            y = int(o["y"] - z * g["pxPerM"])
            rh, rs = y - ath[1], y - ats[1]
            hx = np.nonzero(ah[rh])[0] if 0 <= rh < ah.shape[0] else []
            sx = np.nonzero(as_[rs])[0] if 0 <= rs < as_.shape[0] else []
            if not len(hx) or not len(sx):
                worst = math.inf
                break
            worst = max(worst, abs(ath[0] + hx.max() + 1 - x), abs(ats[0] + sx.min() - x))
        if worst > k:
            gaps.append("the two walls at the back corner: " + ("a wall stops short" if worst == math.inf else f"{worst:.0f} px off the corner"))
    checks.append(_check("hinges closed", not gaps, gaps, f"within {k} px of the hinge line",
                         "each wall meets the floor, and the walls meet each other, along the hinge" if not gaps else "; ".join(gaps)))

    # 5. hoop and props stand on the panel they fold with
    bad = []
    for p in panels:
        if p["kind"] not in ("hoop", "prop") or p.get("on") not in byid:
            continue
        host = byid[p["on"]]
        f = p.get("foot")
        if f is None:
            bad.append(f"{p['id']} has no foot")
            continue
        lim = (U, V) if host["kind"] == "floor" else ((U, H) if host.get("plane") == "hoop" else (V, H))
        if not (0 <= f[0] <= lim[0] and 0 <= f[1] <= lim[1]):
            bad.append(f"{p['id']}'s foot {f} is off {host['id']}")
        if p["kind"] == "hoop" and host.get("plane") != "hoop":
            bad.append(f"the hoop is on {host['id']}, not the hoop wall")
    checks.append(_check("props on their panel", not bad, bad, "foot inside the panel it folds with",
                         "the hoop and every prop stand on the panel they fold with" if not bad else "; ".join(bad)))

    # 6. each panel is clean pixel art on its own: hard edges, at the panel set's scale
    if evaluate:
        probs = []
        for p in panels:
            card, _ = evaluate(mp.parent / p["image"], kind="prop")
            c = {x["name"]: x for x in card["checks"]}
            if not c["hard edges"]["ok"]:
                probs.append(f"{p['id']}: soft edges")
            cell = card["grid"]["cell"]
            # a small image can't pin its pixel size down closely: about one pixel's worth across its width
            tol = max(0.05, k / max(1, min(card["grid"]["native_size"])))
            if not card["grid"]["native"] and abs(cell - k) > tol:
                probs.append(f"{p['id']}: art pixel {cell:.2f} px, not {k}")
        checks.append(_check("panels are clean pixel art", not probs, probs, f"hard edges, {k} px art pixels",
                             "every panel has hard edges at the set's scale" if not probs else "; ".join(probs)))

    # 7. laid out at their places, the panels add up to the flat court
    if m.get("image") and (mp.parent / m["image"]).exists():
        flat = np.asarray(Image.open(mp.parent / m["image"]).convert("RGBA")).astype(np.float64)
        comp = np.zeros_like(flat)
        order = sorted(panels, key=lambda p: {"floor": 0, "wall": 0, "hoop": 1, "prop": 1}[p["kind"]])
        for p in order:
            a = imgs[p["id"]].astype(np.float64)
            x, y = p["at"]
            h, w = a.shape[:2]
            region = comp[y:y + h, x:x + w]
            src = a[: region.shape[0], : region.shape[1]]
            on = src[..., 3] > 0
            region[on] = src[on]
        both = (flat[..., 3] > 0) | (comp[..., 3] > 0)
        diff = (np.abs(flat[..., :3] - comp[..., :3]).sum(-1) > 24) | ((flat[..., 3] > 0) != (comp[..., 3] > 0))
        share = float(diff[both].mean()) if both.any() else 0.0
        checks.append(_check("panels add up to the court", share <= 0.01, round(share, 4), "at most 1% of pixels differ",
                             f"{share:.1%} of the court's pixels differ from the panels laid out at their places"))
    return checks
