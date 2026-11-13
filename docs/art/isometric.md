# Isometric art: the style spec

The rules for Shootaround's isometric pixel art: courts now, props (racks, benches, hoops) and maybe a city
later. Each rule says what's measured and what checks it. `tools/pixelart/iso_eval.py` measures an image
against these rules and prints a scorecard. The `iso-art` skill (`.claude/skills/iso-art/SKILL.md`) is how to
make or change the art. `docs/rules.md` lists each rule with what enforces it.

Players have their own spec (`docs/art/characters.md`). This one covers where the players stand.

**What the current art does.** The gym (`assets/court.webp`) is the approved reference. It was not drawn on
a pixel grid. It is a painted image in pixel style, 400 x 400 "pixels" blown up to 2048 px, so each pixel is
5.12 screen pixels. Some rules below record what the gym does (the scale, the markings). Others
are what new art should do (the 2:1 camera among them), and the gym breaks them. Each break is flagged **Gym breaks this** or **old camera**, and the
numbers are in [Baseline](#baseline-the-approved-references).

## Words

- **Court pixel**: one pixel of the court image as shipped (2048 across for the gym). `content/courts.js`
  measures everything in court pixels.
- **Art pixel**: one pixel of the art at its own size, before it's blown up. The gym's art pixel is 5.12
  court pixels.
- **Game metre**: the unit of `content/courts.js` and the physics. The game's metres are not real metres (see
  [Scale](#scale)).

## The camera

Every court, prop and player is seen from one camera. **New art uses clean 2:1 pixel lines** (Luke, 14 Nov
2026): along the floor, every line steps two pixels across for one down, every time (0.5 down per across,
26.6 deg). That's a real camera looking down 30 degrees.

- **Rule: lines along the floor slope 0.5 down per across, both ways, within 0.03.** Checks: "lines match the
  camera" (the art), "court data matches the camera" (`courts.js` `eu` and `ev`, also within 0.02 of each
  other).
- **Rule: the axes match that camera.** 1 m along the hoop wall and 1 m out from it are the same length on
  screen, within 1%. 1 m up is 1.095 times that, as a real camera looking down 30 degrees draws it. Check:
  "one scale on every axis".
- Vertical lines stay vertical. The hoop is on the left wall, the open side of the floor faces the viewer,
  and the room is a cut-away box (`art/arena-court.md`).
- `iso_eval.py --line-ratio N` checks against another slope (for example 0.566 to compare with the old gym).

**The gym uses the old camera, and changes on any redraw.** It was painted before this rule:

| | Gym (old camera) | Where |
|---|---|---|
| 1 m along the hoop wall (`eu`) | (-115.3, +64.2) court px: 0.557 down per across, 29.1 deg | `content/courts.js` |
| 1 m out from the hoop wall (`ev`) | (+114.4, +65.8) court px: 0.575 down per across, 29.9 deg | `content/courts.js` |
| 1 m up | 132 court px (`pxPerM`), the same as along the floor | `content/courts.js` |
| Long lines painted on the floor | 0.548 and 0.555 down per across | `iso_eval.py` on the gym |

That's about 0.566 (29.5 deg), close to true isometric (0.577), looking down about 34.5 degrees. Its steps go
2, 2, 1, 2, 2, 1, ... so its lines look a bit ragged. The test set keeps these numbers as known breaks.

**Redrawing the gym (or any court) at 2:1 means re-measuring it:**
- **`content/courts.js`:** `origin`, `eu`, `ev`, `pxPerM`, `rim.at`, `hoopFrontAt`, `size`, and checking
  `threePointLine` against the new paint. For example, 1 m along the floor as (-24, +12) art pixels is
  (-120, +60) court px at 5x (134.2 long), so `pxPerM` is 147 (1.095 x 134.2). The floor looks a little
  flatter, and walls and the rim a little higher on screen, than today.
- **Court pixels written outside `courts.js`:** `HORSE_MAP` in `content/horse.js` and the scoreboard `area`
  in `content/looks.js`. Code that goes through `project()`, `EU` and `EV` (`engine/court.js`, steering in
  `play/round.js`) follows the new numbers by itself.
- **The hoop front** (`assets/hoop-front.webp`) is redrawn with the court, on its grid.
- **The players** don't change: they're sprites with their own camera and size. Because `pxPerM` goes up,
  they stand about 10% fewer game metres tall (about 2.9 instead of 3.2), and the ball's flight looks about
  10% taller on screen. Check the jump and release points, and how the ball meets the hand, against the new
  rim after a redraw (`verify play`, `verify art`).

## Scale

- **Rule: art pixels are a whole number of court pixels, the same everywhere.** That's 5 for courts and props,
  the size the pixel-art players already use (`assets/characters/*-pixel/`, `res` 0.2). Checks: "pixel size
  is a whole number", "one pixel size everywhere", "players' pixels match the court's".
  **Gym breaks this:** its pixels are 5.12 court px, so some are drawn 5 px wide and some 6. A quarter of its
  busy areas measure a slightly different size. The fix is to redraw it at 410 x 410 art pixels and ship it
  at 5x (2050 px), changing `size` and the positions in `courts.js` to match.
- **Art pixels per game metre: about 26** (132 / 5 = 26.4; the gym is 132 / 5.12 = 25.8).
- **The game's sizes, in game metres.** The game's metres are stretched: players and the ball are drawn about
  twice real size so they read on a phone, and the court is smaller than a real one. New props are sized
  against this table, not against real life.

  | Thing | Game metres | Court px (art px) | Real life |
  |---|---|---|---|
  | A player, standing | 3.1 to 3.4 tall | 410 to 450 (82 to 90) | about 1.4 m |
  | Ball | 0.46 across (`BALL_R` 0.23) | 61 (12) | 0.24 m |
  | Rim | 0.9 across, 3.05 up | 119 across | 0.46 m, 3.05 m |
  | 3-point line | 3.1 to 4.74 from the hoop | | 6.75 m |
  | Gym floor | 8.2 x 8.25 | | |

- **Rule: court markings are where `courts.js` says, within 10 cm.** The eval finds the painted 3-point line
  along 19 rays from the hoop and compares it with `threePointLine`. Check: "3-point line where courts.js
  says". The gym passes (1 cm off on average; the line is 11 cm wide).

## Room for racks and props

New courts leave clear floor round the court markings for ball racks and similar props (Luke, 14 Nov 2026),
first for the 3-point contest's 5 racks (`content/threes.js` `RACK_LAYOUT`, `art/three-point-contest.md`).
In the game's floor directions, u runs along the hoop wall and v runs out from it. The sides are the floor's
two ends along u (the side wall and the open side). The open front edge is the far end along v, behind the
top of the arc.

- **A rack's footprint is 1.5 x 0.6 game metres**: 1.5 along the hoop wall, 0.6 out from it. That's the gym's
  own ball rack, read off the art from its four feet (about u 0.1 to 0.7, v 6.4 to 8.0; by eye, to 0.1 m). Racks run along the hoop wall,
  centred on their floor point, which stands 0.35 m past the 3-point line.
- **Rule: at least 1.5 m of clear floor beside each end of the 3-point arc**, to both side edges. A corner
  rack needs 0.35 m past the line, half its length (0.75 m) and 0.2 m off the edge: 1.3 m. The rest is slack
  for its outline and shadow. Check: "room beside the arc" (the arc from `threePointLine`, the floor from
  `room`).
- **Rule: at least 2.5 m of clear floor behind the top of the arc**, to the open front edge. A rack there
  needs about 1.2 m (0.35 m, its 0.6 m depth, 0.2 m off the edge), plus room for the player standing beside it
  and the floor's edge trim. Check: "room behind the arc".
- **Rule: every rack in `RACK_LAYOUT` fits on the floor**, its whole footprint at least 0.2 m inside the
  edges. Check: "racks fit on the floor".
- Keep the floor under the racks plain: no logos or markings there (`art/arena-court.md`).

**Gym breaks this:** 1.53 m to the side wall but only 0.37 m to the open side, and 2.38 m behind the arc.
Racks 1 and 2 (the right-hand corner and wing in the art) run off the floor's open side. That's why the
arena court brief exists.

## Courts are made of panels

A court can fold up like a box before a game or round starts, then unfold to show the court (Luke, 14 Nov
2026). The animation is separate work; the art only has to make it possible. So a new court is drawn as
separate flat panels, each its own image with see-through round it, not one painted picture:

- **the floor**;
- **the hoop wall** (the plane v = 0) and **the side wall** (u = 0), each with what's painted on it;
- **the hoop** (backboard, rim and net) on its own, folding with the hoop wall;
- **each prop and rack** on its own, folding with the panel it stands on (the floor, or a wall for a
  scoreboard or pennant).

The floor is the base. Each wall hinges on one of the floor's back edges, and the two walls meet at the back
corner. **Every new court delivers these panels** (Luke, 14 Nov 2026): the planned **fold-up intro** (the court
folding up like a box before a game or round, then unfolding) waits for the 2:1 court art and is built
straight from this hand-over.

**How the panels are handed over.** One folder per court, `assets/courts/<court id>/`:

| File | What |
|---|---|
| `floor.webp` | The floor, with its markings |
| `wall-hoop.webp` | The hoop wall (the plane v = 0), with what's painted on it |
| `wall-side.webp` | The side wall (the plane u = 0) |
| `hoop.webp` | Backboard, rim and net |
| `prop-<name>.webp` | Each prop on its own: `prop-bench`, `prop-scoreboard`, ... |
| `rack-<n>.webp` | Each ball rack |
| `court.webp` | All the panels laid out flat: what the game shows until the fold-up intro exists |
| `panels.json` | The panel list (below) |

`panels.json` is small: the court it belongs to (`court`, the id in `content/courts.js`, which points back at
it with `panels`), the art pixel size (`scale`, 5), the wall height in game metres (`wallHeight`), the flat
picture (`image`), and one entry per panel:

```json
{"id": "wall-hoop", "kind": "wall", "plane": "hoop", "image": "wall-hoop.webp",
 "at": [x, y], "order": 1, "hinge": [[x0, y0], [x1, y1]]}
```

- `at`: where the image's top-left corner goes on the unfolded court, in court pixels.
- `hinge`: the line the panel turns about, as two points in court pixels on the unfolded court. For a wall,
  the floor edge it stands on. For the hoop and props, the line where they meet their panel: they fold flat
  onto it first, then go with it. The floor is the base and has no hinge.
- `order`: the drawing order on the unfolded court, back to front: each number once, and a panel after the
  one it stands on.
- Props and the hoop also say which panel they fold with (`on`) and where they stand on it (`foot`, game
  metres: [u, v] on the floor, [u, z] on the hoop wall, [v, z] on the side wall).

The full format is at the top of `tools/pixelart/iso_panels.py`. Checks (`iso_eval.py --panels FILE`):

- **Rule: the panels are all there.** Floor, both walls and the hoop; every prop is on a panel. Check:
  "panels present".
- **Rule: it's handed over as above**: the file names, a hinge line for every panel but the floor (each wall's
  on the floor edge it stands on, every hinge point on the art grid), and a drawing order. Check: "handed over
  for folding".
- **Rule: every hinge is on the 2:1 grid.** 1 m along the floor is a whole number of art pixels, exactly
  two across for one down (for example `eu` (-120, +60), `ev` (+120, +60) court px at 5x). The back corner,
  the floor's other corners, the top of the walls and every panel's place are whole art pixels. So floor
  sizes are in steps of one art pixel along the floor (1/12 m at that size) and the wall height a whole number
  of art pixels. Check: "hinges on the grid".
- **Rule: each panel covers its face of the box**, to within one art pixel. Check: "panels the right size".
- **Rule: the hinges are closed.** Along each hinge both panels reach the line, within one art pixel, so a
  fold neither opens a gap nor overlaps. Check: "hinges closed".
- **Rule: props stand on their panel.** A prop's foot is inside the panel it folds with, and the hoop is on
  the hoop wall. Check: "props on their panel".
- **Rule: every panel is clean pixel art on its own**: hard edges, art pixels at the set's scale. Check:
  "panels are clean pixel art".
- **Rule: laid out at their places, the panels add up to the court.** If the set includes the flat court
  picture, at most 1% of its pixels may differ from the panels laid out. Check: "panels add up to the court".

The court check "made of panels" passes when the court in `courts.js` has a panel set. **Gym breaks this:**
it's one flat image. Cutting it into panels would need the hidden parts (the floor under the bench and rack,
the wall behind the hoop) painted in, so it's best done as part of a redraw at 2:1.

## Light

- **Rule: light comes from the upper left, the same as the players** (`art/player-animation.md`). Tops are
  lightest. Faces turned to the left (the right wall, the left side of a prop) are next. Faces turned to
  the right (the hoop wall, the right side of a prop) are darkest. Check: "light from the upper left" (courts:
  the right wall's lower half is lighter than the hoop wall's).
  **Gym breaks this:** both walls are about the same (hoop wall 45, right wall 43, in CIE lightness), so
  the light reads as flat, if anything from the right. The floor (62) is lightest, which is right.
- Props: the eval can't find a prop's faces by itself, so Luke scores the light on props (see
  [Luke's scores](#lukes-scores)).

## Colours

- **Rule: a court uses at most 64 colours at its own size, and new art uses the palette.** The palette is
  `art/iso/palette.json`: the gym's 32 main colours, so new courts and props match it. Checks: "few
  colours" (distinct colours, merged within Lab 2.3), "on the palette" (CIE Lab distance from each art pixel
  to the nearest palette colour: mean at most 2, at most 2% further than 6). Remake the palette with
  `iso_eval.py IMAGE --make-palette 32` if Luke approves a new reference.
  **Gym breaks this:** 2201 colours at its own size (soft painted shading and image compression). Against
  its own 32-colour palette, 14% of its pixels are further than 6.
- **Rule: each material has 2 to 4 shades in a ramp, and ramps shift hue.** Shadows move towards purple or
  blue, lights towards yellow, not just darker and lighter. Check: "ramps shift hue" (the palette is split
  into ramps, darkest to lightest by nearest neighbour; most ramps must move at least 8 degrees of hue).
  The gym passes: its wood and brick ramps move from red-purple shadows to yellow-orange lights.

## Outlines

- **Rule: outlines go only round the outside of a thing and where depth changes** (a prop against the wall,
  the floor's edge, one object in front of another). There are no lines inside a flat face: a colour change
  marks that edge. Luke scores this; the eval can't tell a depth edge from a drawn detail.
- **Rule: outlines are one art pixel wide.** Check: "outlines one pixel wide" (outline-dark pixels, CIE L under
  22, crossed the thinner way; at most 10% may be in a line 2 to 4 pixels thick).
  **Gym breaks this:** 33% (the scoreboard frame, the backpack, the bench and the windows are thick).
- **Rule: outlines take colour.** An outline is a dark shade of what it goes round (dark brown round wood,
  dark purple round brick), not black. Lighter on the lit side is fine. Check: "outlines take colour" (at most
  half the outline pixels plain near-black: L under 12 and chroma under 15). The gym passes (20%).
- **Rule: no doubled corners.** A stepped line touches corner to corner. An extra pixel in the corner of a
  step makes an L, which makes the line look thick and jaggy. Check: "no doubled corners" (at most 5% of
  outline pixels). **Gym breaks this:** 10%.

## The grid, seams and clean-up

- **Rule: one grid.** Every pixel of a court, and every prop or overlay placed on it, sits on the same grid
  of art pixels. Overlays (like `hoopFront`) are placed at a position that's a whole number of art pixels
  from the court's grid. Checks: "seams on the grid" (busy 256 px tiles whose grid is shifted over a quarter
  pixel from the whole image's), "overlays on the court's grid".
  **Gym breaks this:** 7 of its 56 busy tiles drift off its grid, and the hoop front lands about half a pixel
  off the court's grid both ways.
- **Rule: no mixed pixel sizes.** No thin lines, dots or text drawn smaller than one art pixel; no part of the
  art scaled by a different amount. Checks: "one pixel size everywhere", "cells are flat colour" (at least
  90% of art pixels are one flat colour inside).
  **The hoop front breaks this:** its net is drawn in lines one court pixel wide inside a 5 px grid (62% of
  its pixels are flat), and its grid isn't square (5.03 across, 5.17 down).
- **Rule: no stray pixels.** A lone pixel no neighbour shares, in a patch that's mostly one other colour, is
  noise. Check: "no stray pixels" (at most 2 per 1000 art pixels). **Gym breaks this:** 3.4 per 1000.
- **Rule: hard edges on props.** A prop on its own is fully see-through or fully solid, never partly
  (no soft or anti-aliased edges). Check: "hard edges". The hoop front passes.
- **Rule: no blur.** Art is scaled up nearest-neighbour only, never smoothed. "Cells are flat colour" catches
  blur.

## Luke's scores

The eval can't judge everything. For each new or changed piece of art, Luke scores these 1 to 5, and the
scores go in `art/iso/scores.md` with the date and the eval's scorecard:

1. **Reads on a phone**: at phone size, can you tell what everything is?
2. **Matches the players**: players look like they stand in it (light, outline, pixel size).
3. **Light and depth**: lit from the upper left; outlines only where depth changes.
4. **Feels like Shootaround**: the colours and mood fit the gym.
5. **Clear where it matters**: nothing busy on the floor near the 3-point arc or under players.
6. **Safe for kids**: no real brands, teams, people or words that could be rude.

When Luke corrects something more than once, it becomes a new rule here and, if it can be measured, a new
check in `iso_eval.py` with a test in `tools/pixelart/test_iso_eval.py`. The `retro` skill does this.

## Baseline: the approved references

The test set is `art/iso/testset.json` and the numbers are in `art/iso/baseline.json`. `iso_eval.py --testset`
(run by `npm run check`) fails only when a case gets worse than this, or a new case breaks a rule.

| Check | gym | gym corner | ball rack (in the gym) | hoop front |
|---|---|---|---|---|
| Pixel size (court px per art px) | 5.121 FAIL | 5.115 FAIL | 5.122 FAIL | 5.10 (5.03 x 5.17) FAIL |
| One pixel size everywhere | 14 of 56 tiles off FAIL | 2 of 9 FAIL | pass | pass |
| Cells are flat colour | 94% pass | 90% FAIL | 85% FAIL | 62% FAIL |
| Seams on the grid | 7 of 56 off FAIL | 2 of 9 FAIL | pass | pass |
| Lines match the camera (2:1, 0.5) | 0.548, 0.555 FAIL (old camera) | 0.54, 0.55 FAIL (old camera) | 0.513, 0.323 FAIL | (no long lines) |
| On the palette (mean, share over 6) | 2.9, 14% FAIL | 4.5, 22% FAIL | 6.0, 45% FAIL | 8.2, 68% FAIL |
| Colours at its own size | 2201 FAIL | 1403 FAIL | 1114 FAIL | 134 FAIL |
| Ramps shift hue | 9 of 9 pass | 7 of 8 pass | 7 of 8 pass | 1 of 1 pass |
| Outlines one pixel wide | 33% thick FAIL | 40% FAIL | 42% FAIL | 11% FAIL |
| Outlines take colour (near-black) | 20% pass | 22% pass | 25% pass | 0% pass |
| No doubled corners | 10% FAIL | 5% FAIL | 7% FAIL | 0% pass |
| No stray pixels (per 1000) | 3.4 FAIL | 4.3 FAIL | 3.3 FAIL | 0 pass |
| Hard edges | | | | pass |
| One scale on every axis | 132 up for 132 along; 2:1 wants 144.6 FAIL (old camera) | FAIL (old camera) | | |
| Court data matches the camera | 0.557, 0.575 FAIL (old camera) | FAIL (old camera) | | |
| 3-point line where courts.js says | 1 cm off pass | | | |
| Overlays on the court's grid | hoop front +0.47, -0.40 FAIL | | | |
| Players' pixels match the court's | 5.00 vs 5.12 FAIL | | | |
| Room beside the arc (1.5 m) | 1.53 m wall side, 0.37 m open side FAIL | | | |
| Room behind the arc (2.5 m) | 2.38 m FAIL | | | |
| Racks fit on the floor | 3 of 5 FAIL | | | |
| Made of panels | one flat image FAIL | | | |
| Light from the upper left | hoop wall 45, right wall 43 FAIL | FAIL | | |

The ball rack's "0.323" slope is the short end rails; with lines that short the reading is rough.

## How the eval measures (in brief)

- **The grid:** the colour edges in each column and row are summed, and the strongest repeat between 1.5 and
  16 px is the art pixel size (with where the grid starts). A repeat under 2.5 px, a weak one, or a different
  one across and down means the art is at its own size. The middle of each cell is sampled to get the art at
  its own size, and most checks run on that.
- **Lines:** pixels on a step in lightness are swept with every slope from 0.3 to 0.9; the slope where the most
  of them pile up on the same lines wins, if a line at least 12 pixels long agrees. On a court, only the floor
  is measured.
- **Colours:** CIE Lab (D65). Distances are CIE76.
- **Outlines:** pixels darker than L 22 that are crossed (sideways or up-down) by a run of 1 to 4 of them with
  something lighter on both sides. Longer dark runs are shadows, not lines.
- **Courts:** the court's numbers come from `content/courts.js` (through Node), so a court is always checked
  against the geometry the game plays on.
