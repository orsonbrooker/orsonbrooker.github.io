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
//   horseMap           the square of the court art HORSE's spot map shows, in court pixels (the floor round the hoop)
//   test               only reachable from ?debug (window.game.setCourt), never offered to players
//   contest            (optional) the 3-point contest's look on this court: its court image (the racks' shadows in
//                      the floor, no racks) and each rack in RACK_LAYOUT order, where its picture's top left goes
//                      and its picture with 0, 1, ... 5 balls left (modes/threes.js draws them)
//   scoreboard         (pixel-art courts) the wall scoreboard the game lights: where its prop stands on the hoop wall
//                      (foot: u and height, metres) and its face (art/iso/props/scoreboard/prop.json), drawn by
//                      engine/pixelboard.js. Courts without it use the old painted board (content/looks.js BOARD_ART)

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
  contest: {
    image: "assets/courts/gym/contest.webp",
    racks: [
      { at: [410, 1350], images: ballsLeft("rot-0") }, // rack 1
      { at: [760, 1470], images: ballsLeft("rot-42") }, // rack 2
      { at: [1100, 1445], images: ballsLeft("rot-98") }, // rack 3
      { at: [1075, 1315], images: ballsLeft("rot-138") }, // rack 4
      { at: [830, 1140], images: ballsLeft("rot-180") }, // rack 5
    ],
  },
  scoreboard: { foot: [1.85, 3.4021], face: {"start": [1.5416666666666667, 0.06804138174397717], "out": 0.122, "size": [74, 32], "segments": {"a": [0, 13, 8, 15], "g": [0, 6, 8, 8], "d": [0, 0, 8, 2], "f": [0, 7, 2, 15], "b": [6, 7, 8, 15], "e": [0, 0, 2, 7], "c": [6, 0, 8, 7]}, "digit": [8, 15], "windows": [{"id": "score", "window": [3, 3, 35, 22], "cells": [[5, 5], [15, 5], [25, 5]]}, {"id": "time", "window": [39, 3, 71, 22], "cells": [[41, 5], [51, 5], [61, 5]]}], "labelGap": 2, "colours": {"face": "#403751", "window": "#180826", "unlit": "#532837", "lit": "#d0553c", "label": "#e9ccbb"}} },
};

export const COURTS = {
  gym: GYM,
  "gym-old": OLD_GYM,
  // Test courts: the same gym, to try the physics settings before there's art for a new court.
  "gym-low-gravity": { ...GYM, id: "gym-low-gravity", name: "Gym (low gravity)", test: true, physics: { gravity: 3.7, wind: null } },
  "gym-windy": { ...GYM, id: "gym-windy", name: "Gym (windy)", test: true, physics: { gravity: 9.81, wind: { u: 1.5, v: 0 } } },
};

export const DEFAULT_COURT = "gym";
