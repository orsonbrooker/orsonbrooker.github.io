---
name: announcer-voice
description: Record new announcer lines for Shootaround in the existing announcer voice (Chatterbox on the Mac), check them, let Luke listen, and pack them into assets/voice. Use when phrases.js gets new lines or a clip sounds wrong.
---

# Announcer voice lines

Lines live in `phrases.js` (lists per moment, e.g. `supernova`, `moneyBall`). Clips are made by
`tools/build_voice.py` with Chatterbox in `~/.venvs/announcer` (Python 3.11; setup steps are at the top of
the script; the first run downloads about 2 GB). Clips are cached in `.voice-cache/` (gitignored) and packed
into one file, `assets/voice/announcer-<hash>.m4a`, plus `assets/voice/voice.json`. Lines without a clip fall
back to the device's voice.

1. In a worktree, copy the cache first so only new lines get recorded:
   `rsync -a /Users/lukebrooker/Code/orsonbrooker.github.io/.voice-cache/ .voice-cache/`
2. Add the lines to `phrases.js`. Avoid words that come out wrong: "Cash ball" was heard as "Catch ball", so
   it became "Golden ball!". Short, punchy, NBA Jam style.
3. Record in the background (it takes minutes):
   `~/.venvs/announcer/bin/python tools/build_voice.py` (new lines only), or `--only "<text>"` for one line,
   `--force` to redo.
4. Each clip is checked with speech recognition against its text. Re-record any it flags as garbled. Numbers
   written as digits vs words ("20" vs "twenty") are harmless mismatches.
5. Let Luke listen before packing: `--only "<text>" --samples <folder>` writes takes he can play. Send them
   with SendUserFile. For a line that sounds bad, make 2-3 takes and let him pick.
6. Pack (`--pack-only` after swapping a chosen take into `.voice-cache/`). The old `announcer-*.m4a` is
   deleted and the new one is referenced from `voice.json`; commit both.
7. After going live, copy the new clips back to the main checkout's `.voice-cache/` (see go-live).
