---
name: flow-images
description: Make game art in Luke's Google Flow project (Shootaround) on this Mac with agent-browser — repaint a video kid's hair, ball or gear in key colours on grids of their frames, start frames for new kids' videos, heads, courts — then bring the images back, check them and build them. Use when Luke asks to make or remake art with Flow / Nano Banana, or to add gear to a kid.
---

# Making art in Google Flow

Luke's Flow project **Shootaround** (flow.google.com) holds the game's references and past generations.
Drive it with **agent-browser** on this Mac: a real Chrome with its own profile, signed in as Luke, headless.
`flow.py` (next to this file) uploads, queues prompts and downloads. One session drives the "flow" browser
at a time; ask any other session using it to stop first.

```sh
agent-browser --config ~/.agent-browser/flow.json --session flow open https://flow.google.com   # once
python .claude/skills/flow-images/flow.py upload <files>
python .claude/skills/flow-images/flow.py queue <ref prefix> 0 13 <prompt file>
python .claude/skills/flow-images/flow.py collect <newest N> <out dir> "BUNS BALL KEY \d\d"
```

If Google asks to sign in, reopen with `--headed` and ask Luke to sign in in that window; never type his
password. Shell commands with `eval` in them are refused in a worktree: put them in a script and run that.

## Credits

Images (Nano Banana 2.1) are free; `queue` checks the settings say **0 credits** and stops otherwise.
Videos cost about 15 credits each (Luke has 1000 a month): ask Luke before each one, and make one at a time.

## Repainting a kid's frames (hair, ball, gear)

The game recolours parts by their light and shade, so each part Flow paints is in a **key colour**: shaded
medium magenta (hue about 55° in the Cb/Cr plane; skin, the ball, the green screen and the kit sit
elsewhere). One key colour per pass: hair in one pass, the ball in another, each gear item in its own.

1. Grids of the kid's frames: `python tools/pixelart/frame_grids.py assets/characters/<kid>-detail <dir>`
   (24 frames per 16:9 image). Copy them to names unique to the kid (`<kid>-grid-NN.jpg`) before
   uploading: the project already holds older `grid-NN.jpg` files, and a shared name picks the wrong ones.
2. A prompt file, its first words a tag (`BUNS HAIR KEY {n}.`), then: copy the first image exactly (same
   frames, poses, sizes, positions, green background, pixel-art style); only recolour <the part> to a solid
   medium magenta purple with its own darker shadows, lighter highlights and a dark outline; keep anything
   in front of it (fingers on a ball) in front; change nothing else, nothing else magenta. Settings: Image,
   16:9, x2.
3. `queue` it over the grids, wait a minute or two, then `collect` the newest items (two per grid).
4. **Check before using:** `python tools/pixelart/match_grids.py <dir> "<downloads>/*.img" <prefix>`
   renames each image by the grid it matches and flags weak matches. Any WEAK one, or a grid with more
   than its share, means a wrong download: look at it.
5. Build: `key_hair.py` (hair) or `ball_key.py` (the ball) on `<kid>-detail`, after `tidy_regions.py`;
   then look at the kid in clashing colours (blue hair, very light and very dark skin) from every side.

Gear works the same way: one pass per item, in the item's key colour, laid over the frames as its own part.

## New kids

Their start frames are free image edits of Orson's start frames (`orson-start-<clip>.png` in Flow) with
the kid's head reference; make kids with **mid-brown hair** with clear light and shade, so every hair colour
recolours well. Videos (Omni, Frames, 720p, 5 s, x1) are Luke's call, one at a time.

## Good results

- Two references for new looks: the layout first (what must not move), then what it should look like.
- Flat green #00B140 background, nothing else in the picture.
- Kid-safe, friendly faces, no brands, logos or real people's likenesses unless Luke says so.
- Nothing goes live without Luke saying so.
