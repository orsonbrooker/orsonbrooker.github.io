// Instant replays: after a game, its best shot again in slow motion, then back to the game-over screen.
//
// Nothing is recorded frame by frame. Each release keeps what's needed to fly the same ball again:
// who shot it and from where, how far into the jump they let go, the ball's start (where it left their
// hands and its speed, in court metres), its fire level, its kind, and later whether it went in. The
// physics (engine/physics.js) has a fixed step and nothing else touches a ball, so stepping it again from
// the same start gives exactly the same flight, rim hits and all. A replay changes nothing about the
// game: not the score, the shot log or what's sent to the leaderboard.

import { sound } from "../audio.js";
import { FIRE_LEVELS } from "../content/looks.js";
import { COURT_PX, RIM, project } from "../engine/court.js";
import { stepBall } from "../engine/physics.js";
import { pickPhrase } from "../phrases.js";
import { characters, faceHoop, frameCount, hasMove, useCharacter } from "../play/players.js";
import { addPopup, confettiBurst, pixelFx } from "../play/react.js";
import { ANIM_FPS, player, setAnim, state } from "../play/state.js";
import { howTo, showScreen } from "../screens/base.js";
import { ballPoints } from "../shared/rules.js";

const REPLAY_SPEED = 0.4; // game speed during a replay
const HOLD_AFTER = 1.6; // seconds to stay on the court after the shot is decided
const FONT = '"Press Start 2P", monospace';
const CALM = matchMedia("(prefers-reduced-motion: reduce)");

// ---------- Recording ----------

// At each release while playing (play/round.js): what's needed to fly the same ball again.
export function recordShot(ball, releaseAnim, releaseT, green) {
  const shot = {
    who: characters.selected,
    at: { u: player.u, v: player.v },
    anim: releaseAnim, // "jump", or "gather" if they let go before leaving the ground
    t: releaseT, // seconds into that animation
    green, // where the timing bar's green was and how wide ({ center, window }), to draw it the same
    start: { u: ball.u, v: ball.v, z: ball.z, vu: ball.vu, vv: ball.vv, vz: ball.vz },
    fire: ball.fire ? FIRE_LEVELS.indexOf(ball.fire) : -1,
    kind: ball.kind,
    three: ball.three,
    streak: state.streak, // makes in a row before it, for the flames round their shoes
    made: false,
    swish: false,
    buzzer: false,
  };
  state.replayShots.push(shot);
  return shot;
}

// A basket that counted (play/round.js, after the mode has scored it).
export function recordMade(b) {
  if (!b.replay) return;
  b.replay.made = true;
  b.replay.swish = !b.touchedRim && !b.touchedBoard;
  b.replay.buzzer = !!b.atBuzzer;
}

// ---------- Picking the shot ----------

const value = (shot) => ballPoints(shot.kind, shot.three, FIRE_LEVELS[shot.fire]?.bonus ?? 0);

// The game's best shot: a buzzer beater, else the most points (3s, fire, bonus balls), else a swish;
// the later one if they tie. Null if nothing went in.
export function bestShot() {
  let best = null;
  let bestKey = null;
  for (const shot of state.replayShots) {
    if (!shot.made) continue;
    const key = [shot.buzzer ? 1 : 0, value(shot), shot.swish ? 1 : 0];
    const diff = bestKey && (key[0] - bestKey[0] || key[1] - bestKey[1] || key[2] - bestKey[2]);
    if (!best || diff >= 0) [best, bestKey] = [shot, key];
  }
  return best;
}

// ---------- Playing it ----------

let replay = null; // the replay showing: { shot, ball, cheered, doneAt, restore }

export const replaying = () => replay !== null;
// The green on the timing bar during a replay: where it was for that shot (it may have moved since).
export const replayGreen = () => replay?.shot.green ?? null;

// From the game-over screen: play the best shot again.
export async function startReplay() {
  const shot = bestShot();
  if (!shot || state.phase !== "over") return;
  const restore = { who: characters.selected, streak: state.streak, u: player.u, v: player.v };
  state.phase = "replay";
  showScreen(null);
  if (shot.who !== characters.selected) await useCharacter(shot.who, { remember: false }).catch(() => {});
  for (const b of state.balls) b.trail?.stop();
  state.balls = [];
  state.popups = [];
  state.banner = null;
  state.streak = shot.streak;
  state.timeScale = REPLAY_SPEED;
  player.u = shot.at.u;
  player.v = shot.at.v;
  faceHoop(); // the way he faced for that shot
  player.fade = 1;
  player.moving = false;
  player.activeBall = null;
  setAnim("gather");
  sound.squeak();
  sound.say(pickPhrase("replay", player.pronoun));
  replay = { shot, ball: null, cheered: false, doneAt: 0, restore };
}

// Each frame of a replay, instead of the player's usual update (play/round.js). `dt` is slowed down.
export function updateReplay() {
  if (!replay) return;
  const { shot } = replay;
  if (!replay.ball) {
    if (player.anim === "gather" && shot.anim === "jump" && player.t >= frameCount("gather") / ANIM_FPS.gather) {
      setAnim("jump");
      sound.squeak();
    }
    if (player.anim === shot.anim && player.t >= shot.t) release(shot);
    return;
  }
  const b = replay.ball;
  if (player.anim === "release" && player.t >= frameCount("release") / ANIM_FPS.release && hasMove("recover")) setAnim("recover");
  if (b.scored && !replay.cheered) cheer(shot, b);
  if (b.decided && !replay.doneAt) replay.doneAt = performance.now() / 1000 + HOLD_AFTER;
  if (replay.doneAt && performance.now() / 1000 >= replay.doneAt) endReplay();
}

// Let go: the same ball as in the game, from the same start.
function release(shot) {
  const ball = {
    ...shot.start,
    spin: 0,
    age: 0,
    scored: false,
    touchedRim: false,
    touchedBoard: false,
    decided: false,
    bounces: 0,
    three: shot.three,
    fire: FIRE_LEVELS[shot.fire] ?? null,
    kind: shot.kind,
    prevZ: shot.start.z,
  };
  state.balls.push(ball);
  if (ball.fire) {
    sound.fireWhoosh();
    const p = project(ball.u, ball.v, ball.z);
    ball.trail = pixelFx.fireTrail(p.x, p.y, ball.fire.fx);
  }
  player.activeBall = ball;
  replay.ball = ball;
  setAnim("release");
}

// It goes in (again): the swish, the points, and the big moment if it was a buzzer beater.
function cheer(shot, b) {
  replay.cheered = true;
  const p = project(RIM.u, RIM.v, RIM.z);
  sound.swish();
  pixelFx.swish(p.x, p.y, shot.fire >= 0 || shot.kind ? "gold" : "cyan");
  const label = state.score > 0 ? `+${value(shot)}` : b.touchedBoard && !b.touchedRim ? "BANK" : shot.swish ? "SWISH" : "BUCKET";
  addPopup(label, FIRE_LEVELS[shot.fire]?.color ?? "#ffe066", p.x, p.y - 60);
  if (shot.buzzer && !CALM.matches) {
    state.flash = 1;
    confettiBurst(120);
    pixelFx.fireworks(COURT_PX);
  }
  if (shot.buzzer) sound.buzzerBeater();
  else sound.cheer(1.3);
}

// Back to the game-over screen as it was.
export function endReplay() {
  if (!replay) return;
  const { restore } = replay;
  replay = null;
  for (const b of state.balls) b.trail?.stop();
  state.balls = [];
  state.timeScale = 1;
  state.streak = restore.streak;
  player.u = restore.u;
  player.v = restore.v;
  faceHoop();
  player.activeBall = null;
  setAnim("idle");
  if (restore.who !== characters.selected) useCharacter(restore.who, { remember: false }).catch(() => {});
  state.phase = "over";
  state.overAt = performance.now();
  showScreen("over");
  document.getElementById("replay")?.focus({ preventScroll: true });
}

// ?debug (window.game.checkReplays): flies every recorded shot again, straight through, and says
// whether each one does what it did in the game (in or out). All should match.
export function checkReplays() {
  const none = { basket() {}, rim() {}, board() {}, floor() {} };
  return state.replayShots.map((shot) => {
    const b = { ...shot.start, spin: 0, age: 0, scored: false, touchedRim: false, touchedBoard: false, bounces: 0, prevZ: shot.start.z };
    for (let i = 0; i < 240 * 5 && !b.scored && b.bounces === 0; i++) stepBall(b, 1 / 240, none);
    return { made: shot.made, again: b.scored, same: b.scored === shot.made };
  });
}

// ---------- Drawing ----------

// Over the court during a replay: bars top and bottom like on TV, "REPLAY" with a blinking light, and
// who's shooting.
export function drawReplay(ctx) {
  if (!replay) return;
  const bar = 150;
  ctx.save();
  ctx.fillStyle = "rgba(20, 10, 18, 0.72)";
  ctx.fillRect(0, 0, COURT_PX, bar);
  ctx.fillRect(0, COURT_PX - bar, COURT_PX, bar);
  ctx.textBaseline = "middle";
  ctx.font = `72px ${FONT}`;
  ctx.textAlign = "left";
  if (Math.floor(performance.now() / 500) % 2 === 0) {
    ctx.fillStyle = "#ff4d4d";
    ctx.fillRect(70, bar / 2 - 26, 52, 52);
  }
  ctx.fillStyle = "#fff";
  ctx.fillText("REPLAY", 150, bar / 2 + 4);
  // Who's shooting, top right; the sound buttons sit in the bottom right corner.
  const name = characters.list.find((c) => c.id === replay.shot.who)?.name ?? "";
  ctx.textAlign = "right";
  ctx.font = `56px ${FONT}`;
  ctx.fillStyle = "#ffe066";
  ctx.fillText(name.toUpperCase().slice(0, 14), COURT_PX - 70, bar / 2 + 4);
  ctx.textAlign = "left";
  ctx.font = `40px ${FONT}`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fillText(`SLOW MO · ${howTo("TAP TO SKIP", "SPACE TO SKIP", "TAP TO SKIP")}`, 70, COURT_PX - bar / 2 + 4);
  ctx.restore();
}
