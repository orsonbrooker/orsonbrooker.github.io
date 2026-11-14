"""Copies a baked court's panels into the game, for its fold-up intro and Free play's half-folded walls.

  python3 tools/pixelart/iso_export.py art/iso/gym art/iso/gym-contest art/iso/gym-free assets/courts/gym content/courts/gym.js

COURT is the court as it's played, CONTEST its 3-point contest version (racks' shadows only, iso_bake "game"
props) and FREE its Free play version (the hoop on its own post, art/iso/props/hoop-pole).

Reads the court's panels.json (iso_bake.py) and writes ASSETS/panels/ with each panel's picture and each prop's
bare picture (its shadow is already in the panel under it), and ASSETS/panels.json, which play/fold.js reads:

  {
    "size": 2400,
    "floor": {"image": "...", "at": [x, y]},          the floor (court pixels: the picture's top left)
    "contestFloor": {"image": "...", "at": [x, y]},   the same floor with the 3-point contest racks' shadows
    "walls": {"hoop": {"image", "at", "hinge": [[x, y], [x, y]]}, "side": {...}},
    "props": [{"id", "image", "at", "on": "floor" | "wall-hoop" | "wall-side", "hinge": [[x, y], [x, y]],
               "foot": [u, v] (floor) or [along, up] (wall)}],
    "free": {"floor", "walls"}                        Free play's floor and walls: the post hoop's shadow and glass
    "poleHoop": {"image", "at"}                       the hoop on its own post, for when the hoop wall folds back
  }

Props are in drawing order. A floor prop folds flat about its hinge; a wall prop folds with its wall.

It also writes MODULE (content/courts/gym.js), what content/courts.js needs from the bake when the game starts: the
wall scoreboard (where its prop hangs, and its face from the prop's prop.json) and the 3-point contest's racks (each
one's picture's top left, in RACK_LAYOUT order, and its prop orientation). Generated: don't edit it by hand.
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    court, contest, free, assets, module = (Path(a).resolve() for a in sys.argv[1:6])
    m = json.loads((court / "panels.json").read_text())
    out = assets / "panels"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    rel = lambda name: str((out / name).relative_to(ROOT))  # noqa: E731

    def copy(src, name):
        shutil.copyfile(src, out / name)
        return rel(name)

    info = {"size": m["geometry"]["size"], "walls": {}, "props": []}
    for p in m["panels"]:
        if p["kind"] == "floor":
            info["floor"] = {"image": copy(court / p["image"], "floor.webp"), "at": p["at"]}
        elif p["kind"] == "wall":
            info["walls"][p["plane"]] = {"image": copy(court / p["image"], f"wall-{p['plane']}.webp"), "at": p["at"],
                                         "hinge": p["hinge"]}
        else:
            src = (court / p["image"]).resolve()
            name = f"{p['id']}.webp"
            info["props"].append({"id": p["id"], "image": copy(src, name), "at": p["at"], "on": p["on"],
                                  "hinge": p["hinge"], "foot": p["foot"]})
    cm = json.loads((contest / "panels.json").read_text())
    cf = next(p for p in cm["panels"] if p["kind"] == "floor")
    info["contestFloor"] = {"image": copy(contest / cf["image"], "floor-contest.webp"), "at": cf["at"]}
    # Free play: its floor, walls and the hoop on its post (copied out of the shared prop by the bake as hoop.webp)
    fm = json.loads((free / "panels.json").read_text())
    info["free"] = {"walls": {}}
    for p in fm["panels"]:
        if p["kind"] == "floor":
            info["free"]["floor"] = {"image": copy(free / p["image"], "floor-free.webp"), "at": p["at"]}
        elif p["kind"] == "wall":
            info["free"]["walls"][p["plane"]] = {"image": copy(free / p["image"], f"wall-{p['plane']}-free.webp"),
                                                 "at": p["at"], "hinge": p["hinge"]}
        elif p["kind"] == "hoop":
            info["poleHoop"] = {"image": copy(free / p["image"], "hoop-pole.webp"), "at": p["at"]}
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
