// A game from start to end, the same in every mode: starting it, the player's moves, shooting, the
// ball's hits and whether each shot went in, and the per-frame update. What differs between modes
// is asked of the mode being played (modes/index.js).

import { sound } from "../audio.js";
import { BALL_BADGES } from "../content/looks.js";
import { COURT_PX, EU, EV, PX_PER_M, RIM, isThreePointSpot, project } from "../engine/court.js";
import { GRAVITY, stepBall as physicsStep, stepFixed } from "../engine/physics.js";
import { save } from "../engine/storage.js";
import { startToken } from "../leaderboard.js";
import { frameCount, sheet, shoePoints } from "../play/players.js";
import { BUZZER_CELEBRATION, addPopup, announce, fireLevel, newStats, nextBallKind, pixelFx, recordMiss } from "../play/react.js";
import { updateHud } from "../play/scene.js";
import { ANIM_FPS, JUMP_FRAME_TIME, LAUNCH_ANGLE, hints, mode, player, random, resetRandom, setAnim, state } from "../play/state.js";
import { showScreen } from "../screens/base.js";
import { endGame } from "../screens/over.js";
import { GAME_SECONDS } from "../shared/rules.js";

const SLOW_MO = 0.35; // game speed while a shot at the buzzer drops toward the hoop

let gamesStarted = 0;

export function startGame() {
  state.phase = "playing";
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
  state.hiddenTab = false;
  state.gameToken = null;
  state.rngSeed = null;
  resetRandom();
  const game = ++gamesStarted;
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
  player.fade = 1;
  player.activeBall = null;
  player.moving = false;
  setAnim("idle");
  showScreen(null);
  updateHud();
  sound.gameStart();
  announce("start", "#ffffff");
}

// ---------- Shooting ----------

function gaussian() {
  return (random("aim") + random("aim") + random("aim") - 1.5) / 1.5;
}

// `timing` is 0 for a perfect release, negative for early and positive for late.
export function shoot(timing) {
  if (!hints.learned) {
    hints.learned = true;
    save("orson-hoops-learned", true);
  }
  const ground = project(player.u, player.v);
  const [offX, offY] = sheet.sprites.releaseOffset;
  const dirU = RIM.u - player.u;
  const dirV = RIM.v - player.v;
  const dist = Math.hypot(dirU, dirV);
  const du = dirU / dist;
  const dv = dirV / dist;

  // Start the ball where his hands are in the release frame.
  const screenPerM = du * EU.x + dv * EV.x;
  const ahead = Math.max(0, Math.min(1, screenPerM ? offX / screenPerM : 0.5));
  const u = player.u + du * ahead;
  const v = player.v + dv * ahead;
  const z = (project(u, v).y - (ground.y + offY)) / PX_PER_M;

  // Releasing late (on the way down) flattens the shot.
  const clamped = Math.max(-2.5, Math.min(2.5, timing));
  const angle = LAUNCH_ANGLE - Math.max(0, clamped) * 0.1;

  // Ideal speed to drop through the rim at that angle, aiming a touch past the centre.
  const d = Math.hypot(RIM.u - u, RIM.v - v) + 0.05;
  const dz = RIM.z - z;
  const cos = Math.cos(angle);
  const ideal = Math.sqrt((GRAVITY * d * d) / (2 * cos * cos * (d * Math.tan(angle) - dz)));

  const speed = ideal * (1 + 0.11 * clamped + 0.012 * gaussian());
  const sideways = 0.012 * gaussian() + 0.012 * clamped * Math.sign(gaussian());
  const hu = du * cos - dv * sideways;
  const hv = dv * cos + du * sideways;

  const ball = {
    u, v, z,
    vu: hu * speed,
    vv: hv * speed,
    vz: Math.sin(angle) * speed,
    spin: 0,
    age: 0,
    scored: false,
    touchedRim: false,
    touchedBoard: false,
    decided: false,
    bounces: 0,
    three: isThreePointSpot(player.u, player.v),
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
    ball.log = [Math.round(mode().gameSeconds() * 100) / 100, ball.three ? 1 : 0, 0, Math.round(clamped * 1000) / 1000, ball.kind];
    state.shotLog.push(ball.log);
  }
  player.activeBall = ball;
  setAnim("release");
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
  if (!mode().countsShot()) return;
  mode().onMake(b);
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

// A shot is decided once it has gone in or clearly missed.
export function checkDecided(b) {
  if (b.decided) return;
  const missed = b.bounces > 0 || (b.vz < 0 && b.z < RIM.z - 0.6) || b.age > 3;
  if (b.scored || missed) {
    b.decided = true;
    if (!b.scored) missedShot(b);
  }
}

// ---------- Update ----------

function updatePlayer(dt) {
  player.t += dt;

  if (player.moving) {
    player.fade -= dt * 6;
    if (player.fade <= 0) {
      const spot = mode().pickSpot();
      player.u = spot.u;
      player.v = spot.v;
      player.moving = false;
      player.fade = 0;
      // Already facing the hoop after the first shot: straight to dribbling (or jumping, if held).
      setAnim(state.pressed ? "gather" : "dribble");
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

  switch (player.anim) {
    case "turn":
      if (player.t >= frameCount("turn") / ANIM_FPS.turn) setAnim(state.pressed ? "gather" : "dribble");
      break;
    case "gather":
      if (player.t >= frameCount("gather") / ANIM_FPS.gather) {
        setAnim("jump");
        sound.squeak();
      }
      break;
    case "dribble": {
      // Bounce sound when the ball hits the floor (the first frame of the loop).
      const frame = Math.floor(player.t * ANIM_FPS.dribble) % frameCount("dribble");
      if (frame === 0 && player.lastDribbleFrame !== 0) sound.dribble();
      player.lastDribbleFrame = frame;
      break;
    }
    case "jump":
      if (player.t >= frameCount("jump") * JUMP_FRAME_TIME) shoot(2.5);
      break;
    case "release": {
      const done = player.t >= frameCount("release") / ANIM_FPS.release;
      const ball = player.activeBall;
      if (done && (!ball || ball.decided) && state.phase === "playing") {
        player.activeBall = null;
        player.moving = true;
      }
      break;
    }
  }
}

function update(dt) {
  if (state.phase === "playing") mode().clock(dt);
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
    const keep = b.age < 5 && b.z > -4;
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
  const fire = state.phase === "playing" || state.phase === "ending" ? fireLevel() : null;
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
