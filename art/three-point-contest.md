# 3-point contest: rack art brief

The 3-point contest (`modes/threes.js`) is built and playable in `?debug`, with plain placeholder racks
drawn in code. It stays hidden from players until these images exist. This is what's needed.

## What to draw

All pixel art in the court's style, lit the same way (light from the upper left, like `assets/court.webp`),
seen from the court's isometric angle, on a transparent background, saved as `.webp`.

| File | What | Size (court pixels) |
|---|---|---|
| `assets/racks/rack.webp` | An empty ball rack standing on the floor: a low two-tier or one-tier metal rack with five cradles in a row, like the NBA's. | about 190 x 150 |
| `assets/racks/ball.webp` | One normal ball sitting in a cradle, drawn once and placed five times. | about 46 x 46 |
| `assets/racks/money-ball.webp` | The gold money ball (red, white and blue in the NBA; here gold to match the game's money ball, `content/looks.js` `BALL_LOOKS[MONEY]`), sitting in a cradle. | about 46 x 46 |

Notes:
- **Separate balls, not rack states.** The game takes a ball off the rack for each shot (front first,
  the money ball last), so it needs the empty rack plus single balls rather than "full / 3 left / empty"
  pictures. A sheet of finished racks would also work, but needs six pictures per rack.
- **Scale.** The court is 2048 x 2048 and 1 metre is about 132 px tall and about 130 px along the floor
  (the floor axes: 1 m along the hoop wall is (-115, +64) px, 1 m out from it is (+114, +66) px). A real
  rack is about 1.3 m long and 0.9 m tall, so roughly 190 px wide and 150 px tall in the art. A ball on the
  rack is drawn smaller than the ball in flight (that one is about 80 px across) so the rack
  reads at a glance; 40-46 px is about right.
- **Angle.** The rack runs along the hoop wall (the `u` axis), so its long side goes from lower right to
  upper left, sloping like the baseline in the court art. One rack image works for all five places.
- **The money ball's rack.** Every rack has one money ball (its last ball), so no separate "money rack"
  is needed. If you'd like the NBA's all-money rack later, that's a rule change in `shared/rules.js`.

## Where the racks stand

Five places round the 3-point arc like the real contest (`content/threes.js` `RACK_LAYOUT`): corner,
wing, top of the key, wing, corner, shot in order from right to left in the court art. Each rack stands
beside its shooting spot (in the corners, on the side towards the middle of the floor). Floor points in
court pixels:

| Rack | Shooting spot | Rack's floor point |
|---|---|---|
| 1 (right corner) | (282, 1476) | (347, 1523) |
| 2 (right wing) | (675, 1628) | (569, 1618) |
| 3 (top of the key) | (1210, 1537) | (1295, 1490) |
| 4 (left wing) | (1374, 1236) | (1361, 1176) |
| 5 (left corner) | (1119, 1010) | (1203, 1048) |

Rack 5 stands near the back wall under the bench, so it's drawn partly behind the player; rack 1 is
near the front edge of the floor. The places can be moved by editing `RACK_LAYOUT` (degrees round the
hoop, metres past the line).

## Wiring it in (a small step)

1. Put the three files in `assets/racks/`.
2. In `content/threes.js` `RACK_ART`, fill in the three paths, `anchor` (the pixel in `rack.webp` that
   stands on the rack's floor point: usually the middle of its bottom edge) and `balls` (the top-left
   pixel in `rack.webp` where each of the five balls goes, first ball taken first, the money ball last).
   `modes/threes.js` `drawRack` then draws the images instead of the placeholder.
3. In `modes/index.js` set `THREE_POINT_CONTEST_READY = true`: the card on "Choose a game", the
   leaderboard tab and the help paragraph appear for everyone.
4. Check it at phone width in `?debug`, then go live (its `FEATURE_FROM` date in `worker/src/scores.ts`
   becomes the go-live time).
