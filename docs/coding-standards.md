# Coding standards

These are the judgement calls a reviewer checks by reading and looking. Anything a machine can check
belongs in `npm run check` instead, not here. The hard rules are in `CLAUDE.md`: read its **Rules**,
**Security** and the Kids and Look-and-feel lines there; this page doesn't repeat them.

## Done means looked at

- Say what you looked at, not just what you ran. A passing exit code isn't evidence that it looks right.
- **Art** isn't done without a contact sheet of every move, frame and side (`verify art`), on green and on
  clashing colours, next to the reference or the old art at the same scale. Check for floating or jumping
  heads, sizes that change between neighbouring frames, holes, wrong-coloured parts and a ball off the hand.
- **UI** isn't done without phone and iPad screenshots (`verify pages`). Check the full height is used,
  nothing is cut off, there's no sideways scroll and taps are big enough.
- **Game** changes aren't done without playing every mode they touch (`verify play`), and `verify perf`
  when anything runs each frame.
- If something couldn't be checked (the iOS app, Turnstile, a real phone), say so plainly.

## Phone first

- Nothing new steals Space or a tap from the shot. The ball and player are never cropped.
- Works one-handed on a phone held upright; text is readable without zooming.

## Performance

- Nothing new allocates, builds strings or reads image data inside the frame loop. Do it once and keep it.
- The builder preview stays smooth while recolouring. A frame-time number that gets worse needs a reason.

## Tests

- Test behaviour through the module's interface: what goes in and what comes out.
- The expected value must come from somewhere other than the code under test: a worked example, the rule
  as written, a real past game. A test that recomputes the answer the same way the code does is a tautology
  and proves nothing.
- Never test by reading source files as text.
- Mock only the edges we don't own: D1 (use the fake built from the real migrations), time and randomness.
  Don't mock our own modules.
- A bug fix comes with a test that fails without the fix.

## Shape of the code

- Prefer adding to a small, existing interface over a new big file. Data belongs in `content/`, rules in
  `shared/rules.js`.
- Copy what the nearby code does, unless the nearby code is the problem; then say so.
- Delete what the change made unused. No commented-out code, no "old" copies.
- Names say what a thing is for a reader who hasn't seen this session.

## Commits

- One topic per commit, with a message that says what changed for the player, in plain English.
- No "fix the fix" commits on a branch that hasn't merged: fold them in.
- Stage only your own files. Never secrets, never `notes/`.

## When fixing a bug

Get a way to see it fail first (a test, a seed in `?debug`, a screenshot), then fix it, then show it passing.
