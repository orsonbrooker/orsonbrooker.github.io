# Arena court: art brief

A second court with more floor round the outside, first for the 3-point contest. The corner racks then
stand at the true corners with room beside them. The gym (`assets/court.webp`) stays as it is for the
other modes. Courts are data (`content/courts.js`), so once the art exists it becomes one new entry there.

## The picture

- **One square image, 2048 x 2048, pixel art in the gym's style**, saved as `assets/arena/court.webp`.
  Draw it on the same palette and lighting as the gym (light from the upper left).
- **Same camera as the gym.** Same isometric angle: the floor's two directions slope the same way as the
  gym's. In the gym, 1 m along the hoop wall goes (-115, +64) px and 1 m out from it goes (+114, +66) px.
  Keep the hoop on the left wall, the open side of the floor towards the viewer, and the room as a cut-away
  box like the gym.
- **A bigger floor, so things get a little smaller.** The gym's floor is 8.2 m along the hoop wall and
  8.25 m out from it. The arena wants about **10.5 m along the hoop wall and 9 m out**, which makes the
  players, ball and hoop about 15% smaller on screen. Going much bigger makes them too small on a phone.
  If it helps the drawing, scale everything evenly: the game measures it afterwards.
- **The hoop:** centred along the left wall, rim 3.05 m up and about 0.6 m out from a backboard on the wall,
  like the gym's. Also draw **the front half of the rim and the net on their own**, transparent elsewhere,
  as `assets/arena/hoop-front.webp`. The game draws this over a ball dropping through the hoop. Look at
  `assets/hoop-front.webp` for how the gym does it.

## The floor markings

- **The same key, free throw line and 3-point arc as the gym**, the same size and shape, so a shot from a
  spot is as hard in both places and the contest's scores stay comparable. The arc's distance from the
  hoop, every 10 degrees from one baseline round to the other, is in `content/courts.js` (`threePointLine`).
- **At least 1.5 m of floor between each corner of the arc and the edge of the floor**, and about 2.5 m behind
  the top of the arc. That's room for a player plus a rack beside him in each corner (the racks are separate
  images, see `art/three-point-contest.md`).
- Plain floor where the racks stand: no logos or markings under the five rack points (they're worked out
  again for the arena once the art is in).

## Around the outside (the fun part)

The arena is a bigger, louder place than the school gym. Ideas, all optional:

- Low stands or bleachers along the back wall with a pixel crowd (no real faces or names).
- Banners and pennants (made-up team names only, no real teams or brands).
- A big scoreboard high on the back wall, like the gym's. The game draws the score digits over it, so leave
  two clear dark panels on it, as on the gym's (`content/looks.js` has the gym's digit art).
- Spotlights or a lit-up floor edge, to make it feel like an event.

Keep the floor itself uncluttered: anything on the floor near the arc can be hidden behind the player.

## What happens when it's in

1. Measure the new court (where the floor's corner is, the floor directions, the rim, the arc) and add
   an `arena` entry to `content/courts.js`. Try it in `?debug` with `window.game.setCourt("arena")`.
2. Move the contest's racks out to the true corners (`content/threes.js` `RACK_LAYOUT`) and use the arena
   for the contest.
3. Check it at phone width: if the players read too small, crop the image tighter.
