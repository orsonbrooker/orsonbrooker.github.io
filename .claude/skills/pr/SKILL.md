---
name: pr
description: Write a branch's merge note, .verify/<branch>/merge-note.md - what changed in plain English, before/after pictures, merge danger (one-way or two-way door, blast radius, what going live needs), what was checked and what wasn't, and what only Luke can judge. The same text works as a GitHub PR body. Use at the end of a review, or when asked for a merge note, PR description or "what does this branch do".
---

# Merge note

Luke reads this instead of the diff, so it has to stand on its own: short, plain English, pictures first,
and honest about what nobody checked. Based on ideas from Matt Pocock's pr skill (MIT); written our own way.

## 1. Facts first

Run each as its own command (the worktree guard refuses chains). Base is `test-all` unless told otherwise.

- `git branch --show-current`, then `git log --format='%h %s%n%b' <base>..HEAD`
- `git diff <base>...HEAD --stat`, then read the diff (for binary art, the stat is enough; look at the pictures)
- `node tools/dev/blast_radius.mjs <base>`: the door, pages, modes, players, Worker routes, migrations,
  `shared/rules.js`, `FEATURE_FROM` and the going-live steps, all worked out from the diff. Use what it
  prints; don't guess these by eye. `--json` gives the same facts for a script. For a branch already merged,
  `node tools/dev/blast_radius.mjs <merge>^1 --head <merge>^2`.
- `.verify/<branch>/summary.json` and the PNGs beside it (from `tools/dev/verify.mjs`). If there's no
  verify run for a visible change, run the one that fits (`node tools/dev/verify.mjs pages`, `play` or
  `art`), or say plainly in **Checked** that nothing was looked at.
- The output of `npm run check` if it ran this session (or run `npm run check -- --quick`).

## 2. Write it

Copy `template.md` (beside this file) to `.verify/<branch>/merge-note.md` and fill it in. Rules:

- **What changed**: one paragraph a parent could follow: what a kid playing will notice, then how it's
  done in a sentence. No file-by-file tour. Add the *smallest* picture only when the words aren't enough:
  a few lines of pseudo-code, a five-line file tree, or a small mermaid diagram (a flow with a server step,
  a new phase in `PHASES`). Most notes need none.
- **Before / after**: images from `.verify/<branch>/`, linked by file name (the note sits beside them).
  Before on the left, after on the right, in a two-column table. Phone first. Pick the two to six that show
  the change; never paste every screenshot. Nothing visual? Show the test or check lines that prove it.
  For "before" pictures, run verify on the merge base in a throwaway detached worktree in the scratchpad
  (`git worktree add --detach <dir> <merge-base>`, copy `node_modules` in with `cp -cR`: Vite refuses a
  symlinked one), then remove the worktree. Same page, same size, same player and colours both times.
- **Merge danger**: the door, why, blast radius and going-live order, from `blast_radius.mjs`. Then read
  the diff for what paths can't show, and add it:
  - one-way: a data fix to run live, saves read in a new shape, coins or prices that change, leaderboard
    scores counting differently, a Worker response the installed iOS app relies on, anything for the App Store
  - a "check" door from the helper (rules, saved progress, public Worker code) is settled by you: say
    in one line why it is, or isn't, one-way. Don't leave it at "check".
  - two-way only when `git revert` and a redeploy would put everything back as it was.
- **Checked**: each check or verify run with ✓ or ✗ and a few words. Reviewer fixes and open findings go
  here too. Then **Not verified**: always present, never empty-by-default. Name what wasn't run (iPad, the
  iOS app, sound, the live Worker, a real phone, other players than the one shown, Turnstile).
- **For Luke**: one or two things only a person can judge (does the shot feel right, does the hair look
  like Curly's), each with a link to try it: the `verify serve` link if one is running, otherwise the local
  URL with the right query (`?debug`, `?debug&head=<style>`, the builder page).
- Kids' names: nicknames as in the game, never real surnames. No times beyond the date.
- Keep it under about 60 lines plus images. Cut adjectives; say what is, not how good it is.

## 3. As a GitHub PR body

The same file works as `gh pr create --body-file .verify/<branch>/merge-note.md`. Local image links won't
show on GitHub: drag the images into the PR or leave the table as file names. Don't open a PR unless Luke
asks: this project merges into `test-all` locally.

## 4. Hand back

Say where the note is and give its first line (the door). If the door is one-way, say that first: those
wait for Luke even at the next trust level.
