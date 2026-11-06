// Ball physics in court space (metres), at a fixed step: gravity, drag, the rim, the backboard, the
// floor and the walls. What the ball hits is reported through `on` so the game can react (sounds,
// sparks, shake, scoring) without the physics knowing about any of it:
//   on.basket(b)                       the ball dropped through the rim
//   on.rim(speed, qu, qv, nu, nv)      hit the rim (speed into it, the rim point, the push-out direction)
//   on.board(speed)                    hit the backboard
//   on.floor(speed)                    bounced on the floor

import { BALL_R, BOARD, RIM, RIM_R, RIM_TUBE, ROOM_U, ROOM_V } from "../engine/court.js";

export const GRAVITY = 9.81;
export const PHYSICS_STEP = 1 / 240;

export function stepBall(b, dt, on) {
  b.age += dt;
  b.prevZ = b.z;
  b.vz -= GRAVITY * dt;
  const drag = 1 - 0.04 * dt;
  b.vu *= drag;
  b.vv *= drag;
  b.vz *= drag;
  b.u += b.vu * dt;
  b.v += b.vv * dt;
  b.z += b.vz * dt;
  b.spin -= dt * 9;

  collideRim(b, on);
  collideBoard(b, on);

  // Basket: the ball centre drops through the rim plane inside the ring.
  if (!b.scored && b.prevZ >= RIM.z && b.z < RIM.z && Math.hypot(b.u - RIM.u, b.v - RIM.v) < RIM_R - RIM_TUBE) {
    b.scored = true;
    on.basket(b);
  }
  // The net slows the ball and steers it down.
  if (b.scored && b.z > RIM.z - 0.6 && b.z < RIM.z) {
    const k = Math.exp(-7 * dt);
    b.vu = b.vu * k + (RIM.u - b.u) * 4 * dt;
    b.vv = b.vv * k + (RIM.v - b.v) * 4 * dt;
    b.vz = Math.max(b.vz, -3);
  }

  // Floor (only inside the room; past the front edges the ball drops away).
  const onCourt = b.u < ROOM_U && b.v < ROOM_V;
  if (onCourt && b.z < BALL_R) {
    b.z = BALL_R;
    if (b.vz < 0) {
      on.floor(-b.vz);
      b.squash = Math.min(1, -b.vz / 7);
      b.vz = -b.vz * 0.72;
      if (b.vz < 0.5) b.vz = 0;
      b.vu *= 0.86;
      b.vv *= 0.86;
      b.bounces++;
    }
    if (b.vz === 0) {
      const roll = Math.exp(-1.5 * dt);
      b.vu *= roll;
      b.vv *= roll;
    }
  }
  // Walls.
  if (b.v < BALL_R && b.z > 0) {
    b.v = BALL_R;
    if (b.vv < 0) b.vv = -b.vv * 0.6;
  }
  if (b.u < BALL_R && b.z > 0) {
    b.u = BALL_R;
    if (b.vu < 0) b.vu = -b.vu * 0.6;
  }
}

function collideRim(b, on) {
  const du = b.u - RIM.u;
  const dv = b.v - RIM.v;
  const d = Math.hypot(du, dv);
  if (d < 1e-6) return;
  // Closest point on the rim circle.
  const qu = RIM.u + (du / d) * RIM_R;
  const qv = RIM.v + (dv / d) * RIM_R;
  let nu = b.u - qu;
  let nv = b.v - qv;
  let nz = b.z - RIM.z;
  const dist = Math.hypot(nu, nv, nz);
  const min = BALL_R + RIM_TUBE;
  if (dist >= min || dist < 1e-6) return;
  nu /= dist;
  nv /= dist;
  nz /= dist;
  b.u = qu + nu * min;
  b.v = qv + nv * min;
  b.z = RIM.z + nz * min;
  const vn = b.vu * nu + b.vv * nv + b.vz * nz;
  if (vn < 0) {
    const restitution = 0.55;
    const friction = 0.9;
    const tu = b.vu - vn * nu;
    const tv = b.vv - vn * nv;
    const tz = b.vz - vn * nz;
    b.vu = tu * friction - vn * restitution * nu;
    b.vv = tv * friction - vn * restitution * nv;
    b.vz = tz * friction - vn * restitution * nz;
    on.rim(-vn, qu, qv, nu, nv);
    b.touchedRim = true;
  }
}

function collideBoard(b, on) {
  if (b.u < BOARD.u0 - BALL_R * 0.5 || b.u > BOARD.u1 + BALL_R * 0.5) return;
  if (b.z < BOARD.z0 - BALL_R * 0.5 || b.z > BOARD.z1 + BALL_R * 0.5) return;
  if (b.v - BALL_R < BOARD.v && b.v > BOARD.v - 0.3) {
    b.v = BOARD.v + BALL_R;
    if (b.vv < 0) {
      on.board(-b.vv);
      b.vv = -b.vv * 0.72;
      b.vu *= 0.9;
      b.vz *= 0.9;
      b.touchedBoard = true;
    }
  }
}

// Runs `step(PHYSICS_STEP)` as many whole times as `dt` adds up to, carrying the rest to next time.
let accumulator = 0;
export function stepFixed(dt, step) {
  accumulator += dt;
  while (accumulator >= PHYSICS_STEP) {
    step(PHYSICS_STEP);
    accumulator -= PHYSICS_STEP;
  }
}
