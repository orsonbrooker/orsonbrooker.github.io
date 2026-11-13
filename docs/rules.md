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
- `iso_eval`: `tools/pixelart/iso_eval.py`, scoring isometric art (courts, props) against `docs/art/isometric.md`;
  `--testset` (run by `check`) fails when an approved reference gets worse than `art/iso/baseline.json`.
- Luke's scores: what no check can measure, scored by Luke in `art/iso/scores.md`.

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
| Isometric art: one camera, clean 2:1 floor lines (`docs/art/isometric.md`; the gym is the old 0.566 camera until redrawn) | `iso_eval` (lines, court data) |
| Isometric art: art pixels a whole number of court px (5), the same everywhere, players' pixels the same size | `iso_eval` (pixel size, one size, players' pixels) |
| Isometric art: axes match the camera (up 1.095x the floor metre at 2:1); markings where `content/courts.js` says | `iso_eval` (one scale, 3-point line) |
| Courts: 1.5 m clear floor beside the 3-point arc, 2.5 m behind it, every contest rack (1.5 x 0.6 m) on the floor | `iso_eval` (room beside, room behind, racks fit) |
| Courts are folding panels (floor, two walls, hoop, each prop), handed over as `assets/courts/<id>/` with `panels.json` (hinge lines, drawing order), hinges on the 2:1 grid | `iso_eval --panels` (present, handed over, grid, size, hinges closed, props on panels, add up) |
| Isometric art: light from the upper left | `iso_eval` (courts' walls), Luke's scores (props) |
| Isometric art: on the palette (`art/iso/palette.json`), at most 64 colours, hue-shifted ramps | `iso_eval` (palette, colours, ramps) |
| Isometric art: outlines one pixel wide, coloured not black, no doubled corners | `iso_eval` |
| Isometric art: outlines only round the outside and where depth changes | Luke's scores |
| Isometric art: one grid, overlays on it, no mixed pixel sizes, no blur, no stray pixels, hard edges on props | `iso_eval` |
| Isometric art reads on a phone, matches the players, feels like Shootaround, is kid-safe | Luke's scores (`art/iso/scores.md`) |
