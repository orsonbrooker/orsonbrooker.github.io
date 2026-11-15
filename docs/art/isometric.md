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
- **Court pixels written outside `courts.js`:** the old gym's scoreboard `area` in `content/looks.js` (HORSE's
  spot map is each court's `horseMap` now) (on a 2:1 court the scoreboard prop's `prop.json` replaces it: see "The scoreboard"). Code that goes through `project()`, `EU` and `EV` (`engine/court.js`, steering in
  `play/round.js`) follows the new numbers by itself.
- **The hoop front** (`assets/hoop-front.webp`) is redrawn with the court, on its grid.
- **The players** don't change: they're sprites with their own camera and size. Because `pxPerM` goes up,
  they stand about 10% fewer game metres tall (about 2.9 instead of 3.2), and the ball's flight looks about
  10% taller on screen. Check the jump and release points, and how the ball meets the hand, against the new
  rim after a redraw (`verify play`, `verify art`).
- **The ball** is drawn `BALL_R * PX_PER_M * 2.6` court px across (`play/scene.js`): 79 on the gym, but 88 on a
  2:1 court because `pxPerM` goes up. Draw it 16 art px (80 court px) instead, its radius on the floor's scale,
  so it stays the size it is today and matches the rack balls.

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
  | Ball | 0.46 across (`BALL_R` 0.23) | drawn 79 (about 16) | 0.24 m |
  | Rim | 0.9 across, 3.05 up | 119 across | 0.46 m, 3.05 m |
  | 3-point line | 3.1 to 4.74 from the hoop | | 6.75 m |
  | Gym floor | 8.2 x 8.25 | | |

- **Rule: court markings are where `courts.js` says, within 10 cm.** The eval finds the painted 3-point line
  along 19 rays from the hoop and compares it with `threePointLine`. Check: "3-point line where courts.js
  says". The gym passes (1 cm off on average; the line is 11 cm wide).

## Wall height: a box

- **Rule: walls are about 6.5 game metres high** (190 art px, a whole number of 5 px brick courses; Luke, 14 Nov
  2026). The floor is about 8.2 x 8.25, so folded shut the court is nearly a cube, and it reads as a box. It also
  clears the backboard (top at 5.0 m) with room for a trim, windows and a scoreboard above or beside it, as in
  the gym. A whole court at 2:1 is then about 1935 court px tall, inside a 2048 canvas. Lower walls (the first
  trial's 2.7 m) are under the rim and fold down to a flat tray.
- A court has only the hoop wall and the side wall. Folded shut, that's a box with two sides open. Closing
  it all the way in the fold-up intro needs two front walls (or a lid) that only show while it folds: not
  in the hand-over yet.

## The scoreboard

A scoreboard is a shared wall prop (`art/iso/props/scoreboard/`), not painted into a court:

- **Drawn for each wall** (`along-u` hangs on the hoop wall, `along-v` on the side wall), so the light is right
  and its writing reads left to right on screen on both (a flipped picture would be mirrored).
- **The art has the digits unlit**: every segment of every digit in a dim colour. The game lights the segments
  it needs. `prop.json` says where: for each way it hangs, the face's corner on the wall (metres from the foot,
  along and up), which way reading goes along the wall, the face's size, each window's digit cells and the
  seven segments of a digit, all in face pixels (1/24 m along the wall, one art pixel up). So the digits are
  pixel art on the court's 2:1 grid, and no court has numbers measured off its picture (today's `BOARD_ART` in
  `content/looks.js` is the gym's own, measured by hand).
- **A court only says where it hangs**: which wall and its foot (the middle of its bottom edge) as [along,
  up] in metres. Keep it clear of the backboard (u 3.35 to 6.4, up to 5.0 m in the gym).
- **Different looks share the same insides**: a classic board, an arena screen, an outdoor flip board are
  each their own prop with the same `prop.json` face, so the game's code doesn't change. More windows (HORSE
  letters, a rack counter) are more entries in the scene's `windows`.
- The lit colour in the art preview is `#d0553c` (on the palette); the game can use it for pixel-art digits.

## Room for racks and props

Every court leaves clear floor round the court markings for ball racks and similar props (Luke, 14 Nov 2026),
first for the 3-point contest's 5 racks (`content/threes.js` `RACK_LAYOUT`, `art/three-point-contest.md`).
In the game's floor directions, u runs along the hoop wall and v runs out from it. The sides are the floor's
two ends along u (the side wall and the open side). The open front edge is the far end along v, behind the
top of the arc.

- **Racks stand inside the arc and point at the hoop** (Luke, 14 Nov 2026): the wings and the top at their
  angle from `RACK_LAYOUT`, their back end 0.1 m inside the 3-point line, their length running straight at the
  rim. The corner racks sit near the baseline and point straight in, their back end 0.1 m inside the corner's
  straight line, their long side 0.05 m behind the rim's middle. The rack prop is drawn turned to each angle
  (`rot-<deg>`, iso_scene.py), lit from the upper left each time, as well as along each wall.
- **A rack's footprint is 2.5 x 0.56 game metres** (`art/iso/props/rack/`): five of the game's balls in a row,
  each 16 art px, the size the game draws its ball (smaller balls looked bad).
- **Rule: at least 1.5 m of clear floor beside each end of the 3-point arc**, to both side edges, and **at least
  2.5 m behind the top of the arc**, to the open front edge: room for players shooting from outside the line, a
  bench, a bag. Checks: "room beside the arc", "room behind the arc" (the arc from `threePointLine`, the floor
  from `room`).
- **Rule: every rack in `RACK_LAYOUT` fits**, all five at once: on the floor, at least 0.2 m inside the edges,
  and not overlapping each other. Check: "racks fit on the floor". A court made of panels is checked from its
  own `panels.json` (its scene gives `rim` and `threePointLine`), so new art is checked before the game has it.
- **Rule: the same floor outside the court lines on every side** (Luke, 14 Nov 2026): behind the baseline (to
  the hoop wall), beside both sidelines and past the half-court line, with the same blue band (1/3 m) round
  the lines. The gym has 1 m.
- Keep the floor under the racks plain: no logos or markings there (`art/arena-court.md`).

**The game's gym breaks this:** 1.53 m to the side wall but only 0.37 m to the open side, and 2.38 m behind the
arc. **The redrawn gym** (`art/iso/gym/`) keeps the game's 3-point line round the rim, with 1 m of floor outside the
court lines on every side, so the floor is 9.5 x 9.5 m: 1.57 m and 1.62 m beside the arc, 2.97 m behind it. Its
picture is 2400 px square (the game's gym is 2048), so the game has to show the bigger picture when it moves to
it. It comes twice: `art/iso/gym/` for normal games, with one rack along the side wall by the bench, and
`art/iso/gym-contest/` for the 3-point contest, with all five (same walls and floor, baked from the same Blender
passes; the props differ, and so do the shadows painted into the floor). In the contest gym the racks are
`"game": true`: their shadows are painted into the floor but the racks are left out of `court.webp` (`preview.webp`
shows them), because the game draws them itself from the rack prop's pictures for each number of balls left
(`"ballStates": true` bakes `rack-rot-<deg>-left-<n>.webp`, n from 0 to 5). The game still draws its racks outside the line (`content/threes.js`); moving them inside is game work, for
when it uses this art.

## Courts are made of panels

**Into the game:** `python3 tools/pixelart/iso_export.py art/iso/gym art/iso/gym-contest art/iso/gym-box
assets/courts/gym content/courts/gym.js art/iso/street` copies the closed box's pictures into the game with a `panels.json` (where each
goes) that `play/fold.js` reads to open the box at the start of a game, and writes `content/courts/gym.js` (the scoreboard and the contest racks, which
`content/courts.js` imports). Rebake and re-export together.

**The closed box** (Luke, 15 Nov 2026): `art/iso/gym-box/` is the gym shut, its two front walls (as thick as the
back walls, from outside: `out-left`, `out-right`) and its roof (`lid`, which the game splits in two down the
middle; its START button is the game's), plus plain side and hoop walls (`in-left`, `in-right`) the game turns
into the front walls' insides as they fold down. Its scene is made from the gym's (same room, walls and light).

The panels below came first (Luke, 14 Nov 2026): a court can fold up like a box before a game or round starts, then
unfold to show the court. The animation is separate work; the art only has to make it possible. So a new court is drawn as
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
| `rack-<n>.webp` | A ball rack drawn for this court only. A shared prop (the ball rack) isn't copied in: `panels.json` points at its picture in the props folder (below) |
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

**Props are shared.** A prop that can stand on any court (the ball rack) is its own folder,
`art/iso/props/<name>/` (later `assets/props/<name>/`): a picture for each way it stands (`<name>-along-u.webp`,
`<name>-along-v.webp`) and `prop.json` (for each: where its foot is in the picture, its footprint, its hinge,
its height; a wall prop is `"mount": "wall"` and also says which wall each picture is for). **A prop's picture
carries its own shadow on the floor** (a wall prop's falls on its wall), as pixels of one dark colour at one
see-through level (`#180826` at 84 of 255), so it looks right on any floor. It's also saved without the shadow
(`<name>-bare-<way>.webp`) and the shadow on its own (`<name>-shadow-<way>.webp`). A court places it with
`props` in its scene: **the court bake paints each prop's shadow into the floor or wall it falls on**, darkened
and snapped to the palette like the walls' own shadows, and stands the bare picture there; see-through shadows
blended over a court make colours off the palette. Its `panels.json` entry names the prop and the picture.
Props are drawn in the order the scene lists them: wall props first, then floor props from the back.

**The props so far:** the ball rack, the scoreboard, the hoop, blue wall padding (`pad`, 2.7 x 2 m, three
panels), a round wall clock (`clock`, its face a standing `ring` with `"axis"`), a wall shelf with books, a
bottle and a plant (`shelf`), a bench with a backpack and a bottle on it (`bench`) and a backpack on the floor
(`bag`). Each is drawn both ways, lit from the upper left each way.

**The hoop is a shared prop too** (`art/iso/props/hoop/`, `"kind": "hoop"`): backboard, rim and net on the hoop wall,
sized from `content/courts.js` (rim 3.05 m up, radius 0.45; the board's front 0.62 m behind the rim's middle,
the board drawn 2.2 m wide and 2.85 to 4.15 m up, smaller than the game's 3.05 x 2.15 m, which looked
too big next to real-size props; the game's board should shrink to match). The board stands 1.18 m off the wall on four arms, so the rim's middle is 1.79 m out, with 1 m of floor
behind the baseline (the game's gym has 1.125, with the board almost on the wall). **The board is see-through
glass** (`"part": "glass"`): only its frame, target and two light streaks are drawn; through the rest, the hoop's
own arms are tinted in its bake, and its picture is left see-through there with a mask (`<name>-glass-<way>.webp`)
so the court bake tints the wall behind (mixed a third of the way to `#afd1e0`, then snapped to the palette). Its parts marked `"part": "front"` (the rim's and net's front halves) are also baked on their
own: the hoop front the game draws over a ball dropping through. A court copies both out as `hoop.webp` and
`hoop-front.webp`, and `panels.json` says where the front goes (`hoopFront`). The net is painted as one-pixel
strings with see-through between.
The whole gym (`art/iso/gym/`) is built this way: its rim and 3-point line are the game's (the floor markings
take `arc`, the line's distance from the hoop every 10 degrees, and `rings` [u, v, inner, outer, v from (, v
to)], with `dashes` for a dashed ring), plus hash marks, the free-throw circle's dashed inner half, the centre
circle's half on this side of the half-court line (1.25 m radius, clear of the 3-point line), a roof truss along the side wall, a 0.3 m thick floor (`slab`, its
edge showing on the open sides; the floor panel is that much taller) and 0.25 m thick walls (`wallThick`: each
wall's top and open end show, in the top trim's colours; the wall panels are that much bigger).

## Light

- **Rule: light comes from the upper left, the same as the players**. In the game's directions the light comes
  from (0.55, 0.2, 0.81) in (u, v, z): from the side-wall end of the room and above, so shadows on the floor
  fall towards the side wall. See `art/player-animation.md`. Tops are
  lightest. Faces turned to the left (the right wall, the left side of a prop) are next. Faces turned to
  the right (the hoop wall, the right side of a prop) are darkest. Check: "light from the upper left" (courts:
  the right wall's lower half is lighter than the hoop wall's).
  **Gym breaks this:** both walls are about the same (hoop wall 45, right wall 43, in CIE lightness), so
  the light reads as flat, if anything from the right. The floor (62) is lightest, which is right.
- **Rule: walls have depth** (Luke, 14 Nov 2026: the first trial's walls looked flat next to the gym's). Every
  brick has its own tone, a lit top row and a shaded bottom row, with joints a step darker (not outline-dark).
  Bricks darken into the back corner and up under the top trim. Walls carry detail that stands out from them:
  a trim along the top, a skirting board, windows (frame, sill, panes with a light streak), hangings on rods,
  and each throws a shadow on the bricks, traced towards the light. Things standing out from a wall stay
  within about one art pixel of it at the floor (skirting 0.02 m, trim 0.05 m), so the hinges stay closed.
  Luke scores this.
- **Rule: a court's floor has its markings**: the baseline and sideline (1/12 m, white), the coloured edge
  outside them (the gym's blue, 0.25 m), and the 3-point line, all as `markings` in the scene, on the 1/12 m
  grid. The gym's are at 0.75 m (blue), 1.0 m (lines) and its corner 3-point line at 1.5 m.
- Props: the eval can't find a prop's faces by itself, so Luke scores the light on props (see
  [Luke's scores](#lukes-scores)).

## Colours

- **Rule: a court uses at most 64 colours at its own size, and new art uses the palette.** The palette is
  `art/iso/palette.json`: the gym's 32 main colours, so new courts and props match it, then the game's own
  ball colours (from `ball_from`: the 16 colours `engine/draw.js` uses for the normal and money ball, made by
  `iso_bake.ball_colours`). The ball keeps its own colours wherever it's drawn. Checks: "few
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
- **Rule: no outline along a hinge** (where a wall meets the floor or the other wall): the change of colour is
  the edge there, and two panels each outlining it would make a line two pixels thick. A silhouette's outline
  goes just outside the shape, so thin parts (rack bars) keep their own colour. Parts of one material that
  meet (a rail and a post) are one piece: no line between them.
- **The game's ball is drawn as the game draws it**, with its own dark edge and seams (`engine/draw.js`), not
  to these outline rules. A rail in front of a ball draws no second line onto the ball's edge. The eval leaves
  the game's ball colours out of "outlines one pixel wide" and "lines match the camera".
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
  (no soft or anti-aliased edges), except its floor shadow: one dark colour at one see-through level. Check:
  "hard edges". The hoop front passes.
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

The gym's ball rack's "0.323" slope is the short end rails; with lines that short the reading is rough. (New
props have the same: a rack's end rails, a wall prop's sides. The eval now leaves out a direction whose lines are
under a quarter as strong as the other's.)

## How the eval measures (in brief)

- **The grid:** the colour edges in each column and row are summed, and the strongest repeat between 1.5 and
  16 px is the art pixel size (with where the grid starts). A repeat under 2.5 px, a weak one, or a different
  one across and down means the art is at its own size. The middle of each cell is sampled to get the art at
  its own size, and most checks run on that.
- **Lines:** pixels on a step in lightness are swept with every slope from 0.3 to 0.9; the slope where the most
  of them pile up on the same lines wins, if a line at least 12 pixels long agrees. On a court, only the floor
  is measured. A direction whose lines stand out under a quarter as much as the other direction's (a wall prop
  seen side on, a rack's end rails) isn't read: there's no real line there to measure.
- **Colours:** CIE Lab (D65). Distances are CIE76.
- **Outlines:** pixels darker than L 22 that are crossed (sideways or up-down) by a run of 1 to 4 of them with
  something lighter on both sides. Longer dark runs are shadows, not lines.
- **Courts:** the court's numbers come from `content/courts.js` (through Node), so a court is always checked
  against the geometry the game plays on.
