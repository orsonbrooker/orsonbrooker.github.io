// The courts: each one is its art plus where things are in it and how the ball behaves there. A new
// court is a new entry here (and its two images in assets/); engine/court.js and engine/physics.js
// read the one being played (play/court.js switches it).
//
// Positions on the art are in "court pixels" (the square court image, `size` px across). Court
// space is metres: u runs along the left wall (the hoop wall), v runs out from it, z is height.
//
//   image, hoopFront   the court art, and the front of the hoop drawn over the ball as it drops in
//   hoopFrontAt        where the top-left of hoopFront goes on the court art
//   size, pxPerM       the art's size, and court pixels per metre of height
//   origin, eu, ev     the back corner of the floor on the art, and one metre along u and along v
//   room               how far the floor goes along u and v (past it the ball drops away)
//   rim                where the centre of the rim is on the art (at), its height, radius (to the
//                      centre of the tube) and tube thickness, in metres
//   board              the backboard: how far in front of the wall the rim sticks out (rimOut, so the
//                      board is that far behind the rim), its left and right (u0, u1) and bottom and top (z0, z1)
//   threePointLine     distance from the hoop to the painted 3-point line every 10 degrees, from along
//                      the baseline (0) round to the other baseline (180)
//   defaultSpot        where he stands when nothing else says
//   physics            gravity (m/s/s, down) and wind (optional: { u, v } in m/s/s, pushing the ball
//                      along the floor's directions while it's in the air)
//   test               only reachable from ?debug (window.game.setCourt), never offered to players

const GYM = {
  id: "gym",
  name: "Gym",
  image: "assets/court.webp",
  hoopFront: "assets/hoop-front.webp",
  hoopFrontAt: { x: 515, y: 735 },
  size: 2048,
  pxPerM: 132,
  origin: { x: 1024, y: 816 },
  eu: { x: -115.3, y: 64.2 },
  ev: { x: 114.4, y: 65.8 },
  room: { u: 8.2, v: 8.25 },
  rim: { at: { x: 611, y: 790 }, height: 3.05, radius: 0.45, tube: 0.035 },
  board: { rimOut: 0.62, u0: 3.35, u1: 6.4, z0: 2.85, z1: 5.0 },
  // The painted arc is not a circle.
  threePointLine: [3.1, 3.17, 3.33, 3.6, 3.98, 4.25, 4.48, 4.65, 4.73, 4.74, 4.68, 4.59, 4.46, 4.22, 3.97, 3.67, 3.35, 3.19, 3.1],
  defaultSpot: { u: 4.6, v: 4.6 },
  physics: { gravity: 9.81, wind: null },
};

export const COURTS = {
  gym: GYM,
  // Test courts: the same gym, to try the physics settings before there's art for a new court.
  "gym-low-gravity": { ...GYM, id: "gym-low-gravity", name: "Gym (low gravity)", test: true, physics: { gravity: 3.7, wind: null } },
  "gym-windy": { ...GYM, id: "gym-windy", name: "Gym (windy)", test: true, physics: { gravity: 9.81, wind: { u: 1.5, v: 0 } } },
};

export const DEFAULT_COURT = "gym";
