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
  when anything runs each frame. Feel changes also get a replay of the same seed before and after.
- If something couldn't be checked (the iOS app, Turnstile, a real phone), say so plainly.

## Phone first

- Nothing new steals Space or a tap from the shot. The ball and player are never cropped.
- Works one-handed on a phone held upright; text is readable without zooming.

## Game code

- **The game is a simulation with a picture on top.** Anything that can change a score (spots, aim wobble,
  the green zone, ball flight, timers) runs in the fixed physics step, in metres and seconds, and takes its
  randomness from the seeded streams (`random(stream)` in `play/state.js`). Effects, sounds and which
  announcer line plays use `Math.random` and never feed back into play. The same seed and input must give
  the same game (`window.game.setSeed`), or replays break and the server can't check scores.
- New gameplay randomness gets its own stream. Adding draws to an existing stream changes every game
  after that point.
- Nothing depends on frame rate: a 30 Hz phone and a 120 Hz iPad play the same game. Pixels appear only
  when drawing.
- Phases change only through the `PHASES` table (`setPhase`, `canShoot`); see Gotchas in `CLAUDE.md`.
- **Feel numbers are named, with units**, near the top of their file or in `content/`: never a bare
  `0.29` in the middle of a function. Changing one (a timing window, green size, gravity) changes how
  the game feels and whether old scores compare, so it's for Luke and Orson: give the before and after
  numbers in the commit, and think about `FEATURE_FROM` and the leaderboard.
- **Input** answers on the frame it arrives. Timing is measured from the input event, not the next frame.
  Touch, mouse and Space all work; a second finger, a cancelled touch or a key held down never fires twice.
- **Every action gets feedback** within about a tenth of a second: a sound, a pose, a flash.
- **Juice serves play.** Shake, flashes and confetti never hide the ball, the green or the score; they
  calm down under reduced motion; nothing flashes more than three times a second.
- **Crisp pixels**: sprites drawn at whole-pixel positions and whole-number scales with smoothing off.
  Don't rotate or stretch pixel art unless the art is drawn for it.
- **Loading** happens before play. Nothing loads or decodes an image mid-game; a missing file falls back
  instead of breaking the game.
- **Frame budget**: nothing new allocates, builds strings or reads image data inside the frame loop. Do
  it once and keep it. The builder preview stays smooth while recolouring. A frame-time number that gets
  worse needs a reason.
- The game pauses when the tab or app goes to the background and resumes cleanly. Sounds start only
  after a tap, and the same sound never piles up on itself.

## Made for kids

- Losing is quick and friendly, and "again" is one tap away. Difficulty ramps gently; the first game
  should feel like a win.
- Coins, gear and the shop reward playing. No timers that pressure, no streaks that guilt, no tricks to
  keep a kid playing, nothing that looks like it costs real money.
- What's saved on a kid's device (coins, gear, players, daily progress) is precious: a change must read
  old saves and never wipe them. That's a one-way door in the merge note.
- A player's attributes stay neutral until Luke and Orson set them: the leaderboard compares everyone.

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
