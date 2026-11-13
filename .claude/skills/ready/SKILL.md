---
name: ready
description: What a worker session runs when it thinks its branch is done - commit, merge test-all in, npm run check, the review skill (which writes the merge note), verify serve for test links, then one short hand-over message for the coordinator. Use when you're about to say "done", or when asked to get a branch "ready" or "ready to merge".
---

# Ready: hand a branch to the coordinator

"Done" means this skill has run and passed. Run each command on its own (the worktree guard refuses
`&&`, `;` and `$(...)`). Stop at the first step that fails and report it as `not ready`: never hand over
a branch that only passed some of the steps.

## 1. Commit

- `git status --short`. Stage only your own files by name (other sessions share the repo; never
  `git add -A`, never a bare `git stash`). Commit with a message that says what changed for the player.
- Note the branch: `git branch --show-current`.

## 2. Bring in test-all

- `git fetch -q origin` (fine if it fails offline: `test-all` is a local branch).
- `git merge test-all`. If it says "Already up to date", go on.
- **On a conflict, stop.** Run `git merge --abort`, then report `not ready: conflicts with test-all` with
  the files from `git diff --name-only --diff-filter=U` (run it before the abort). Don't resolve another
  session's work by guessing; the coordinator decides who owns the files.
- If `main` has commits that `test-all` doesn't (`git log --oneline test-all..origin/main`), say so in the
  report; the coordinator merges `main` into `test-all`, not you.

## 3. Check

- A worktree's `node_modules` can be missing or stale (the build then can't find `@fontsource/...`):
  run `npm ci` and `npm --prefix worker ci` first.
- `npm run check`. Every line must be `ok` (or `skip`/`warn`). On `FAIL`, fix it, commit, and go back to
  step 2. If `check` isn't on this branch yet (`npm error Missing script: "check"`), run the pieces by hand
  and say so: `npm run build`, `npm --prefix worker test`, and `cd worker` then `npx tsc --noEmit -p .`.

## 4. Review

- Run the `review` skill. It starts a fresh subagent (you never review your own work), which may commit
  small fixes, writes `.verify/<branch>/merge-note.md` via the `pr` skill, and ends with
  `Verdict: ready | needs work | needs Luke`.
- `needs work`: fix the findings, commit, and go back to step 2 (a new review each time).
- `needs Luke`: carry on to step 5 so Luke has links, and put the question in the report word for word.
- If the review skill isn't on this branch yet, say `review: not run (skill missing)`; the coordinator
  must review before merging.

## 5. Links

- `npm run verify -- serve`. It builds, starts the phone server on a free port and prints the localhost,
  Wi-Fi and Tailscale links. Leave it running. Give links to the pages this branch changed (for example
  `/games/shootaround/`, `/players/?base=buns`), not just the home page.
- Before verify exists: `npm run build`, pick a free port (`lsof -i :5174`, then 5176, 5177...), run
  `python3 tools/dev/lan_server.py <port> dist` in the background, and build the links from
  `ipconfig getifaddr en0` and, if Tailscale is up, `tailscale ip -4`. The game's `/api` calls need the
  local Worker on 8787 (CLAUDE.md, "Running it locally").

## 6. Hand over

End your turn with this, and nothing after it (the coordinator reads the first lines):

```
READY <branch> @ <short sha>
Verdict: ready | needs work | needs Luke | not ready (<step>: <why>)
Door: two-way | one-way (<why>)            <- from the merge note
Merge note: .verify/<branch>/merge-note.md
Links: <Tailscale link>  (Wi-Fi: <link>, here: <localhost link>)
Notes: <behind main? skipped steps? a question for Luke, word for word>
```

Don't merge into `test-all`, push, deploy or touch the live database: that's the coordinator's and Luke's.
