// A game from start to end, the same in every mode: starting it, the player's moves, shooting, the
// ball's hits and whether each shot went in, and the per-frame update. What differs between modes
// is asked of the mode being played (modes/index.js).

import { sound } from "../audio.js";
import { BALL_BADGES } from "../content/looks.js";
import { COURT_PX, EU, EV, PX_PER_M, RIM, RIM_R, ROOM_U, ROOM_V, isThreePointSpot, project } from "../engine/court.js";
import { GRAVITY, stepBall as physicsStep, stepFixed } from "../engine/physics.js";
import { save } from "../engine/storage.js";
import { startToken } from "../leaderboard.js";
import { canJog, faceHoop, faceToward, frameCount, hasMove, jumpLift, loopFps, releaseOffset, sheet, shoePoints } from "../play/players.js";
import { BUZZER_CELEBRATION, addPopup, announce, fireLevel, newStats, nextBallKind, pixelFx, recordMiss, timingWindow, zoneCenter } from "../play/react.js";
import { recordMade, recordShot, updateReplay } from "../play/replay.js";
import { updateHud } from "../play/scene.js";
import { ANIM_FPS, JOG_MAX_TIME, JOG_SPEED, JUMP_FRAME_TIME, LAUNCH_ANGLE, canShoot, hints, mode, player, random, resetRandom, setAnim, setPhase, state, steering } from "../play/state.js";
import { showScreen } from "../screens/base.js";
import { endGame } from "../screens/over.js";
import { GAME_SECONDS } from "../shared/rules.js";

const SLOW_MO = 0.35; // game speed while a shot at the buzzer drops toward the hoop

let gamesStarted = 0;

export function startGame() {
  setPhase("playing");
  state.score = 0;
  state.timeLeft = GAME_SECONDS;
  state.elapsed = 0;
  state.balls = [];
  state.popups = [];
  state.confetti = [];
  pixelFx.clear();
  state.shoeFire = null;
  state.flash = 0;
  state.timeScale = 1;
  state.endAt = 0;
  state.shotLog = [];
  state.replayShots = [];
  state.hiddenTab = false;
  state.paused = false;
  state.gameToken = null;
  state.rngSeed = null;
  resetRandom();
  const game = ++gamesStarted;
  // A start token, for the leaderboard and coins (a finished HORSE match earns coins too). Free play
  // never finishes, so it has none.
  if (mode().ranked !== false || mode().passAndPlay)
    startToken().then((token) => {
      if (game === gamesStarted) state.gameToken = token;
    });
  state.buzzerBeater = false;
  state.streak = 0;
  state.coldStreak = 0;
  state.aroundAt = 0;
  state.aroundTime = 0;
  state.stats = newStats();
  state.dailyDone = false; // finished the daily challenge in this game
  const start = mode().startSpot();
  player.u = start.u;
  player.v = start.v;
  faceHoop();
  player.fade = 1;
  player.activeBall = null;
  player.moving = false;
  player.path = null;
  player.steered = false;
  player.dunk = null;
  player.lift = 0;
  setAnim("idle");
  showScreen(null);
  updateHud();
  sound.gameStart();
  announce("start", "#ffffff");
  mode().begin?.();
}

// ---------- Shooting ----------

function gaussian() {
  return (random("aim") + random("aim") + random("aim") - 1.5) / 1.5;
}

// `timing` is 0 for a perfect release, negative for early and positive for late. Only while playing
// (canShoot): once time's up, a jump that's still going just ends, with no ball, so every shot that can
// score is in the shot log.
export function shoot(timing) {
  if (!canShoot()) return setAnim("dribble");
  const releaseAnim = player.anim;
  const releaseT = player.t;
  // The green as they saw it, for the replay (before this shot is logged, which moves it on).
  const green = { center: zoneCenter(), window: timingWindow() };
  if (!hints.learned) {
    hints.learned = true;
    save("orson-hoops-learned", true);
  }
  const ground = project(player.u, player.v);
  const [offX, offY] = releaseOffset();
  const dirU = RIM.u - player.u;
  const dirV = RIM.v - player.v;
  const dist = Math.hypot(dirU, dirV);
  const du = dirU / dist;
  const dv = dirV / dist;

  // Start the ball where his hands are in the release frame (never right at the rim: close in, the
  // hands' place along the court can come out past it).
  const screenPerM = du * EU.x + dv * EV.x;
  // Shooting nearly straight up or down the screen, the hands' sideways place says next to nothing
  // about how far in front of him they are: then take a forearm's length.
  const reach = Math.abs(screenPerM) < 40 ? 0.3 : offX / screenPerM;
  const ahead = Math.max(0, Math.min(1, dist - 0.6, reach));
  const u = player.u + du * ahead;
  const v = player.v + dv * ahead;
  let z = (project(u, v).y - (ground.y + offY)) / PX_PER_M;
  const lift = jumpLift(); // a player who jumps higher lets go higher (content/attributes.js)
  if (lift) z += lift;

  // Releasing late (on the way down) flattens the shot.
  const clamped = Math.max(-2.5, Math.min(2.5, timing));
  let angle = LAUNCH_ANGLE - Math.max(0, clamped) * 0.1;

  // Ideal speed to drop through the rim at that angle, aiming a touch past the centre. Close in,
  // the rim can be above that angle's line, which no speed reaches: then he shoots steeper.
  const d = Math.hypot(RIM.u - u, RIM.v - v) + 0.05;
  const dz = RIM.z - z;
  angle = Math.max(angle, Math.atan(dz / d + 0.3));
  const cos = Math.cos(angle);
  const ideal = Math.sqrt((GRAVITY * d * d) / (2 * cos * cos * (d * Math.tan(angle) - dz)));

  // A good 3-point shooter (content/attributes.js) is less off on a 3: his timing mistakes and the
  // wobble shrink. (Times 1 for everyone else, which leaves the numbers exactly as they were.)
  const three = isThreePointSpot(player.u, player.v);
  const steady = three ? 1 / player.attrs.three : 1;
  const speed = ideal * (1 + 0.11 * clamped * steady + 0.012 * gaussian() * steady);
  const sideways = 0.012 * gaussian() * steady + 0.012 * clamped * Math.sign(gaussian()) * steady;
  const hu = du * cos - dv * sideways;
  const hv = dv * cos + du * sideways;
  launchBall({ u, v, z, vu: hu * speed, vv: hv * speed, vz: Math.sin(angle) * speed }, clamped, { three, releaseAnim, releaseT, green });
}

// A ball leaving his hands (a shot or a dunk): it joins the balls in play, goes in the shot log, and
// he plays his release while it flies. `shot`: whether it's a 3, and his move, its time and the green
// when he let go (for the instant replay).
function launchBall(at, timing, shot) {
  const { three, releaseAnim, releaseT, green } = shot;
  const { u, v, z } = at;
  const ball = {
    ...at,
    spin: 0,
    age: 0,
    scored: false,
    touchedRim: false,
    touchedBoard: false,
    decided: false,
    bounces: 0,
    three,
    fire: fireLevel(),
    kind: nextBallKind(),
    prevZ: z,
  };
  state.balls.push(ball);
  if (ball.fire) {
    sound.fireWhoosh();
    const p = project(u, v, z);
    ball.trail = pixelFx.fireTrail(p.x, p.y, ball.fire.fx);
  }
  if (state.phase === "playing") {
    ball.log = [Math.round(mode().gameSeconds() * 100) / 100, ball.three ? 1 : 0, 0, Math.round(timing * 1000) / 1000, ball.kind];
    state.shotLog.push(ball.log);
    ball.replay = recordShot(ball, releaseAnim, releaseT, green); // for the instant replay (play/replay.js)
  }
  player.activeBall = ball;
  player.airT = player.anim === "jump" ? player.t : Infinity; // let go from a gather: not in the air
  setAnim("release");
}

// ---------- Dunking ----------

// Free play: close to the hoop, a shot is a dunk. He gathers, leaps in toward the rim and up till his
// hands are over it, slams the ball down through, and drops back to land in front of the hoop.
const DUNK_RANGE = 2.0; // metres from the hoop
const DUNK_RISE = 0.4; // seconds from leaving the floor to the slam
const DUNK_FALL = 0.35; // seconds back down
const DUNK_REACH = 0.55; // how far in front of the hoop his body is at the slam
const DUNK_LAND = 1.15; // and where he lands

export function canDunk() {
  return !!mode().freeMove && Math.hypot(RIM.u - player.u, RIM.v - player.v) <= DUNK_RANGE;
}

export function startDunk() {
  const du = player.u - RIM.u;
  const dv = player.v - RIM.v;
  const d = Math.hypot(du, dv) || 1;
  const toward = (r) => ({ u: RIM.u + (du / d) * r, v: RIM.v + (dv / d) * r });
  // How high he has to leap for his hands (where the ball leaves them in his shot) to be over the rim.
  const hands = (-releaseOffset()[1] / (sheet.sprites.fullRes ?? sheet.sprites.res)) / PX_PER_M; // (as worked out for the full-detail sheet)
  player.dunk = { from: { u: player.u, v: player.v }, peak: toward(DUNK_REACH), land: toward(DUNK_LAND), lift: Math.max(0.4, RIM.z + 0.25 - hands) };
}

function endDunk() {
  player.dunk = null;
  player.lift = 0;
}

const ease = (k) => 1 - (1 - k) * (1 - k);
function moveAlong(a, b, k) {
  player.u = a.u + (b.u - a.u) * k;
  player.v = a.v + (b.v - a.v) * k;
}

// Up toward the rim; at the top, the slam.
function dunkRise() {
  const { from, peak, lift } = player.dunk;
  const k = Math.min(1, player.t / DUNK_RISE);
  moveAlong(from, peak, ease(k));
  player.lift = lift * Math.sin((k * Math.PI) / 2);
  if (k < 1) return;
  // The ball, just over the rim, slammed straight down through it.
  state.shake = 1;
  state.flash = Math.max(state.flash, 0.25);
  sound.rim(5);
  const p = project(RIM.u, RIM.v, RIM.z);
  addPopup("SLAM DUNK", "#ffffff", p.x, p.y - 140);
  pixelFx.spark(p.x, p.y, { floorDrop: project(RIM.u, RIM.v, 0).y - p.y });
  const shot = { three: false, releaseAnim: player.anim, releaseT: player.t, green: { center: zoneCenter(), window: timingWindow() } };
  launchBall({ u: RIM.u, v: RIM.v + 0.05, z: RIM.z + 0.3, vu: 0, vv: 0, vz: -6 }, 0, shot);
}

// Back down to the floor in front of the hoop.
function dunkFall() {
  const { peak, land, lift } = player.dunk;
  const k = Math.min(1, player.t / DUNK_FALL);
  moveAlong(peak, land, k);
  player.lift = lift * (1 - k * k);
}

// ---------- The ball ----------

// What the ball hitting things sounds and looks like (engine/physics.js reports the hits).
const BALL_EVENTS = {
  basket: (b) => scoreBasket(b),
  floor(speed) {
    if (speed > 1) sound.bounce(speed);
  },
  rim(speed, qu, qv, nu, nv) {
    if (speed > 0.4) sound.rim(speed);
    if (speed > 1.5) {
      const p = project(qu, qv, RIM.z);
      const floor = project(qu, qv, 0);
      pixelFx.spark(p.x, p.y, { floorDrop: floor.y - p.y, flip: nu - nv < 0 });
      state.shake = Math.max(state.shake, Math.min(1, (speed - 1.5) / 4));
    }
  },
  board(speed) {
    if (speed > 1) sound.board(speed);
    if (speed > 3) state.shake = Math.max(state.shake, Math.min(0.6, (speed - 3) / 6));
  },
};
export function stepBall(b, dt) {
  physicsStep(b, dt, BALL_EVENTS);
}

function stepPhysics(dt) {
  stepFixed(dt, (step) => {
    for (const b of state.balls) stepBall(b, step);
  });
}

function scoreBasket(b) {
  if (state.phase !== "playing" && state.phase !== "ending") return;
  if (b.decided) return; // already called a miss: it stays one (checkDecided waits while it's on the rim)
  if (!mode().countsShot()) return;
  mode().onMake(b);
  recordMade(b);
}

function missedShot(b) {
  if (state.phase !== "playing" && state.phase !== "ending") return;
  if (!mode().countsShot()) return;
  recordMiss();
  mode().onMiss(b);
  const wasOnFire = fireLevel() !== null;
  state.streak = 0;
  state.coldStreak++;
  if (!b.touchedRim && !b.touchedBoard) sound.groan();
  else if (b.touchedRim) sound.ooh();
  if (wasOnFire) announce("fireOut", "#a0e7ff");
  else if (!b.touchedRim && !b.touchedBoard) announce("airball", "#c8b6ff");
  else if (state.coldStreak >= 3 && state.coldStreak % 3 === 0) announce("cold", "#a0e7ff");
  else if (Math.random() < 0.7) announce("miss", "#c8b6ff");
}

// A ball's call: in the air, then made or missed, once (b.decided). A miss can't become a make later,
// so the score, the streak and the shot log always agree with the server's recount (recountScore).
// A ball still sitting on the rim isn't called yet: if it drops in, it counts. It's only given up on
// just before it's cleared away (BALL_LIFE), so nothing can drop in after the call.
const BALL_LIFE = 5; // seconds a ball stays in play
const onRim = (b) => b.z > RIM.z - 0.3 && Math.hypot(b.u - RIM.u, b.v - RIM.v) < RIM_R + 0.3;
export function checkDecided(b) {
  if (b.decided) return;
  const missed = b.bounces > 0 || (b.vz < 0 && b.z < RIM.z - 0.6) || (b.age > 3 && !onRim(b)) || b.age > BALL_LIFE - 0.2;
  if (b.scored || missed) {
    b.decided = true;
    if (!b.scored) missedShot(b);
  }
}

// ---------- Update ----------

// While he jogs: footsteps twice a stride, the ball's bounce once.
function jogSounds() {
  const n = frameCount("run");
  const frame = Math.floor(player.t * loopFps("run")) % n;
  if (frame !== player.lastRunFrame && (frame === 0 || frame === Math.floor(n / 2))) {
    sound.step(0.6);
    if (frame === 0) sound.dribble();
  }
  player.lastRunFrame = frame;
}

// Free play: where he can go. On the floor, in front of the backboard, and not right under the hoop.
// (Worked out when used: the court can change.)
const freeArea = () => ({ u0: 1.2, u1: ROOM_U - 0.7, v0: RIM.v + 0.4, v1: ROOM_V - 0.7, rim: 1.1 });
// Moves he can be steered out of (not mid-shot).
const STEERABLE = ["idle", "turn", "start", "dribble", "run"];

// Back to dribbling while standing still (after a shot, or at a new spot he didn't jog to): picking
// the dribble back up if the sheet has it (a sheet made from video does), else straight into it.
const dribbleAgain = () => (hasMove("start") ? "start" : "dribble");
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Free play: they steer him (steering() in play/state.js, a direction on screen). He jogs that way,
// facing where he's going (players without jogging moves slide along dribbling), up to JOG_SPEED.
// When they let go he turns to the hoop and dribbles.
function steerPlayer(dt) {
  const s = steering();
  const amount = Math.hypot(s.x, s.y);
  const steerable = STEERABLE.includes(player.anim);
  if (amount < 0.1 || !steerable) {
    if (player.steered) {
      player.steered = false;
      faceHoop();
      if (steerable) setAnim("dribble");
    }
    return;
  }
  // The court is isometric: the screen direction is du * EU + dv * EV for a direction (du, dv) on
  // the court. Solve for it, then go that way at a speed in metres.
  const det = EU.x * EV.y - EV.x * EU.y;
  const du = (s.x * EV.y - EV.x * s.y) / det;
  const dv = (EU.x * s.y - s.x * EU.y) / det;
  const len = Math.hypot(du, dv);
  const step = JOG_SPEED * amount * dt;
  const wasThree = isThreePointSpot(player.u, player.v);
  const FREE_AREA = freeArea();
  let u = clamp(player.u + (du / len) * step, FREE_AREA.u0, FREE_AREA.u1);
  let v = clamp(player.v + (dv / len) * step, FREE_AREA.v0, FREE_AREA.v1);
  const fromRim = Math.hypot(u - RIM.u, v - RIM.v);
  if (fromRim < FREE_AREA.rim) {
    // Slide round the hoop rather than under it.
    u = RIM.u + ((u - RIM.u) / fromRim) * FREE_AREA.rim;
    v = Math.max(FREE_AREA.v0, RIM.v + ((v - RIM.v) / fromRim) * FREE_AREA.rim);
  }
  player.u = u;
  player.v = v;
  faceToward(player.u + du / len, player.v + dv / len);
  const anim = canJog() ? "run" : "dribble";
  if (player.anim !== anim) setAnim(anim);
  player.steered = true;
  if (anim === "run") jogSounds();
  // Stepping back behind the line: say so.
  if (!wasThree && isThreePointSpot(u, v)) {
    const p = project(u, v);
    addPopup("3PT", "#ffffff", p.x, p.y - 500);
  }
}

function updatePlayer(dt) {
  player.t += dt;
  if (state.phase === "replay") {
    updateReplay();
    return;
  }

  if (player.moving) {
    // A sheet with jogging moves: he jogs to the next spot, dribbling. Otherwise he fades out and
    // appears there.
    if (canJog()) {
      if (!player.path) {
        const spot = mode().pickSpot();
        const dist = Math.hypot(spot.u - player.u, spot.v - player.v);
        player.path = { from: { u: player.u, v: player.v }, to: spot, t: 0, dur: Math.min(JOG_MAX_TIME, dist / JOG_SPEED) };
        if (dist > 0.05) {
          faceToward(spot.u, spot.v);
          setAnim("run");
        }
      }
      const path = player.path;
      path.t += dt;
      const k = path.dur ? Math.min(1, path.t / path.dur) : 1;
      player.u = path.from.u + (path.to.u - path.from.u) * k;
      player.v = path.from.v + (path.to.v - path.from.v) * k;
      if (player.anim === "run") jogSounds();
      if (k < 1) return;
      player.fade = 1;
    } else {
      player.fade -= dt * 6;
      if (player.fade > 0) return;
    }
    {
      const spot = player.path?.to ?? mode().pickSpot();
      player.path = null;
      player.u = spot.u;
      player.v = spot.v;
      faceHoop();
      player.moving = false;
      if (!canJog()) player.fade = 0;
      // Already facing the hoop after the first shot: straight to dribbling (or jumping, if held and
      // there's still time to shoot). He jogs in dribbling; standing where he shot from, he picks the
      // dribble back up.
      setAnim(state.pressed && canShoot() ? "gather" : player.anim === "run" ? "dribble" : dribbleAgain());
      if (isThreePointSpot(spot.u, spot.v)) {
        const p = project(spot.u, spot.v);
        addPopup("3PT SPOT", "#ffffff", p.x, p.y - 500);
      }
      // A bonus ball coming up: say so.
      const badge = BALL_BADGES[nextBallKind()];
      if (badge) {
        announce(badge.call, badge.color);
        sound.cheer(1.2);
      }
    }
    return;
  }
  if (player.fade < 1) player.fade = Math.min(1, player.fade + dt * 6);
  if (mode().freeMove && state.phase === "playing") steerPlayer(dt);

  switch (player.anim) {
    case "turn":
      if (player.t >= frameCount("turn") / ANIM_FPS.turn) {
        sound.step(); // his feet set as he finishes turning to the hoop
        setAnim(state.pressed && canShoot() ? "gather" : "dribble");
      }
      break;
    case "gather":
      if (player.t >= frameCount("gather") / ANIM_FPS.gather) {
        setAnim("jump");
        sound.squeak();
      }
      break;
    case "start": {
      // Picking the dribble back up (ball at his waist, the first bounces), then the dribble loop.
      if (player.t * ANIM_FPS.start >= frameCount("start")) setAnim("dribble");
      break;
    }
    case "dribble": {
      // Bounce sound when the ball hits the floor (the first frame of the loop).
      const frame = Math.floor(player.t * loopFps("dribble")) % frameCount("dribble");
      if (frame === 0 && player.lastDribbleFrame !== 0) sound.dribble();
      player.lastDribbleFrame = frame;
      break;
    }
    case "jump":
      if (player.dunk) dunkRise();
      else if (player.t >= frameCount("jump") * JUMP_FRAME_TIME) shoot(2.5);
      break;
    case "release":
    case "recover": {
      if (player.dunk) dunkFall();
      const done =
        player.anim === "recover" ? player.t >= frameCount("recover") / ANIM_FPS.recover
        : player.t >= Math.max(frameCount("release") / ANIM_FPS.release, player.dunk ? DUNK_FALL : 0);
      // After a jump shot his arms come down and he stands ready (a sheet made from video has it),
      // rather than holding the follow-through.
      if (done && player.anim === "release" && !player.dunk && hasMove("recover")) {
        setAnim("recover");
        break;
      }
      const ball = player.activeBall;
      // (A ball that's gone from play without being decided can't hold him up.)
      if (done && (!ball || ball.decided || !state.balls.includes(ball)) && state.phase === "playing") {
        endDunk();
        player.activeBall = null;
        if (mode().freeMove) {
          // Free play: the ball's back in his hands where he stands, ready to move or shoot again.
          faceHoop();
          setAnim(state.pressed ? "gather" : dribbleAgain());
        } else player.moving = true;
      }
      break;
    }
  }
}

function update(dt) {
  if (state.phase === "playing") mode().clock(dt);
  else if (state.phase === "turn") mode().betweenTurns?.(dt);
  else if (state.phase === "ending") {
    // Let the last shot's reaction play out before the game-over screen.
    if (state.balls.every((b) => b.decided)) {
      const now = performance.now() / 1000;
      if (!state.endAt) state.endAt = now + (state.buzzerBeater ? BUZZER_CELEBRATION : 1.2);
      if (now >= state.endAt) endGame();
    }
  }

  updatePlayer(dt);

  for (const b of state.balls) checkDecided(b);
  state.balls = state.balls.filter((b) => {
    const keep = b.age < BALL_LIFE && b.z > -4;
    if (!keep) b.trail?.stop();
    return keep;
  });

  for (const p of state.popups) p.age += dt;
  state.popups = state.popups.filter((p) => p.age < 1.2);

  if (state.banner) {
    state.banner.age += dt;
    if (state.banner.age > state.banner.duration) state.banner = null;
  }

  // Flame trail (and crackle) behind balls shot while on fire: a pixel comet pointed along the ball's flight.
  for (const b of state.balls) {
    if (!b.trail) continue;
    if (b.age > 2.5) {
      b.trail.stop();
      continue;
    }
    if (b.age < 1.5 && Math.random() < dt * 30) sound.crackle();
    const p = project(b.u, b.v, b.z);
    b.trail.move(p.x, p.y);
  }

  // Flames round the player's shoes while they're on fire (hidden while they fade to a new spot).
  const fire = state.phase === "playing" || state.phase === "ending" || state.phase === "replay" ? fireLevel() : null;
  if (state.shoeFire && state.shoeFire.level !== fire) {
    state.shoeFire.stop();
    state.shoeFire = null;
  }
  if (fire && !state.shoeFire) {
    state.shoeFire = pixelFx.shoeFire(shoePoints(), fire.fx.palette);
    state.shoeFire.level = fire;
  }
  if (state.shoeFire) {
    state.shoeFire.moveFeet(shoePoints());
    state.shoeFire.hidden = player.fade < 0.6;
  }
  state.shake = Math.max(0, state.shake - dt * 4);
  for (const b of state.balls) if (b.squash) b.squash = Math.max(0, b.squash - dt * 8);
}

// Slow motion while a shot released before the buzzer drops toward the hoop.
function updateSlowMo(dt) {
  const dropping = state.phase === "ending" && state.balls.some(
    (b) => b.atBuzzer && !b.decided && b.vz < 0 && b.z < RIM.z + 1.8 && Math.hypot(b.u - RIM.u, b.v - RIM.v) < 1.6,
  );
  if (state.phase === "replay") return; // a replay sets its own speed (play/replay.js)
  if (dropping && state.timeScale === 1) sound.ooh();
  const target = dropping ? SLOW_MO : 1;
  state.timeScale += (target - state.timeScale) * Math.min(1, dt * 8);
  if (Math.abs(target - state.timeScale) < 0.01) state.timeScale = target;
}

function updateCelebration(dt) {
  state.flash = Math.max(0, state.flash - dt * 2.5);
  pixelFx.update(dt);
  for (const c of state.confetti) {
    c.vy += 300 * dt;
    c.vx *= 1 - dt;
    c.x += c.vx * dt + Math.sin(c.y / 60) * 40 * dt;
    c.y += c.vy * dt;
    c.rot += c.spin * dt;
  }
  state.confetti = state.confetti.filter((c) => c.y < COURT_PX + 50);
}

// One frame of the game (not drawing it): slow motion, the ball physics, everything else, effects.
export function step(dt) {
  updateSlowMo(dt);
  stepPhysics(dt * state.timeScale);
  update(dt * state.timeScale);
  updateCelebration(dt);
}
