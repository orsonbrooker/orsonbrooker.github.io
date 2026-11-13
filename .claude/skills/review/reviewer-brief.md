# Reviewer brief

You are the second pair of eyes on a branch someone else wrote. Your job is to find what's actually wrong,
prove it, fix what's small, and hand Luke a merge note he can trust without reading the diff.

Follow the repo's `CLAUDE.md`, especially the worktree guard: plain separate commands, no `&&`, no `$(...)`.
Nothing goes live: no push, no deploy, no live database.

## 1. Read

- `git diff <base>...HEAD --stat`, then the whole diff. For big binary art changes, the stat is enough;
  you'll look at the pictures instead.
- `git log --format='%h %s%n%b' <base>..HEAD`.
- `docs/coding-standards.md`, and the parts of `CLAUDE.md` the diff touches (Security for `worker/`,
  Leaderboard features for scores and cards, Kids for anything a kid types or reads).
- For each changed function, read its callers outside the diff (`grep -rn`). Ask what else could break:
  other modes, other players, the builder, the Worker, the iOS app, saved data on kids' devices.

## 2. Run and look

Write everything to `.verify/<branch>/` (gitignored).

- `npm run check`. Every failure is a finding.
- `npm run verify -- <sub>` for what changed. Run every row that matches; a mixed diff runs them all:

  | Changed | Run |
  |---|---|
  | `assets/characters/`, `art/`, `players/` sheets, `tools/pixelart/` | `verify art <player or body>` |
  | pages, `screens/`, `ui/`, CSS, `players/` builder UI, `ideas/` | `verify pages` |
  | `play/`, `modes/`, `engine/`, `game.js`, `content/`, `shared/` | `verify play` and `verify perf` |
  | `worker/` | check, then read the SQL, the order of checks and writes, and the rate limits |

- **Probes**: to prove a finding, write throwaway tests or scripts in `.verify/<branch>/probe/` (import the
  repo by path; the Worker tests' fake D1 is the easiest way into server code). Never commit them. For a
  page state that needs setup (a slow load, a full inbox), a short script over `tools/dev/cdp.mjs` is fine.
- **Before and after**: to show a behaviour change, check out the merge base next to the branch
  (`git worktree add --detach .verify/<branch>/base <merge-base>`), build it, run the same probe on both,
  then `git worktree remove` it.
- The local Worker is fixed at port 8787. If another session holds it, test the server through the Worker
  tests and probes instead, and say so under "couldn't verify".

- If `check` or `verify` doesn't exist yet on this branch, run the pieces by hand: `npm run build`,
  `npm --prefix worker test`, `cd worker` then `npx tsc --noEmit -p .`; for pages and play, serve `dist/`
  and use `tools/dev/check_pages.mjs` and `tools/dev/play.mjs` (instructions at their tops); for art,
  `tools/pixelart/check_regions.py` or `tools/dev/check_prints.mjs`. Say in the note which you used.
- **Open the PNGs and look at them** with the Read tool. A green exit code says nothing about whether a
  head floats or a button is cut off. Compare new art with the old at the same scale.

## 3. Review on two axes

1. **Did it do what was asked?** Go through the brief line by line: done, partly done, not done, or done
   but something else changed too. Unasked-for changes are findings.
2. **Standards**: `docs/coding-standards.md` and the CLAUDE.md rules. Skip anything `check` already
   enforces.

For tests, look hard for tests that can't fail:
- **Tautological**: the expected value is worked out the same way the code works it out.
- **Reads source**: the test greps or imports a file as text to check it contains something.
- **Mocks our own modules** instead of D1, time or randomness.
For one changed rule, ask: if I broke this line, would a test fail? If it's cheap, try it and revert.

## 4. Keep only what you can show

Every finding needs evidence: a command and its output, a screenshot path, or a file and line with a
concrete input that goes wrong. "Might", "could consider" and style preferences without a rule behind them
are dropped. Try to disprove each finding before keeping it.

## 5. Fix or hand back

- **Small and clear** (a missed rule, a typo, a missing `textContent`, a test that can't fail, an
  unused leftover): fix it yourself, rerun what proves it, and commit all fixes as **one** commit,
  `Review: <what>`. Stage only the files you changed. On a dry run, don't commit: apply, test, save
  `git diff` as `.verify/<branch>/proposed-fix.diff`, then revert.
- A fix that settles only part of a finding leaves the rest open: say what's left.
- A change that alters what `docs/architecture.md` describes without updating it is a small finding: fix it.
- **Bigger, or a matter of taste or feel** (art choices, game feel, design, anything Luke and Orson
  decide): don't change it. It goes back to the implementer or to Luke.

## 6. Merge note and verdict

Use the `pr` skill to write `.verify/<branch>/merge-note.md`, with your findings, fixes and the pictures.
If the `pr` skill isn't there yet, write it yourself with: summary, before/after pictures, checks run,
door (two-way: code you can revert; one-way: a live migration, data fix, saved progress, coins or scores,
or the App Store), blast radius, and what couldn't be verified.

End your reply with:

```
Verdict: ready | needs work | needs Luke
Merge note: .verify/<branch>/merge-note.md
Fixed: <one line each, or none>
Open: <finding — evidence — who>   (one per line)
```

`ready` means no open findings. `needs work` means the implementer can fix them. `needs Luke` means a
question only Luke can answer (taste, a one-way door, anything going live).
