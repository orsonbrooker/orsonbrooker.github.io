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

The tested way (the trial corner, `art/iso/trial-corner/`) is a low-poly scene in Blender, rendered as data
and painted into pixel art by a script, so every line is an exact 2:1 stair and every colour is on the
palette. Hand-drawn art follows the same numbers.

1. **Start from the brief and the numbers.** For a court, write a brief like `art/arena-court.md`. Size things
   against the spec's table (a player is about 85 art pixels tall, the game's ball 16 across) and leave 1.5 m of clear
   floor beside the 3-point arc and 2.5 m behind it, for ball racks.
2. **Snap the layout to the grid before modelling.** With 1 m along the floor as (-24, +12) art pixels, floor
   positions and sizes go in steps of 1/12 m (court lines, rack corners, the room). Heights don't land on
   whole pixels by themselves (1 m up is 29.39 art pixels), so give the wall height in art pixels
   (`wallHeightPx`) and work out metres from it. Walls are 190 px (about 6.5 m), so the court folds shut into
   nearly a cube and clears the backboard.
3. **Write the scene** (`scene.json`, like `art/iso/trial-corner/scene.json`): the canvas and where the floor's
   back corner sits (`origin`, art pixels), `artPerM` 24, the room, the light, the floor `markings` (baseline,
   sideline, the coloured edge, the 3-point line: rectangles in floor metres, painted in order), the shapes
   (flat polygons, boxes, spheres in game metres: u along the hoop wall, v out from it, z up), each with its
   panel and material, and the `props` it places. The light "from the upper left" is (0.55, 0.2, 0.81) in
   (u, v, z): from the side-wall end of the room and above, so the side wall is lit, the hoop wall is in shade,
   and shadows fall towards the side wall.
4. **Give the walls depth.** Bricks get their bevel and tones from the bake. Model what stands out from a wall
   as boxes and hangings: a trim along the top, a skirting board, windows (glass with `panes`, a frame, a sill),
   banners and pennants (`hang`, how far off the wall) on rods. The bake throws their shadows on the bricks.
   Keep them within about one art pixel of the wall at the floor (skirting 0.02 m, top trim 0.05 m out), or
   the hinges won't close.
5. **Props on their own first.** A prop any court can use (the ball rack, `art/iso/props/rack/scene.json`) is
   a scene with `"prop": true`, its foot at 0, 0, rendered and baked like a court. It comes out as one picture
   per way it stands (`along-u`, `along-v`, each lit properly, not flipped) with its floor shadow in it, and
   `prop.json`. Balls are `{"shape": "ball", "r": 0.23, "look": "normal" | "money", "turn": ...}`: the bake
   draws the game's own ball sprite (16 art px, the size the game draws it), so they match the game exactly.
   A corner rack stands `along-v` (along the sideline). A wall prop (`"mount": "wall"`, the scoreboard in
   `art/iso/props/scoreboard/`) hangs `along-u` on the hoop wall and `along-v` on the side wall; a court places
   it with `"on": "wall-hoop"` (or `"wall-side"`) and its foot as [along, up]. A scoreboard's face (`windows`)
   is painted with its digits unlit, plus a `-lit-preview` picture to look at; `prop.json` tells the game where
   each segment is.
6. **Render the passes** (about 2 s each; Blender is already on the Mac), the props first:
   `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/pixelart/iso_blender.py -- scene.json PASSES`
   Each panel is rendered on its own, so what's behind a prop is still there on the floor.
7. **Bake** them: `py tools/pixelart/iso_bake.py scene.json PASSES OUT`. For a court that's the panels, the flat
   `court.webp` and `panels.json`, with each prop placed at its foot from its own folder. The look lives in
   `iso_bake.py`: each material's ramp of palette colours (`RAMPS`), its outline colour (`OUTLINE`), and the
   patterns worked out from each pixel's position. New materials go there.
8. **Outlines** (the bake does this; hand-drawn art does the same): one pixel, drawn just outside a shape's
   silhouette (so thin parts like rack bars keep their own colour), and on the far side wherever one shape is
   in front of another. Never along a hinge, never between parts of one material that meet (a rail and a
   post), never a second line onto the ball's own edge. Take out doubled corners.
9. **A court is folding panels**, in `assets/courts/<court id>/` with the spec's file names and a `panels.json`
   (format at the top of `tools/pixelart/iso_panels.py`; the bake writes it). Point `courts.js` at it with
   `panels`. A piece that's only part of a court (a trial corner) lists what it covers in `needs`.
10. **Measure a court into `content/courts.js`** (origin, `eu`, `ev`, `pxPerM`, rim, `threePointLine`). With the
   bake's camera, `eu` is (-120, +60), `ev` (+120, +60) and `pxPerM` 146.97 court px. A court at 2:1 also needs
   `HORSE_MAP` (`content/horse.js`) and the scoreboard `area` (`content/looks.js`) re-measured, and the game's
   ball drawn 16 art px; the spec's camera section lists the knock-on effects.

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
