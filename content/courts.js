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
//   panels             (optional) the court as folding panels: a panels.json from tools/pixelart/iso_export.py, for
//                      the walls rising at the start of a game and Free play's half-folded walls (play/fold.js)
//   horseMap           the square of the court art HORSE's spot map shows, in court pixels (the floor round the hoop)
//   test               only reachable from ?debug (window.game.setCourt), never offered to players
//   contest            (optional) the 3-point contest's look on this court: its court image (the racks' shadows in
//                      the floor, no racks) and each rack in RACK_LAYOUT order, where its picture's top left goes
//                      and its picture with 0, 1, ... 5 balls left (modes/threes.js draws them)
//   scoreboard         (pixel-art courts) the wall scoreboard the game lights: where its prop stands on the hoop wall
//                      (foot: u and height, metres) and its face (art/iso/props/scoreboard/prop.json), drawn by
//                      engine/pixelboard.js. Courts without it use the old painted board (content/looks.js BOARD_ART)

import GYM_ART from "./courts/gym.js"; // the scoreboard and contest racks, from the bake (tools/pixelart/iso_export.py)

// The first gym, painted (until 2026): kept to compare against, from ?debug only.
const OLD_GYM = {
  id: "gym-old",
  name: "Gym (old art)",
  test: true,
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
  horseMap: { x: 214, y: 690, size: 1300 },
};

// The gym redrawn in Blender as pixel art at clean 2:1 (art/iso/gym/, docs/art/isometric.md): 1 m of floor round
// the court lines, the board 1.18 m off the wall, a smaller glass board (2.2 x 1.3 m) on the same rim. Its pixels
// are 5 court pixels, like the pixel-art players'.
// The contest racks' pictures (art/iso/props/rack/), one for each number of balls left.
const ballsLeft = (way) => [0, 1, 2, 3, 4, 5].map((n) => `assets/props/rack/rack-${way}-left-${n}.webp`);

const GYM = {
  id: "gym",
  name: "Gym",
  image: "assets/courts/gym/court.webp",
  hoopFront: "assets/courts/gym/hoop-front.webp",
  hoopFrontAt: { x: 760, y: 1005 },
  size: 2400,
  pxPerM: 146.9694,
  origin: { x: 1200, y: 1070 },
  eu: { x: -120, y: 60 },
  ev: { x: 120, y: 60 },
  room: { u: 9.5, v: 9.5 },
  rim: { at: { x: 845, y: 1014.24 }, height: 3.05, radius: 0.45, tube: 0.035 },
  board: { rimOut: 0.62, u0: 3.65, u1: 5.85, z0: 2.85, z1: 4.15 },
  threePointLine: OLD_GYM.threePointLine,
  defaultSpot: { u: 4.6, v: 5.27 },
  physics: { gravity: 9.81, wind: null },
  horseMap: { x: 240, y: 760, size: 1600 },
  panels: "assets/courts/gym/panels.json", // its folding panels (play/fold.js, tools/pixelart/iso_export.py)
  contest: {
    image: "assets/courts/gym/contest.webp",
    racks: GYM_ART.racks.map((r) => ({ at: r.at, images: ballsLeft(r.way) })),
  },
  scoreboard: GYM_ART.scoreboard,
  // LED screens (engine/ledboard.js): the announcer's calls along the top of the hoop wall, and "Tap to play"
  // flashing on the shut box's front left wall, under the billboard
  led: { plane: "hoop", u: [7.9, 0.35], z: [5.0, 6.15], out: 0.122 },
  titleLed: { plane: "side", at: 9.8, v: [2.9, 9.5], z: [4.85, 5.95] },
};

export const COURTS = {
  gym: GYM,
  "gym-old": OLD_GYM,
  // Test courts: the same gym, to try the physics settings before there's art for a new court.
  "gym-low-gravity": { ...GYM, id: "gym-low-gravity", name: "Gym (low gravity)", test: true, physics: { gravity: 3.7, wind: null } },
  "gym-windy": { ...GYM, id: "gym-windy", name: "Gym (windy)", test: true, physics: { gravity: 9.81, wind: { u: 1.5, v: 0 } } },
};

export const DEFAULT_COURT = "gym";
