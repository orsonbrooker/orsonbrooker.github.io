// The court: where things are in court space (metres) and how that maps onto the court art.
//
// The ball is simulated in 3D court space (metres) and projected onto the isometric court art.
// Screen units are "court pixels": the 2048px court image. u runs along the left wall (the hoop
// wall), v runs out from it, z is height.

export const COURT_PX = 2048;
export const PX_PER_M = 132;
const ORIGIN = { x: 1024, y: 816 }; // back corner of the floor
export const EU = { x: -115.3, y: 64.2 }; // +1m along the left wall (the hoop wall)
export const EV = { x: 114.4, y: 65.8 }; // +1m out from the left wall
export const ROOM_U = 8.2;
export const ROOM_V = 8.25;

export const BALL_R = 0.23;
const RIM_H = 3.05;
export const RIM_R = 0.45; // to the centre of the rim tube
export const RIM_TUBE = 0.035;
export const RIM = { ...unprojectFloor(611, 790 + RIM_H * PX_PER_M), z: RIM_H };
export const BOARD = { v: RIM.v - 0.62, u0: 3.35, u1: 6.4, z0: 2.85, z1: 5.0 };
// Distance from the hoop to the 3-point line painted in the court art, every 10 degrees
// from along the baseline (0) round to the other baseline (180). The painted arc is not a circle.
const THREE_POINT_LINE = [3.1, 3.17, 3.33, 3.6, 3.98, 4.25, 4.48, 4.65, 4.73, 4.74, 4.68, 4.59, 4.46, 4.22, 3.97, 3.67, 3.35, 3.19, 3.1];
export const LINE_CLEARANCE = 0.25; // keep spots this far off the line so it's clear which side he's on
const THREE_POINT_SHARE = 0.35;
export const HOOP_FRONT_AT = { x: 515, y: 735 };
export const DEFAULT_SPOT = { u: 4.6, v: 4.6 };

export function project(u, v, z = 0) {
  return {
    x: ORIGIN.x + u * EU.x + v * EV.x,
    y: ORIGIN.y + u * EU.y + v * EV.y - z * PX_PER_M,
  };
}

export function unprojectFloor(x, y) {
  const dx = x - ORIGIN.x;
  const dy = y - ORIGIN.y;
  const det = EU.x * EV.y - EV.x * EU.y;
  return { u: (dx * EV.y - EV.x * dy) / det, v: (EU.x * dy - dx * EU.y) / det };
}

function spotDistance(u, v) {
  return Math.hypot(u - RIM.u, v - RIM.v);
}

export function threePointRadius(u, v) {
  const deg = Math.max(0, Math.min(180, (Math.atan2(v - RIM.v, u - RIM.u) * 180) / Math.PI));
  const i = Math.min(THREE_POINT_LINE.length - 2, Math.floor(deg / 10));
  const f = deg / 10 - i;
  return THREE_POINT_LINE[i] * (1 - f) + THREE_POINT_LINE[i + 1] * f;
}

export function isThreePointSpot(u, v) {
  return spotDistance(u, v) > threePointRadius(u, v);
}

// A random spot around the hoop, not too near `from`: about a third are behind the 3-point line.
// `random` gives numbers in [0, 1) (the game's seeded "spots" stream).
export function randomSpot(random, from) {
  const wantThree = random() < THREE_POINT_SHARE;
  for (let i = 0; i < 100; i++) {
    // Keep him roughly in front of the hoop so his back-on shooting pose still faces it.
    const angle = ((40 + random() * 100) * Math.PI) / 180;
    const line = threePointRadius(RIM.u + Math.cos(angle), RIM.v + Math.sin(angle));
    const d = wantThree
      ? line + LINE_CLEARANCE + random() * 0.7
      : 2 + random() * (line - LINE_CLEARANCE - 2);
    const u = RIM.u + Math.cos(angle) * d;
    const v = RIM.v + Math.sin(angle) * d;
    if (u < 1.8 || u > ROOM_U - 0.8 || v > ROOM_V - 0.8) continue;
    if (Math.hypot(u - from.u, v - from.v) < 0.8) continue;
    return { u, v };
  }
  return { ...DEFAULT_SPOT };
}
