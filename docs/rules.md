# Rules and what enforces them

Every house rule, and the thing that catches it when it's broken. A rule a machine checks beats a rule
someone has to remember, so the `retro` skill keeps this table up to date: a repeated correction becomes a
new row, and a row marked **nothing yet** is the next thing to automate.

Enforcers:
- `check`: `npm run check` (`tools/dev/check.mjs`), the build, Worker tests, types and house-rule greps.
- test: a test in `worker/test/`, run by `npm --prefix worker test` (and by `check`).
- `verify`: `npm run verify <pages|play|perf|art>`, screenshots and numbers in `.verify/<branch>/`.
- `review`: the `review` skill, a fresh reviewer using `docs/coding-standards.md`.
- `ready`: the `ready` skill a worker runs before handing a branch over.

| Rule (details in `CLAUDE.md`) | Enforced by |
|---|---|
| Nothing goes live (push `main`, deploy, live DB write) without Luke saying so | nothing yet (the `go-live` skill asks first) |
| Deploy only committed code | nothing yet |
| Pixel icons, never emoji | `check` |
| Styled dialogs (`ui/confirm.js`), never `alert`/`confirm`/`prompt` | `check` |
| Typed text reaches the page only through `textContent`; `innerHTML` only with constants or `icon()` | `check` (new uses), `review` |
| Every value in SQL is bound | `review` |
| New card or leaderboard features count only from launch (`FEATURE_FROM`) | `check`, test (`card.test.ts`) |
| Scoring rules live once, in `shared/rules.js` | test (`rules`, `scoring`), `review` |
| Every he/his/him announcer line has a she version | test (`pronoun.test.ts`) |
| Every announcer line has a recorded clip | `check` |
| Secrets files are never committed | `check` |
| Cheap-to-call writes have a per-IP limit (and Turnstile where kids type) | `review` |
| Rude-word filter on anything typed; nicknames, not real names | `review` |
| Art is looked at: every move and side, on green and clashing colours, beside the reference | `verify art`, `review` |
| Phone first: no sideways scroll, big enough tap targets, uses the height | `verify pages` |
| Smooth on a phone: no frame-time or size regressions | `verify perf` |
| "Done" means tested, with a link to try it | `ready` (`verify serve`) |
| Branch is up to date with `test-all` before hand-off | `ready`, session-start hook (`tools/dev/behind.sh`) |
| Stage and commit only your own files; work in a worktree | nothing yet |
| New packages pinned to exact versions; Actions pinned to commits | `review` |
| Respect reduced motion | `review` |
