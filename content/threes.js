// The 3-point contest's racks, one for each of THREE_POINT_CONTEST.racks (shared/rules.js), shot in
// order like the real contest: corner, wing, top of the key, wing, corner, from the right of the court
// art round to the left. Each is [angle from the hoop in degrees (90 is straight out from the hoop,
// 0 and 180 along the hoop wall), metres past the 3-point line]: `spot` is where he shoots from,
// `rack` where the ball rack stands beside him (towards the middle of the floor in the corners).
export const RACK_LAYOUT = [
  { spot: [12, 0.25], rack: [21, 0.35] }, // corner
  { spot: [50, 0.25], rack: [42, 0.35] }, // wing
  { spot: [90, 0.25], rack: [98, 0.35] }, // top of the key
  { spot: [130, 0.25], rack: [138, 0.35] }, // wing
  { spot: [168, 0.25], rack: [159, 0.35] }, // corner
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
