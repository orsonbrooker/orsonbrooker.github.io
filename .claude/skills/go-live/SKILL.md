---
name: go-live
description: Put a tested change from a worktree live on orsonbrooker.com - live database migration, Worker deploy, push to main, wait for GitHub Pages, verify, tidy up. Use only after Luke has said to go live / push / deploy for this change.
---

# Going live

Only run this after Luke has approved going live with **this** change. If anything fails part way,
stop and say exactly what is and isn't live.

## Before

1. Everything is committed in the worktree (`git status --short` is empty), and `npm run build` succeeds
   (a new page must be in `PAGES` in `vite.config.js`, a new runtime file in `STATIC`). Serve `dist/` and run
   `node tools/dev/check_pages.mjs` (no errors on any page) and, for game changes, `node tools/dev/play.mjs`
   against the local Worker (see CLAUDE.md).
2. `git fetch -q origin`. If `main` moved (`git log --oneline HEAD..origin/main`), look at what changed
   (`git show --stat <sha>`), then `git rebase origin/main`. If someone else changed `worker/`, their change
   will ship with yours when you deploy: say so before deploying.
3. If the Worker or `shared/` changed, type-check and test it: `cd worker && npx tsc --noEmit -p .` and
   `npm --prefix worker test`.

## In order

1. **Database** (only if there's a new file in `worker/migrations/` or a data change Luke approved):
   `cd worker && npx cf d1 migrations apply 67713a08-4e9f-46b0-874f-bbf9ccf05c4c`
2. **Worker** (only if `worker/` changed), from the committed tree:
   `cd worker && npx cf deploy --secrets-file /Users/lukebrooker/Code/orsonbrooker.github.io/worker/.secrets.json`
   On "no healthy upstream" or other 5xx, Cloudflare is having trouble: wait and run the same command again.
   Never loop retries while the working tree might change.
3. **Site:** `git merge-base --is-ancestor origin/main HEAD && git push -q origin HEAD:main`. GitHub Actions
   builds and publishes it (the Pages workflow).
4. **Wait for the deploy:** `git rev-parse --short HEAD`, then `sh tools/dev/wait_pages.sh <sha>` (separate
   commands in a worktree). Don't fetch live files before it says `success`; if it says `failed`, look at
   the run (`gh run view <id> --log-failed`) and fix forward.

## Check

- The live page links the new build: the hashed `build/…js` names in
  `curl -s https://orsonbrooker.com/games/shootaround/` match the worktree's `dist/games/shootaround/index.html`
  after `npm run build` (and the other pages you changed likewise).
- The game's version is the commit: it's in the live bundle (`curl -s https://orsonbrooker.com/build/<shootaround file>.js | grep -c <sha>`).
- API answers: `curl -s -o /dev/null -w "%{http_code}" "https://orsonbrooker.com/api/scores?range=week&mode=timed"`
  is 200, `curl -s -X POST https://orsonbrooker.com/api/games` returns a token, and `/admin` redirects (302) to
  Cloudflare Access sign-in.
- If a page still looks old (pages and `assets/` keep their names and Cloudflare caches for 4 hours), purge
  it from `worker/`: `npx cf cache purge -z orsonbrooker.com --force --body '{"files":["<url>"]}'`

## After

1. `git fetch -q origin && git merge-base --is-ancestor HEAD origin/main` (the work is on main), then stop
   any local servers you started and remove the worktree (ExitWorktree remove).
2. Copy any new voice clips back: `rsync -a .voice-cache/ /Users/lukebrooker/Code/orsonbrooker.github.io/.voice-cache/`
   (before removing the worktree).
3. Tell Luke what's live, what you checked, and to run `git pull` in the main checkout.
