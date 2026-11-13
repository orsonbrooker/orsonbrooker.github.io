---
name: verify
description: Look at what a change does to orsonbrooker.com before calling it done - phone/iPad/desktop screenshots of every page, games played end to end, frame times and sizes against perf-budget.json, art contact sheets with checks, and phone test links. Use after any change to the game, the pages, the builder or a player's art, and before review or asking Luke to look.
---

# Verify

`node tools/dev/verify.mjs <subcommand>` (or `npm run verify -- <subcommand>`). It starts its own headless
Chrome (Puppeteer's chrome-headless-shell); never use the app's browser pane (it pauses the game when
hidden) or the shared puppeteer browser (other sessions drive it). Everything lands in `.verify/<branch>/`:
PNGs per subcommand, `summary.json` and `index.html`, the contact page a reviewer opens.

**Exit 0 is not "done".** The checks catch the mechanical part. Open the PNGs (Read them) and look: art
that's wrong but steady, a cropped ball, a screen that's empty, text that runs off. Say in your report what
you looked at.

## Which subcommand

| You changed | Run | Pass means |
|---|---|---|
| Any page, CSS, a screen, a menu | `pages` | No script errors, no sideways scroll, nothing to tap under 44px at phone (390x844) and iPad (820x1180), on every page and the game's title, choose-a-game and choose-a-player screens. Desktop is shot but not failed on size. |
| Game code (`play/`, `modes/`, `engine/`, `shared/rules.js`) | `play [timed,survival,around,threes]` | Each game reaches game over, the server accepts it and turns down a made-up copy, no errors; the game-over screen passes the tap check. Needs the local Worker on 8787. |
| Anything per frame, players' loading, the builder, bundles, images | `perf` | Frame work (p50, p95, worst, gaps over 50 ms) in 20 s of play and the builder preview at 4x slower CPU, one colour change and one height step in the builder, gzipped JS/CSS per page and first-load bytes, all within `perf-budget.json`. |
| A player's or body's art (`assets/characters/…`) | `art <orson\|curly\|buns\|spiky\|…>` | See below. |
| Luke (or you) wants to try it on a phone | `serve` | Builds, serves `dist/` with `tools/dev/lan_server.py` on a free port and prints localhost, Wi-Fi and Tailscale links. It keeps running; stop it with the `kill` it prints. |

Options: `--no-build` (serve `dist/` as it is), `--url BASE` (use a server already running), `--port N`
(a headless Chrome already on that debug port), `--out DIR`, `perf --update-budget` (rewrite the budget
from today's numbers plus headroom: only when Luke agrees a change is worth it, and say why).

Frame times move by about a third from run to run when other sessions are busy. Run `perf` once more before
believing a frame-time failure; sizes don't wobble.

## Art

`art <id>` writes `sheet-N.png`: every move, frame by frame, lined up on the feet at one scale, with the
game's held ball drawn in. Each move has three rows: the art **before this branch** (from `test-all`; or
the pixel twin when the art didn't change), **on green**, and **on clashing colours** (each region loud, so
paint in the wrong region shows). It also writes `held-ball.png` (every held ball with the hand round it,
flagged ones boxed red), `regions.png` from `tools/pixelart/check_regions.py` (kids from video), and for
Orson `prints-off-jersey.png` from `tools/dev/check_prints.mjs`.

It fails on: a frame whose height, feet or middle jumps against its neighbours, or a move drawn at a
different size from standing; a side that's a copy of another (`dribble-fl` = `dribble-l`); a held ball with
no hand or body round it; region problems; prints off the jersey. A ball that moves more than its size
between frames is listed to look at, not failed. Today's Curly and Buns fail on the front-left copies,
which are stand-ins until their own videos are in.

## How to reach and drive each part

Local URLs below are on whatever `verify` (or `serve`) prints. In `?debug` the game exposes `window.game`.

- **Shootaround** `/games/shootaround/`: tap the stage (or Space) for **Choose a game**: cards with
  `[data-mode]` `timed` (Time attack, 60 s), `survival` (Sudden death), `around` (Around the World),
  `threes` (3-point contest, only in `?debug`), `horse` (2-4 players pass one device; no leaderboard) and
  `free` (free play). Then **Choose your player** (`#char-pick .card`). Shoot by holding Space (keydown on
  `window`) and letting go at the top of the jump (`player.anim === "jump"`, `player.t` near 0.29, or
  `game.zoneCenter()` when the green moves). Pause button or Escape pauses. Game over has Play again,
  Replay (best shot in slow motion), Change game, Change player. `HELPERS` in `tools/dev/play.mjs` does
  all of this. Courts: `await game.setCourt("gym-windy")`; repeatable games: `game.setSeed(n)`.
- **Player builder** `/players/`: tabs Character (`#tab-character`: colour chips, swatches, the wall of
  `.character-card` bodies), Body (`#tab-body`: `#height` and `#bulk` sliders, 0-4), Team, Gear; on a phone
  the preview canvas (`#preview`) is covered on the Character tab, so open Body to see it. Done (`#done-open`) asks for a
  nickname and a robot check (Turnstile), which needs the local Worker. `?gear=beanie` tries gear.
- **Ideas board** `/ideas/`: filter buttons (All, New games, Shootaround, The website), columns Ideas,
  Planned, Done; "Got an idea?" opens the feedback sheet (rude-word filter, Turnstile). Reads
  `/api/ideas`, so it's empty without the local Worker.
- **Home** `/`, **404** `/404.html` (a little shot you can take), **lab** `/lab/` (hidden effects test page;
  not checked for tap size).
- **Admin** `http://localhost:8787/admin` (Worker only, not in `dist/`; no sign-in locally, from this Mac
  only): inbox, ideas, players, scores, words, stats. Live it's behind Cloudflare Access: never drive the
  live admin.

Based on ideas from pstack's verification skill, in our own words.
