// Draws the court each frame (the player, the balls, the hoop, the timing bar, calls and effects) and
// keeps the score shown under the court and on the wall scoreboard up to date.

import { BOARD_ART } from "../content/looks.js";
import { drawArtLab } from "../play/artlab.js";
import { BALL_R, COURT_PX, HOOP_FRONT_AT, PX_PER_M, RIM, RIM_R, ROOM_U, ROOM_V, project } from "../engine/court.js";
import { BALL_FRAMES, createWallScoreboard, drawBadge, drawBanner, drawConfetti, drawCourtLines, drawHintBubble, drawPopups, drawShadow } from "../engine/draw.js";
import { currentFrame, frameCount, liftNow, sheet } from "../play/players.js";
import { fireLevel, nextBallBadge, pixelFx, timingWindow, zoneCenter } from "../play/react.js";
import { drawReplay, replayGreen } from "../play/replay.js";
import { DEBUG, JUMP_APEX, JUMP_FRAME_TIME, hints, mode, player, state } from "../play/state.js";
import { howTo, stage } from "../screens/base.js";
import { NORMAL } from "../shared/rules.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
// Loaded at boot: the front of the hoop (drawn over the ball as it drops through) and the ball sprites.
export const art = { hoopFront: null, ballSprites: null };

export function resize() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.min(COURT_PX, Math.round(rect.width * dpr));
  if (canvas.width !== size) {
    canvas.width = canvas.height = size;
  }
}

// ---------- The score ----------

const scoreEl = document.getElementById("score");
const timeEl = document.getElementById("time");
const wallScoreboard = createWallScoreboard();
let scoreboardDirty = true;

// Shows the score and time (what they are depends on the mode) under the court, and marks the wall
// scoreboard to be redrawn.
export function updateHud() {
  const [score, time] = mode().hud();
  scoreEl.textContent = score;
  timeEl.textContent = time;
  scoreboardDirty = true;
}

function renderScoreboard() {
  const [left, right] = mode().scoreboard();
  wallScoreboard.draw(left, right);
  scoreboardDirty = false;
}

// ---------- The court ----------

function drawPlayer() {
  const [sx, sy, w, h, ox, oy] = currentFrame();
  const scale = 1 / sheet.sprites.res;
  const p = project(player.u, player.v, liftNow());
  ctx.globalAlpha = Math.max(0, player.fade);
  if (sheet.sprites.pixel) {
    // True pixel art: a whole number of screen pixels per art pixel, on whole screen pixels, so
    // every pixel stays square and sharp at any canvas size.
    const m = ctx.getTransform();
    const n = Math.max(1, Math.round(scale * m.a));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const fx = Math.round(m.a * p.x + m.e);
    const fy = Math.round(m.d * p.y + m.f);
    ctx.drawImage(sheet.atlas, sx, sy, w, h, fx + ox * n, fy + oy * n, w * n, h * n);
    // His number and team name, drawn finer than the art (like the builder's players).
    const print = sheet.prints?.get(`${sx},${sy}`);
    if (print) ctx.drawImage(print, 0, 0, print.width, print.height, fx + ox * n, fy + oy * n, w * n, h * n);
    ctx.restore();
  } else {
    ctx.drawImage(sheet.atlas, sx, sy, w, h, p.x + ox * scale, p.y + oy * scale, w * scale, h * scale);
    // a full-detail sheet from video: its number and team name over the frame
    const print = sheet.prints?.get(`${sx},${sy}`);
    if (print) ctx.drawImage(print, 0, 0, print.width, print.height, p.x + ox * scale, p.y + oy * scale, w * scale, h * scale);
  }
  ctx.globalAlpha = 1;
  drawArtLab(ctx, p);
}

function drawBall(b) {
  const p = project(b.u, b.v, b.z);
  const size = BALL_R * PX_PER_M * 2.6;
  const fade = b.age > 4.5 ? Math.max(0, (5 - b.age) / 0.5) : 1;
  const turns = (((-b.spin / Math.PI) % 1) + 1) % 1;
  const sprite = art.ballSprites[b.kind ?? NORMAL][Math.floor(turns * BALL_FRAMES) % BALL_FRAMES];
  // squashed flat for a moment after a floor bounce, sitting on the floor
  const sq = (b.squash ?? 0) * 0.35;
  const w = size * (1 + sq), h = size * (1 - sq);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite, p.x - w / 2, p.y + size / 2 - h, w, h);
  ctx.restore();
}

// The timing bar beside him while he jumps: let go while the marker is in the green.
function drawMeter() {
  if ((player.anim !== "gather" && player.anim !== "jump") || player.dunk) return; // (a dunk needs no timing)
  const p = project(player.u, player.v);
  const x = p.x + 110;
  const top = p.y - 400;
  const height = 260;
  const total = frameCount("jump") * JUMP_FRAME_TIME;
  const t = player.anim === "jump" ? player.t : 0;
  const fill = Math.min(1, t / total);

  ctx.fillStyle = "rgba(43, 22, 34, 0.85)";
  ctx.fillRect(x - 6, top - 6, 36, height + 12);
  // The top of the jump, unless the mode moves it; in a replay, where it was for that shot.
  const green = (state.phase === "replay" && replayGreen()) || { center: zoneCenter(), window: timingWindow() };
  const zoneTop = top + height * (1 - (green.center + green.window * 0.5) / total);
  const zoneH = (height * green.window) / total;
  ctx.fillStyle = fireLevel()?.color ?? "#3ddc84";
  ctx.fillRect(x, zoneTop, 24, zoneH);
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 6, top + height * (1 - fill) - 4, 36, 8);
}

// Above the player while the ball in his hands is a bonus ball.
function drawBallBadge() {
  const badge = nextBallBadge();
  if (!badge || player.moving || player.fade < 0.6) return;
  drawBadge(ctx, badge, project(player.u, player.v));
}

// The very first shot: what to do next, in a bubble over the player.
function drawHint() {
  if (hints.learned || state.phase !== "playing" || player.moving || player.fade < 1) return;
  const text =
    player.anim === "idle" ? howTo("Tap to face the hoop", "Press Space to face the hoop", "Tap or press Space to face the hoop")
    : player.anim === "turn" || player.anim === "dribble" ? howTo("Hold to jump", "Hold Space to jump", "Hold (or hold Space) to jump")
    : player.anim === "gather" || player.anim === "jump" ? "Let go at the top!"
    : "";
  if (!text) return;
  drawHintBubble(ctx, text, project(player.u, player.v));
}

export function render() {
  const k = canvas.width / COURT_PX;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, COURT_PX, COURT_PX);
  if (state.shake > 0) {
    const amp = state.shake * state.shake * 14;
    ctx.translate(Math.round((Math.random() - 0.5) * amp), Math.round((Math.random() - 0.5) * amp));
  }
  // The mode can make the whole court rumble (a long sudden death run, more the longer it goes).
  const rumble = mode().rumble();
  if (rumble > 0) {
    const t = performance.now() / 1000;
    ctx.translate(Math.round((Math.sin(t * 7.3) + 0.5 * Math.sin(t * 17.1)) * rumble * 0.7), Math.round((Math.cos(t * 9.7) + 0.4 * Math.sin(t * 23.3)) * rumble * 0.5));
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (scoreboardDirty) renderScoreboard();
  ctx.drawImage(wallScoreboard.canvas, BOARD_ART.area.x, BOARD_ART.area.y);

  mode().drawFloor?.(ctx);

  // Floor shadows first.
  drawShadow(ctx, player.u, player.v, 70, 26, 0.35 * Math.max(0, player.fade));
  for (const b of state.balls) {
    if (b.u > ROOM_U || b.v > ROOM_V) continue;
    const lift = Math.max(0, b.z);
    drawShadow(ctx, b.u, b.v, 30 / (1 + lift * 0.15), 12 / (1 + lift * 0.15), 0.3 / (1 + lift * 0.3));
  }

  pixelFx.draw(ctx, "under"); // fire trails behind the balls, floor flames behind the player

  // Back to front by isometric depth (u + v).
  const items = [{ depth: player.u + player.v, draw: drawPlayer }];
  items.push({ depth: RIM.u + RIM.v + RIM_R * 0.7, draw: () => ctx.drawImage(art.hoopFront, HOOP_FRONT_AT.x, HOOP_FRONT_AT.y) });
  for (const b of state.balls) items.push({ depth: b.u + b.v, draw: () => drawBall(b) });
  items.sort((a, b) => a.depth - b.depth);
  for (const item of items) item.draw();

  drawMeter();
  drawBallBadge();
  drawHint();
  mode().drawOver?.(ctx);
  drawPopups(ctx, state.popups);
  drawConfetti(ctx, state.confetti);
  pixelFx.draw(ctx, "over");
  drawBanner(ctx, state.banner);
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${state.flash * 0.6})`;
    ctx.fillRect(0, 0, COURT_PX, COURT_PX);
  }
  if (state.phase === "replay") drawReplay(ctx);
  if (DEBUG) drawCourtLines(ctx);
}
