---
name: player-art
description: Build or rebuild a Shootaround player from a pose sheet (a built-in player like Jethro, or a player-builder body), then check it - cut-out holes, colour regions, poses, picker order. Use when Luke sends a new or redrawn sheet, or players look glitchy.
---

# Player art

Sheets are drawn by Luke in an image tool from `art/character-template.png` (16:9, 7 columns x 2 rows of
poses on a flat backdrop; the tool only does 16:9, 4:3, 1:1, 3:4 and 9:16). Sources live in
`art/characters/<id>.jpg` (built-in players) and `art/characters/bases/<id>.jpg` (builder bodies). Orson's own
sprites come from video and can't be rebuilt. Python with Pillow and numpy: `~/.venvs/announcer/bin/python`
works, or `uv run --with pillow --with numpy python3`. `cwebp` comes from `brew install webp`.

## Built-in player (e.g. Jethro)

1. `python tools/build_character.py art/characters/<id>.jpg <id> "<Name>"`
2. `python tools/check_character.py <id>` and look at `.character-cache/check-<id>.png` (every pose, feet on
   the floor line).
3. `assets/characters/index.json` sets the picker order: Orson first, then Jethro. Building can move entries.

## Builder body (spiky, curly, cap...)

1. `python tools/build_character.py art/characters/bases/<id>.jpg <id> <id> --base` (keeps a lossless copy in
   `.character-cache/<id>.png`, gitignored: copy it into a worktree to rebuild regions)
2. `python tools/build_regions.py <id> --preview /tmp/<id>-regions.png` (writes `regions.png`: red channel
   0 keep, 1 skin, 2 hair, 3 jersey, 4 team colour, 5 shoes; plus where numbers go)
3. Rebuilding keeps the body's place in `assets/characters/bases/index.json` (the builder's order).

## Check before going live

- Recolour every body in clashing colours (e.g. skin #4a2e1c, hair #3d6bd6, jersey #d63a3a, team #f2cf3d,
  shoes #3fa65c) on a **green** background with `players/recolor.js` in the headless browser, at 2x or more.
  Look for: see-through holes (green showing inside the jersey or cap), gaps wrongly filled (backdrop-coloured
  blobs between arms and body), grey patches that didn't recolour, speckled shoes.
- No pose moved: compare `frames` and `releaseOffset` in `sprites.json` with the previous version.
- Body files are briefly inconsistent between the two build steps; don't judge the builder mid-rebuild.

## Known causes

- See-through holes: the cut-out used to treat pale jersey shading as backdrop. Fixed in `key()` in
  `build_character.py`: inside the body, only patches that are the backdrop colour itself are cut.
- Grey jersey folds and shoe highlights not recolouring: `fill_shading()` in `build_regions.py` grows those
  regions into the blue-greys they touch. A future fix is sheets drawn in flat key colours per part.
