// The court: where things are in court space (metres) and how that maps onto the court art.
//
// The ball is simulated in 3D court space (metres) and projected onto the isometric court art.
// Screen units are "court pixels": the court image (2048px for the gym). u runs along the left wall
// (the hoop wall), v runs out from it, z is height. Each court's numbers are in content/courts.js.

import { COURTS, DEFAULT_COURT } from "../content/courts.js";

export const BALL_R = 0.23;
export const LINE_CLEARANCE = 0.25; // keep spots this far off the line so it's clear which side he's on
const THREE_POINT_SHARE = 0.35;

// The court being played (content/courts.js) and what's worked out from it. These are live: they
// change when setCourt() is called, and every module that imports them sees the new values.
export let court;
export let COURT_PX;
export let PX_PER_M;
let ORIGIN; // back corner of the floor
export let EU; // +1m along the left wall (the hoop wall)
export let EV; // +1m out from the left wall
export let ROOM_U;
export let ROOM_V;
export let RIM_R; // to the centre of the rim tube
export let RIM_TUBE;
export let RIM;
export let BOARD;
let THREE_POINT_LINE;
export let HOOP_FRONT_AT;
export let DEFAULT_SPOT;

// Makes `def` (an entry in content/courts.js) the court everything is measured on. The art and the
// physics settings are switched by play/court.js.
export function setCourt(def) {
  court = def;
  COURT_PX = def.size;
  PX_PER_M = def.pxPerM;
  ORIGIN = def.origin;
  EU = def.eu;
  EV = def.ev;
  ROOM_U = def.room.u;
  ROOM_V = def.room.v;
  RIM_R = def.rim.radius;
  RIM_TUBE = def.rim.tube;
  RIM = { ...unprojectFloor(def.rim.at.x, def.rim.at.y + def.rim.height * PX_PER_M), z: def.rim.height };
  const { rimOut, ...board } = def.board;
  BOARD = { v: RIM.v - rimOut, ...board };
  THREE_POINT_LINE = def.threePointLine;
  HOOP_FRONT_AT = def.hoopFrontAt;
  DEFAULT_SPOT = def.defaultSpot;
}
setCourt(COURTS[DEFAULT_COURT]);

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
