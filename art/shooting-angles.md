# Shooting from other angles: player art brief

Every player has one set of shooting poses: back to the camera, facing up and to the left, at the hoop.
That's right from the middle of the floor, but from the corners the hoop is somewhere else. From the
right corner it's straight up the screen, and from the left corner it's off to his left. He then looks
like he's shooting away from it. The game keeps its random spots in front of the hoop for this reason.
More shooting angles would let any mode use the corners (the 3-point contest, HORSE, the arena court in
`art/arena-court.md`).

## What to draw

Two new sheets per player, each on the same template as now (`art/character-template.png`: 16:9, 7 x 2
poses, same backdrop, same floor line, same size and placement), so `tools/build_character.py` builds them
the same way. Same 14 poses in the same order. Poses 1-2 (stand, facing the camera) can be copied from the
player's normal sheet.

| Sheet | Facing | Used from |
|---|---|---|
| `<id>-left.jpg` | Side-on, **facing left** (his left shoulder to the camera, we see his right side and the side of his face) | the left corner and left baseline (hoop to his left) |
| `<id>-up.jpg` | Back to the camera, **facing straight up the screen**, a little to the right | the right corner and right baseline (hoop above him) |

Poses 3-14 in each: turn, dribble (low, up, hand, down), crouch, jump, jump top, release, land, as
now. Only the direction changes: the ball goes up from the side nearest the hoop, and the release follows
through towards it.

Notes:
- **Keep the jump the same height and timing.** The game times the jump from the frames, so the poses
  have to line up pose for pose with the normal sheet (pose 12 is the top of the jump in all three).
- **Release point.** Pose 13 is where the ball leaves his hands; the build tool measures it. Keep the ball
  clearly at the hand in pose 12/13 so it can.
- **Builder bodies:** the 10 bodies in `art/characters/bases/` need the same two sheets, drawn in the
  same flat colours as their normal sheets, so their colour regions (skin, hair, jersey, team colour,
  shoes) can be found. The jersey number is placed by the game, so leave the back of the jersey plain as now.
- **Orson:** his sprites come from video, so he needs either two short videos (shooting from the left
  corner and the right corner, filmed from the same height and angle as before) or drawn sheets in his look.

## Could mirroring do one of them?

Flipping the normal sheet left-to-right makes him face up and to the right, close to the "up" sheet. For
builder bodies that might be enough, because their number is drawn by the game and wouldn't come out
backwards. Players with the number drawn into their art (Jethro, Orson) would show it backwards. Worth a
quick test before drawing the "up" sheets.

## Start small

Draw both sheets for one builder body first. Once it's in, the game picks the sheet from the angle to the
hoop (corners and baselines use the side sheets), and it can be checked in `?debug` before anyone else
gets drawn.
