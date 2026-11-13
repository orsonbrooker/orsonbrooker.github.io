---
name: flow-images
description: Make game art in Luke's Google Flow project (Shootaround) on this Mac with agent-browser — repaint a video kid's hair, ball or gear in key colours on grids of their frames, start frames for new kids' videos, heads, courts — then bring the images back, check them and build them. Use when Luke asks to make or remake art with Flow / Nano Banana, or to add gear to a kid.
---

# Making art in Google Flow

Luke's Flow project **Shootaround** (flow.google.com) holds the game's references and past generations.
Drive it with **agent-browser** on this Mac: a real Chrome with its own profile, signed in as Luke, headless.
`flow.py` (next to this file) uploads, queues prompts and downloads. Each browser has one driver at a
time (below).

```sh
agent-browser --config ~/.agent-browser/flow.json --session flow open https://flow.google.com   # once
python .claude/skills/flow-images/flow.py upload <files>
python .claude/skills/flow-images/flow.py queue <ref prefix> 0 13 <prompt file>
python .claude/skills/flow-images/flow.py collect <newest N> <out dir> "BUNS BALL KEY \d\d" [<expected>]
```

**Browsers** (each signed in by Luke himself, in a visible window): "flow" (`~/.agent-browser/flow.json`),
"flow3" and "flow4". Pick one with `FLOW_SESSION=flow3` (the default is "flow"). Each browser has one
driver: say which one you're taking, and never drive one another session is using. Never copy a signed-in
profile to make another: Google signed out both the copy and the original when we tried (13 Nov 2026).
Several browsers share the one account, so Flow's per-account limits still apply.

**Files** live in `/Users/lukebrooker/Documents/Work/Shootaround`, never in Downloads or a scratchpad:
- `videos/`: source videos: `orson/` (with `CHECKLIST.md`), `curly/`, `buns/`, `unused/` (what `art/video/*.json` read)
- `gear/`: `grids/<kid>/` (grids uploaded to Flow and `grids.json`), `flow/<item>/<kid>/` (Flow's images),
  `refs/` (reference grids), `prompts/`, `sheets/` (contact sheets)
- `flow-images/`: other Flow images: `start-frames/` (kids' video start frames), `early-sprite-sheets/`
- `reference/`: reference pictures (Orson, court, hoop)
- `downloads/`: where the browsers save files (flow3 and flow4 are set to it)

If Google asks to sign in, reopen with `--headed` and ask Luke to sign in in that window; never type his
password. Shell commands with `eval` in them are refused in a worktree: put them in a script and run that.

## Credits

Images (Nano Banana 2.1 and Nano Banana Pro) are free; `queue` checks the settings say **0 credits** and
stops otherwise. Each model has its own daily allowance: about 500 prompts at x2 used up 2.1's on 13 Nov
2026 ("You've reached your usage limit"), while Pro still worked. Pro leaves the rest of the picture far
more untouched (about 20k changed pixels outside the item against 150k), a little softer. `queue` sets the
model (FLOW_MODEL) and images per prompt (FLOW_COUNT, default 1) every time: they're shared account
settings. Send at x1 unless picking the better of two matters, and pace big batches.
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

## Gear

One pass per item per kid, on grids from `python tools/pixelart/gear_key.py grids <kid> <dir>` (shoes and
shorts greyed, the held ball painted in; uploaded as `<kid>-kit-NN.jpg`). The prompt says what the item is
and how it's worn, the main part in shaded magenta (#c040b0) and a second colour (cuff, peak, stripes) in
shaded bright blue (#1e8cff): the two keys separate cleanly. Name arms by what they do ("the arm that
shoots"). Tag it `<KID> <ITEM> KEY {n}` (one word for the item). Then `match_grids.py`, then
`gear_key.py build <kid> <item> <dir> <prefix>`, then `node tools/dev/gear_sheet.mjs` for its contact sheet.

## New kids

Their start frames are free image edits of Orson's start frames (`orson-start-<clip>.png` in Flow) with
the kid's head reference; make kids with **mid-brown hair** with clear light and shade, so every hair colour
recolours well. Videos (Omni, Frames, 720p, 5 s, x1) are Luke's call, one at a time.

## Good results

- Two references for new looks: the layout first (what must not move), then what it should look like.
- Flat green #00B140 background, nothing else in the picture.
- Kid-safe, friendly faces, no brands, logos or real people's likenesses unless Luke says so.
- Nothing goes live without Luke saying so.
