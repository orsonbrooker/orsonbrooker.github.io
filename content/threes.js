// The 3-point contest's racks, one for each of THREE_POINT_CONTEST.racks (shared/rules.js), shot in
// order from the right of the court art round to the left. Each is [angle from the hoop in degrees
// (90 is straight out from the hoop), metres past the 3-point line]: `spot` is where he shoots from,
// `rack` where the ball rack stands beside him. The court only has room behind the arc from about 58
// to 125 degrees, so the "corners" are really the wings.
export const RACK_LAYOUT = [
  { spot: [60, 0.25], rack: [52, 0.35] },
  { spot: [75, 0.25], rack: [67, 0.35] },
  { spot: [90, 0.25], rack: [98, 0.35] },
  { spot: [105, 0.25], rack: [113, 0.35] },
  { spot: [120, 0.25], rack: [128, 0.35] },
];

// The rack art (art/three-point-contest.md says what to draw). Until the files exist these are null
// and modes/threes.js draws simple placeholder racks. To wire the art in: put the files in
// assets/racks/, fill in the paths, and set `anchor` (the court pixel in each image that sits on the
// rack's floor point) and `balls` (where each ball sits on the rack image, first ball first).
export const RACK_ART = {
  rack: null, // e.g. "assets/racks/rack.webp": the empty rack, seen from the court's angle
  ball: null, // e.g. "assets/racks/ball.webp": one ball sitting on a rack
  moneyBall: null, // e.g. "assets/racks/money-ball.webp": the gold money ball on a rack
  anchor: [0, 0],
  balls: [],
};
