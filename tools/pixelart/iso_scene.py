"""Shared by iso_blender.py (inside Blender) and iso_bake.py: turns a prop's scene into one panel per way it
can stand. Plain Python, no numpy, so Blender's Python can import it too.

A prop scene (art/iso/props/<name>/scene.json) has "prop": true and its shapes in the prop's own metres: x along
its length, y across (out from the wall, for a wall prop: "mount": "wall"), z up, with its foot (where it stands
on a court, or where it hangs on a wall: the middle of its bottom back edge) at 0, 0, 0. It's rendered standing
"along-u" (its length along the hoop wall) and "along-v" (its length out from the hoop wall, as on a sideline),
each lit from the upper left on its own, so a corner rack isn't a mirrored picture with the light on the wrong
side.
"""

ORIENTATIONS = {
    "along-u": lambda p: [p[0], p[1], p[2]],
    "along-v": lambda p: [p[1], p[0], p[2]],
}


def expand_prop(sc):
    """A prop scene with its shapes copied into one panel per orientation (game metres, foot at 0, 0)."""
    if not sc.get("prop"):
        return sc
    out = dict(sc)
    out["panels"] = {}
    out["shapes"] = []
    for name in sc.get("orientations", list(ORIENTATIONS)):
        f = ORIENTATIONS[name]
        out["panels"][name] = {"kind": "prop", "on": sc.get("mount", "floor"), "foot": [0, 0]}
        for s in sc["shapes"]:
            t = dict(s, panel=name)
            if s.get("face") == "wall":  # a wall prop's front: on the hoop wall standing along u, the side wall along v
                t["face"] = "hoop" if name == "along-u" else "side"
            if s["shape"] == "box":
                a, b = f(s["min"]), f(s["max"])
                t["min"] = [min(x, y) for x, y in zip(a, b)]
                t["max"] = [max(x, y) for x, y in zip(a, b)]
            elif s["shape"] in ("sphere", "ball"):
                t["centre"] = f(s["centre"])
            elif s["shape"] == "poly":
                t["points"] = [f(p) for p in s["points"]]
            out["shapes"].append(t)
    return out
