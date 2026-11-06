---
name: go-live
description: Put a tested change from a worktree live on orsonbrooker.com - live database migration, Worker deploy, push to main, wait for GitHub Pages, verify, tidy up. Use only after Luke has said to go live / push / deploy for this change.
---

# Going live

Only run this after Luke has approved going live with **this** change. If anything fails part way,
stop and say exactly what is and isn't live.

## Before

1. Everything is committed in the worktree (`git status --short` is empty). The pre-commit hook has
   stamped versions; if a new JS module or page was added, check it's in `tools/stamp_versions.py` and its
   imports carry a `?v=` hash.
2. `git fetch -q origin`. If `main` moved (`git log --oneline HEAD..origin/main`), look at what changed
   (`git show --stat <sha>`), then `git rebase origin/main`. If someone else changed `worker/`, their change
   will ship with yours when you deploy: say so before deploying.
3. If the Worker changed, type-check it: `cd worker && npx tsc --noEmit -p .`

## In order

1. **Database** (only if there's a new file in `worker/migrations/` or a data change Luke approved):
   `cd worker && npx cf d1 migrations apply 67713a08-4e9f-46b0-874f-bbf9ccf05c4c`
2. **Worker** (only if `worker/` changed), from the committed tree:
   `cd worker && npx cf deploy --secrets-file /Users/lukebrooker/Code/orsonbrooker.github.io/worker/.secrets.json`
   On "no healthy upstream" or other 5xx, Cloudflare is having trouble: wait and run the same command again.
   Never loop retries while the working tree might change.
3. **Site:** `git merge-base --is-ancestor origin/main HEAD && git push -q origin HEAD:main`
4. **Wait for Pages:** `sh tools/dev/wait_pages.sh $(git rev-parse --short HEAD)` (run the two commands
   separately in a worktree). Don't fetch live files before it says `built`.

## Check

- The live page carries the new stamp: `curl -s https://orsonbrooker.com/games/shootaround/ | grep -o 'game.js?v=[0-9a-f]*'`
  matches the worktree's `games/shootaround/index.html`.
- A changed file's live bytes match: `curl -s "https://orsonbrooker.com/<file>?v=<hash>" | shasum` vs local.
- API answers: `curl -s -o /dev/null -w "%{http_code}" "https://orsonbrooker.com/api/scores?range=week&mode=timed"`
  is 200, and `/admin` redirects (302) to Cloudflare Access sign-in.
- If a stamped URL serves old content, purge it:
  `npx cf cache purge -z orsonbrooker.com --force --body '{"files":["<url>"]}'`

## After

1. `git fetch -q origin && git merge-base --is-ancestor HEAD origin/main` (the work is on main), then stop
   any local servers you started and remove the worktree (ExitWorktree remove).
2. Copy any new voice clips back: `rsync -a .voice-cache/ /Users/lukebrooker/Code/orsonbrooker.github.io/.voice-cache/`
   (before removing the worktree).
3. Tell Luke what's live, what you checked, and to run `git pull` in the main checkout.
