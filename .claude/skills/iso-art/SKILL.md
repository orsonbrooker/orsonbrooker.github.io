---
name: iso-art
description: Make or change Shootaround's isometric pixel art (a court, a prop like a rack or bench, an overlay like the hoop front, later a city) to the style spec, and score it with tools/pixelart/iso_eval.py against the approved references. Use when new court or prop art comes in, when art in assets/ that isn't a player changes, or when content/courts.js geometry changes.
---

# Isometric art

The rules are `docs/art/isometric.md`. Read it first: the camera (clean 2:1 lines), 5 court px per art
pixel, light from the upper left, the palette, one-pixel outlines that take colour, one grid. The players have
their own skill (`player-art`) and spec (`docs/art/characters.md`).

All commands run from the worktree root with `uv run --with pillow --with numpy python3` (shortened to `py`
below). Nothing to install.

## Making art

1. **Start from the brief and the numbers.** For a court, write a brief like `art/arena-court.md`. Draw at the
   art's own size (a court about 410 x 410 art pixels), on the palette `art/iso/palette.json`, lit from the upper
   left, floor lines at 2:1 (two across, one down), sized against the table in the spec (a player is about 85 art pixels
   tall, the ball 12 across). A court leaves 1.5 m of clear floor beside the 3-point arc and 2.5 m behind
   it, for ball racks (the spec's "Room for racks and props").
2. **Blow it up nearest-neighbour by a whole number** (5 for courts and props). Never smooth, never resize by
   a fraction. Props are saved with hard edges (alpha 0 or 255).
3. **Place it on the grid.** An overlay's position (like `hoopFrontAt`) is a whole number of art pixels from
   the court's grid.
4. **A court is folding panels.** Draw the floor, the hoop wall, the side wall, the hoop and each prop as
   separate images (paint in what's hidden behind props) in `assets/courts/<court id>/` with the spec's file
   names, and list them in a `panels.json` (format at the top of `tools/pixelart/iso_panels.py`) with each
   panel's place, hinge line, drawing order and the panel each prop folds with. Point `courts.js` at it with
   `panels`. The planned fold-up intro is built from this. Check with `iso_eval.py --panels panels.json`.
5. **Measure a court into `content/courts.js`** (origin, `eu`, `ev`, `pxPerM`, rim, `threePointLine`), as
   `art/arena-court.md` describes. A court at 2:1 also needs `HORSE_MAP` (`content/horse.js`) and the
   scoreboard `area` (`content/looks.js`) re-measured; the spec's camera section lists the knock-on effects.

## Scoring it

```
py tools/pixelart/iso_eval.py IMAGE [--court ID] [--crop X,Y,W,H] [--kind prop] --out .verify/<branch>/iso/<name>
```

- It prints one line per check, pass or FAIL, and writes `scorecard.json`, `summary.txt` and `marks.png` (the
  art dimmed, with stray pixels pink, thick outlines orange, doubled corners cyan, and on a court the 3-point
  line where `courts.js` says it is in green, where it's painted in red). Open `marks.png` and look.
- `--court ID` adds the court checks (camera, scale, markings, room for racks, panels, light, overlays, players' pixel size).
- `--panels FILE` checks a panel set: all there, hinges on the 2:1 grid, right sizes, hinges closed, props on
  their panel, clean pixel art, and adding up to the flat court.
- A panel set can be a test set case: `{"id": ..., "kind": "panels", "panels": "path/to/panels.json"}`.
- `--line-ratio 0.566` checks against the gym's old camera instead of 2:1 (only to compare with the old gym).

**New art should pass every check.** The gym itself doesn't (see the spec's Baseline): that's the old art's
debt, not a target.

## The test set

```
py tools/pixelart/iso_eval.py --testset --out .verify/<branch>/iso
py -m unittest tools/pixelart/test_iso_eval.py
```

`npm run check` runs both. The test set (`art/iso/testset.json`) is the approved references; it fails when a
case gets worse than `art/iso/baseline.json` or a new case breaks a rule.

- **Changed the eval?** Run the unit tests (a block drawn to the spec passes; each broken copy fails the rule
  it breaks), then the test set. If the baseline numbers move, say why.
- **Luke approved new art?** Add a case to `testset.json` (and a crop of a corner or prop if useful), then
  `--testset --update-baseline`, and commit the baseline with the art. Never update the baseline to hide a
  regression.

## After Luke looks

Ask Luke to score the art (the questions are in the spec, "Luke's scores") and add a row to
`art/iso/scores.md`. If he corrects something, fix it, and if it's a correction he's made before, add a rule
to the spec, a check to `iso_eval.py` with a test, and a row to `docs/rules.md` (the `retro` skill).

Nothing goes live without Luke: new art in `assets/` reaches visitors only through the `go-live` skill.
