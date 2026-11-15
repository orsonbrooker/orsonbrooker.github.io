// Draws the court each frame (the player, the balls, the hoop, the timing bar, calls and effects) and
// keeps the score shown under the court and on the wall scoreboard up to date.

import { createLedBoard } from "../engine/ledboard.js";
import { createPixelScoreboard } from "../engine/pixelboard.js";
import { drawArtLab } from "../play/artlab.js";
import { boxKey, boxShowing, drawBox, drawStreet, hasPanels, keepOpen, onBox, openBox, opening, showShut, waiting } from "../play/fold.js";
import { BALL_R, COURT_PX, EV, HOOP_FRONT_AT, PX_PER_M, RIM, RIM_R, ROOM_U, ROOM_V, court, project } from "../engine/court.js";
import { ROLL_HEADINGS, ballFrame, drawBadge, drawBanner, drawConfetti, drawCourtLines, drawHintBubble, drawPopups, drawShadow, rollFrame } from "../engine/draw.js";
import { currentFrame, frameCount, liftNow, recheckSheet, sheet } from "../play/players.js";
import { fireLevel, nextBallBadge, nextBallKind, pixelFx, timingWindow, zoneCenter } from "../play/react.js";
import { replayGreen } from "../play/replay.js";
import { DEBUG, JUMP_APEX, JUMP_FRAME_TIME, hints, mode, player, state } from "../play/state.js";
import { howTo, stage, tapToPlay } from "../screens/base.js";
import { NORMAL } from "../shared/rules.js";
import { usingKeys } from "../ui/keys.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
// Loaded at boot: the front of the hoop (drawn over the ball as it drops through) and the ball sprites.
export const art = { hoopFront: null, ballSprites: null };
// How much bigger the timing bar is drawn: the court shrinks to fit a phone, and the bar with it, so on
// a small screen it's drawn up to twice as big to stay easy to see (normal size from about 700px wide).
let meterScale = 1;

export function resize() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.min(COURT_PX, Math.round(rect.width * dpr));
  meterScale = rect.width > 0 ? Math.min(2, Math.max(1, 700 / rect.width)) : 1;
  if (canvas.width !== size) {
    canvas.width = canvas.height = size;
    recheckSheet(); // the player's sheet at the size that suits the court now
  }
}

// ---------- The score ----------

const scoreEl = document.getElementById("score");
const timeEl = document.getElementById("time");
let scoreboardDirty = true;
// A pixel-art court's scoreboard (engine/pixelboard.js), made for the court being played.
let pixelBoard = null;
let pixelBoardCourt = null;

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
  if (court.scoreboard) {
    if (pixelBoardCourt !== court) {
      pixelBoard = createPixelScoreboard(court);
      pixelBoardCourt = court;
    }
    pixelBoard.draw(left, right);
  }
  scoreboardDirty = false;
}

// The court picture under the canvas: the court's contest image (racks' shadows on the floor) while the 3-point
// contest is played on a court that has one, its own image otherwise.
const courtImg = document.querySelector("img.court");
const IN_GAME = new Set(["playing", "turn", "ending"]);
const OPEN_AFTER = new Set(["over", "replay"]);
const gamePage = document.getElementById("game-page");
function showCourtArt() {
  // out of a game the gym stands shut (the title and the menus), except behind a finished game and its replay
  if (loadingScene && (IN_GAME.has(state.phase) || !court.panels)) dropLoading();
  if (OPEN_AFTER.has(state.phase)) keepOpen(); // the gym open on its street, walls down, as the game left it
  else if (!IN_GAME.has(state.phase)) showShut();
  // zoomed in on a tall screen once the box opens (styles.css .zoomed)
  gamePage?.classList.toggle("zoomed", boxShowing() && !waiting());
  const contest = !!(mode().contestArt && state.phase !== "title" && court.contest);
  const src = contest ? court.contest.image : court.image;
  if (courtImg && courtImg.getAttribute("src") !== src) courtImg.src = src;
  placeControls();
}

// ---------- The box (play/fold.js) ----------

// Drawn on its own canvas over the whole screen (styles.css .box-layer), so the front walls can lie flat beyond the
// court's square, and redrawn only when it changes.
const boxCanvas = Object.assign(document.createElement("canvas"), { className: "box-layer" });
boxCanvas.setAttribute("aria-hidden", "true");
canvas.after(boxCanvas);
const boxCtx = boxCanvas.getContext("2d");
let boxDrawn = null;
// The picture shown while the game loaded (games/shootaround/index.html): taken away once the box and the street
// are drawn here, or as soon as a game starts (a court without a box, or one whose pictures didn't load).
let loadingScene = document.querySelector(".court-loading");
function dropLoading() {
  loadingScene?.remove();
  loadingScene = null;
}

function renderBox() {
  if (!boxShowing()) {
    if (boxDrawn) {
      boxCtx.setTransform(1, 0, 0, 1, 0, 0);
      boxCtx.clearRect(0, 0, boxCanvas.width, boxCanvas.height);
    }
    boxDrawn = null;
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (boxCanvas.width !== w || boxCanvas.height !== h) Object.assign(boxCanvas, { width: w, height: h });
  const rect = canvas.getBoundingClientRect();
  const sign = titleSign();
  const key = `${boxKey()}|${rect.left},${rect.top},${rect.width}|${w}x${h}|${sign?.version ?? ""}`;
  if (key === boxDrawn) return;
  boxDrawn = key;
  boxCtx.setTransform(1, 0, 0, 1, 0, 0);
  boxCtx.clearRect(0, 0, w, h);
  const s = (rect.width / COURT_PX) * dpr;
  boxCtx.setTransform(s, 0, 0, s, rect.left * dpr, rect.top * dpr);
  drawBox(boxCtx);
  if (sign) {
    boxCtx.imageSmoothingEnabled = false;
    boxCtx.drawImage(sign.canvas, sign.x, sign.y, sign.canvas.width * sign.scale, sign.canvas.height * sign.scale);
    boxCtx.imageSmoothingEnabled = true;
  }
  if (loadingScene && streetDrawn) dropLoading();
}

// On the title, "Tap to play" (or Space) flashes on an LED sign on the shut box's front left wall, under the
// billboard, instead of in a box over the scene (the words stay in the page for screen readers).
let titleLed = null;
let titleLedCourt = null;
let titleLedSince = 0;
function titleSign() {
  const on = !!court.titleLed && state.phase === "title" && waiting();
  // a court without the sign (a test court in ?debug) shows the title's words as they are
  tapToPlay.closest(".title-screen")?.classList.toggle("off-wall", !court.titleLed);
  tapToPlay.classList.toggle("on-wall", on);
  if (!on) {
    titleLedSince = 0;
    return null;
  }
  if (titleLedCourt !== court) {
    titleLed = createLedBoard(court, court.titleLed);
    titleLedCourt = court;
  }
  if (!titleLedSince) titleLedSince = performance.now();
  // while their player loads, the loading bar under the title (ui/loading-bar.js) is shown here in LEDs instead
  const bar = tapToPlay.parentElement?.querySelector(".loading-bar");
  const t = (performance.now() - titleLedSince) / 1000;
  if (bar) {
    const now = bar.getAttribute("aria-valuenow");
    titleLed.draw({ bar: bar.classList.contains("unknown") || now === null ? null : Number(now) / 100, color: "#ffe066" }, t);
  } else {
    const text = tapToPlay.textContent.toUpperCase().replace("…", "...");
    titleLed.draw({ text, color: "#ffe066", flash: true }, t);
  }
  return titleLed;
}

// The street and sky round the court while the box shows (play/fold.js drawStreet): its own canvas over the whole
// screen behind the court (the first thing in the stage), drawn again only when the screen or the court moves.
const streetCanvas = Object.assign(document.createElement("canvas"), { className: "box-layer" });
streetCanvas.setAttribute("aria-hidden", "true");
canvas.parentElement.prepend(streetCanvas);
const streetCtx = streetCanvas.getContext("2d");
let streetDrawn = null;
function renderStreet() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const key = boxShowing() ? `${rect.left},${rect.top},${rect.width}|${innerWidth}x${innerHeight}|${court.panels}` : "";
  if (key === streetDrawn) return;
  streetDrawn = key;
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (streetCanvas.width !== w || streetCanvas.height !== h) Object.assign(streetCanvas, { width: w, height: h });
  streetCtx.setTransform(1, 0, 0, 1, 0, 0);
  streetCtx.clearRect(0, 0, w, h);
  if (!key) return;
  const s = (rect.width / COURT_PX) * dpr;
  streetCtx.setTransform(s, 0, 0, s, rect.left * dpr, rect.top * dpr);
  if (!drawStreet(streetCtx)) streetDrawn = null; // not loaded yet: tried again next frame
}

// Lays a control on the box: `el` turned to lie on its surface at `at` (court pixels), its left to right along
// `along` and its top to bottom along `down`, `size` CSS pixels square, kept on the screen.
function layOn(el, w, size, down, keepOn = true) {
  const rect = canvas.getBoundingClientRect();
  const s = rect.width / COURT_PX;
  const len = Math.hypot(EV.x, EV.y); // one metre on the floor: the surface's own metres are shorter as it turns
  const flip = w.along.x < 0 ? -1 : 1; // reads left to right on screen
  const m = [(flip * w.along.x) / len, (flip * w.along.y) / len, down.x / len, down.y / len];
  const x = rect.left + w.at.x * s - size / 2, y = rect.top + w.at.y * s - size / 2;
  const left = keepOn ? Math.max(8, Math.min(innerWidth - size - 8, x)) : x;
  const top = keepOn ? Math.max(8, Math.min(innerHeight - size - 8, y)) : y;
  el.style.cssText = `left: ${left}px; top: ${top}px; right: auto; bottom: auto;
    width: ${size}px; height: ${size}px; transform: matrix(${m.join(", ")}, 0, 0);`;
  return m;
}

// A button's label lying on a surface with it (turned by the 2x2 matrix m): its letters run level on screen, never
// slanted (that reads as italics), and lie back into the button in perspective, the bottom edge a little wider than
// the top, tipped back about as far as the face itself looks. Sized to sit inside the button's face (a circle
// `face` of the button's `size` across, as it looks on screen) with room to spare round it. `chars`: how many
// letters (the pixel font's are about square). `up`: it's that many CSS pixels up the screen (on a raised top).
function levelLabel(span, m, size, face, chars, up = 0) {
  if (!span) return;
  const [a, b, c, d] = m;
  const det = a * d - b * c || 1;
  const inv = [d / det, -b / det, -c / det, a / det]; // undoes the surface's turn: then it's level on screen
  const r = (size / 2) * face;
  const across = 2 * r * Math.hypot(a, c); // the face's width and height on screen
  const tall = 2 * r * Math.hypot(b, d);
  const squash = Math.max(0.15, 1 - 0.85 * (1 - Math.min(1, tall / across))); // how flat it looks
  const px = Math.floor(Math.min((across * 0.8) / chars, (tall * 0.55) / squash));
  // too thin to read (a roof half turned nearly edge on): no label, rather than one hanging off the face
  span.style.visibility = px < 6 ? "hidden" : "";
  span.style.fontSize = `${Math.max(6, px)}px`;
  // screen = m . own: undo the surface, then tip it back in perspective (rotateX turns its top away)
  span.style.transform = `${span.dataset.centre ?? ""} matrix(${inv.join(", ")}, 0, 0) translate(0, ${-up}px) perspective(${px * 7}px) rotateX(${Math.acos(squash)}rad)`;
}

// The START button on the roof, while the box is shut: a big red arcade button lying on it, pressed by a tap
// anywhere (engine/input.js) or Space, like the game's own button. A shiny red dome on a dark grey base.
const startButton = Object.assign(document.createElement("button"), { type: "button", className: "box-start", hidden: true });
startButton.setAttribute("aria-label", "Start");
const startArt = Object.assign(document.createElement("canvas"), { className: "arcade-art" });
startButton.append(startArt, Object.assign(document.createElement("span"), { textContent: "START" }));

// The game's arcade buttons (START on the roof, SHOOT on the right wall in Free play; Flow's C3 and D4), drawn
// into `cvs` as pixel art on the game's own grid (`k` CSS pixels an art pixel), as they lie on their surface (the
// 2x2 matrix m takes the button's own square, `size` across, to the screen): a thick dark base and on it a puck
// with its side showing and a glossy top, red for START (`look` "start") or a basketball for SHOOT ("shoot").
// `pressed`: the puck is pushed down into its base. Placed back in the button's own frame, centred, so it lies
// where the button is. Returns how high the puck's top is, in CSS pixels up the screen.
const ARCADE = {
  start: { side: ["#9c3238", "#793540"], top: ["#d0553c", "#de6d2b", "#f39a55", "#b5501d"] },
  shoot: { side: ["#b5501d", "#843a18"], top: ["#de6d2b", "#ea8642", "#f39a55", "#b5501d"], seams: true },
  stick: { collar: true }, // the joystick's base: no puck, a metal collar round the hole its stick comes out of
};
function drawArcade(cvs, m, size, k, look, pressed) {
  const { side, top, seams, collar } = ARCADE[look];
  const [a, b, c, d] = m;
  const det = a * d - b * c || 1;
  const local = (x, y) => [(d * x - c * y) / det, (-b * x + a * y) / det];
  const full = Math.max(k * 3, Math.round((size * 0.12) / k) * k);
  const lift = pressed ? Math.max(k, Math.round(full / 3 / k) * k) : full;
  const baseH = Math.max(k * 2, Math.round((size * (collar ? 0.11 : 0.06)) / k) * k); // the joystick's base is a thick ring
  // parts, top first: radius (button pixels), bottom and top (CSS pixels up the screen)
  const parts = [
    { r: size * 0.37, z0: baseH, z1: baseH + lift, puck: true },
    { r: size * 0.5, z0: 0, z1: baseH },
  ].filter((p) => !(collar && p.puck));
  const ex = size * 0.5 * Math.hypot(a, c), ey = size * 0.5 * Math.hypot(b, d);
  const zMax = baseH + (collar ? 0 : full); // (the same canvas up or pressed, so it doesn't jump)
  const W = 2 * Math.ceil(ex / k + 2), H = 2 * Math.ceil((ey + zMax) / k + 2);
  cvs.width = W;
  cvs.height = H;
  const g = cvs.getContext("2d");
  const img = g.createImageData(W, H);
  const owner = new Int8Array(W * H).fill(-1); // which part: 2n its side, 2n + 1 its top
  const colour = new Array(W * H);
  const seam = new Int8Array(W * H); // on the ball: which side of each seam (a bit each)
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const sx = (i + 0.5 - W / 2) * k, sy = (j + 0.5 - H / 2) * k;
      for (let n = 0; n < parts.length; n++) {
        const p = parts[n];
        const f = p.r / (size * 0.5);
        // its top face: this pixel, dropped to the ground from the top, inside the circle
        const [tx, ty] = local(sx, sy + p.z1);
        if (Math.hypot(tx, ty) < p.r) {
          const fy = (sy + p.z1) / (f * ey), fx = sx / (f * ex); // -1..1 across it on screen
          let col;
          if (p.puck) {
            col = top[0];
            if (fy < -0.05) col = top[1];
            if (fy < -0.45 && Math.abs(fx) < 0.8) col = top[2];
            if (fy < -0.6 && fx > -0.55 && fx < -0.1) col = "#f9f5f0"; // the gleam
            if (fy > 0.6) col = top[3];
            if (seams) {
              const u = tx / p.r, v = ty / p.r;
              seam[j * W + i] = (u > 0) | ((v > 0) << 1) | ((Math.hypot(u + 1.25, v) > 0.9) << 2) | ((Math.hypot(u - 1.25, v) > 0.9) << 3);
            }
          } else if (collar) {
            const rr = Math.hypot(tx, ty) / p.r;
            // a dark well with a metal ring round it, then the ring's top, lit at the back
            col = rr < 0.2 ? "#2b1622" : rr < 0.3 ? (fy < -0.05 ? "#c4bfc8" : "#877e8f") : rr < 0.34 ? "#2b1622" : rr > 0.86 ? (fy < 0.1 ? "#877e8f" : "#5f5d77") : fy < -0.6 ? "#5f5d77" : "#403751";
          } else col = fy < -0.2 ? "#877e8f" : "#5f5d77";
          owner[j * W + i] = n * 2 + 1;
          colour[j * W + i] = col;
          break;
        }
        // its side: the pixel lies between the circle at its bottom and at its top
        const [bx, by] = local(sx, sy + p.z0);
        const dx = tx - bx, dy = ty - by;
        const t = Math.max(0, Math.min(1, -(bx * dx + by * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(bx + dx * t, by + dy * t) < p.r) {
          owner[j * W + i] = n * 2;
          const lit = sx < -ex * 0.35 * f;
          colour[j * W + i] = p.puck ? side[lit ? 0 : 1] : lit ? "#5f5d77" : "#403751";
          break;
        }
      }
    }
  const INK = [43, 22, 34];
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : owner[y * W + x]);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const o = owner[j * W + i];
      if (o < 0) continue;
      // a dark line round the outside, round the puck where it meets its base, where its top meets its side,
      // and the ball's seams
      const near = [at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)];
      let edge = near.some((x) => x < 0) || (o < 2 && near.some((x) => x >= 2)) || (o === 1 && at(i, j + 1) === 0);
      if (!edge && o === 1 && seams) {
        const q = seam[j * W + i];
        edge = (at(i + 1, j) === 1 && seam[j * W + i + 1] !== q) || (at(i, j + 1) === 1 && seam[(j + 1) * W + i] !== q);
      }
      const hex = edge ? null : colour[j * W + i];
      const rgb = hex ? [1, 3, 5].map((q) => parseInt(hex.slice(q, q + 2), 16)) : INK;
      img.data.set([...rgb, 255], (j * W + i) * 4);
    }
  g.putImageData(img, 0, 0);
  Object.assign(cvs.style, { width: `${W * k}px`, height: `${H * k}px`, transform: `translate(-50%, -50%) matrix(${[d / det, -b / det, -c / det, a / det].join(", ")}, 0, 0)` });
  return baseH + (collar ? 0 : lift);
}

// The joystick's stick and ball, as pixel art like the buttons (`k` CSS pixels an art pixel), drawn on screen
// over its base (lying on a wall: the 2x2 matrix m, the base `size` across): a metal shaft from the collar, at the
// base's top `baseTop` CSS pixels up the screen, to a shiny yellow ball `stand` pixels up, leaning the way the knob
// is pushed (`off`: how far, in the joystick's own frame, play/controls.js). Its canvas is centred on the base and
// turned back to lie level on screen.
function drawKnob(cvs, m, size, k, baseTop, stand, off) {
  const [a, b, c, d] = m;
  const det = a * d - b * c || 1;
  const ox = 0.4 * (a * off[0] + c * off[1]), oy = 0.4 * (b * off[0] + d * off[1]); // the lean, on screen (the ball tips less far than the finger goes)
  const R = Math.max(4, Math.round((size * 0.2) / k)); // the ball's radius, art pixels: a big chunky ball
  const half = Math.ceil((size * 0.6 + stand) / k) + R + 2;
  const W = 2 * half, H = 2 * half;
  cvs.width = W;
  cvs.height = H;
  const g = cvs.getContext("2d");
  const img = g.createImageData(W, H);
  const own = new Int8Array(W * H); // 1 shaft, 2 ball
  const col = new Array(W * H);
  // in art pixels from the canvas's centre (the base's centre on the ground)
  const fx = 0, fy = -baseTop / k; // the shaft's foot, in the collar
  const bx = ox / k, by = (oy - stand) / k; // the ball's centre
  const sw = Math.max(1.5, R * 0.36); // the shaft's half width: short and stout
  const len2 = (bx - fx) ** 2 + (by - fy) ** 2 || 1;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = i + 0.5 - half, y = j + 0.5 - half;
      const n = j * W + i;
      const dx = x - bx, dy = y - by, dr = Math.hypot(dx, dy);
      if (dr < R) {
        own[n] = 2;
        const lx = dx / R, ly = dy / R; // the light from the upper left
        const lit = -0.6 * lx - 0.7 * ly + 0.4 * Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly));
        // bands of yellow, a white gleam up at the left, and a little light bounced back along the bottom edge
        col[n] = Math.hypot(lx + 0.4, ly + 0.45) < 0.22 ? "#f9f5f0" : lit > 0.6 ? "#fff3a6" : lit > 0.25 ? "#f8d76c" : lit > -0.15 ? "#f0b424" : ly > 0.55 && lx > -0.2 && dr > R - 1.6 ? "#f0b424" : "#c48412";
        continue;
      }
      const t = Math.max(0, Math.min(1, ((x - fx) * (bx - fx) + (y - fy) * (by - fy)) / len2));
      const px = fx + (bx - fx) * t, py = fy + (by - fy) * t;
      const across = ((x - px) * (by - fy) - (y - py) * (bx - fx)) / Math.sqrt(len2); // which side of its middle
      if (Math.hypot(x - px, y - py) < sw && t > 0) {
        own[n] = 1;
        col[n] = across < -sw * 0.3 ? "#877e8f" : across < sw * 0.3 ? "#5f5d77" : "#403751"; // dark, like the base
      }
    }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : own[y * W + x]);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const o = own[j * W + i];
      if (!o) continue;
      const near = [at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)];
      const edge = near.some((q) => q === 0) || (o === 1 && near.some((q) => q === 2));
      const hex = edge ? "#2b1622" : col[j * W + i];
      img.data.set([...[1, 3, 5].map((q) => parseInt(hex.slice(q, q + 2), 16)), 255], (j * W + i) * 4);
    }
  g.putImageData(img, 0, 0);
  Object.assign(cvs.style, { width: `${W * k}px`, height: `${H * k}px`, transform: `translate(-50%, -50%) matrix(${[d / det, -b / det, -c / det, a / det].join(", ")}, 0, 0)` });
}
// one art pixel of the court, in CSS pixels, on whole device pixels
const artPixel = (rect) => Math.max(1, Math.round((rect.width / COURT_PX) * 5 * devicePixelRatio)) / devicePixelRatio;
startButton.addEventListener("click", () => openBox());
boxCanvas.after(startButton);
const START_M = 3.6; // metres across
const START_AT = [3.0, 6.5]; // on the roof's side half (art/iso/gym-box keeps the split down the middle clear)
let startPlaced = null;
let startWasWaiting = false;
let startDownUntil = 0; // pressed (by a tap anywhere, a click or Space) it shows pushed in a moment as the box opens
function placeStart() {
  const w = hasPanels() && boxShowing() && opening() ? onBox("roof", ...START_AT) : null;
  // shut, it waits to be pressed; opening, it folds away with its half of the roof until that turns over
  const on = !!w && IN_GAME.has(state.phase) && (waiting() || w.up); // (on the title the box is just shut)
  startButton.hidden = !on;
  startButton.disabled = !waiting();
  if (startWasWaiting && !waiting()) startDownUntil = performance.now() + 180;
  // the keyboard: START takes focus while it waits (Enter or Space presses it), and gives it back to the game after
  if (on && waiting() && !startWasWaiting && usingKeys() && !document.querySelector(".panel-screen:not([hidden])")) startButton.focus({ preventScroll: true });
  if (!(on && waiting()) && document.activeElement === startButton) stage.focus({ preventScroll: true });
  startWasWaiting = on && waiting();
  if (!on) {
    startPlaced = null;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const down = (waiting() && startButton.matches(":active")) || performance.now() < startDownUntil;
  const key = `${rect.left},${rect.top},${rect.width}|${w.at.x},${w.at.y},${w.along.x},${w.along.y},${w.out.x},${w.out.y}|${down}`;
  if (key === startPlaced) return;
  startPlaced = key;
  const size = START_M * Math.hypot(EV.x, EV.y) * (rect.width / COURT_PX);
  // lying on the roof: left to right along v, top to bottom along u
  const m = layOn(startButton, { at: w.at, along: w.out }, size, w.along, false);
  // turned nearly edge on as the roof folds, it's gone (its label would hang off the roof's edge)
  const wide = Math.hypot(m[0], m[2]), high = Math.hypot(m[1], m[3]);
  startButton.style.visibility = Math.min(wide, high) / Math.max(wide, high) < 0.3 ? "hidden" : "";
  const up = drawArcade(startArt, m, size, artPixel(rect), "start", down);
  levelLabel(startButton.querySelector("span"), m, size, 0.62, 5, up);
}

// Free play's joystick and shoot button (play/controls.js) lie on the front walls once they're down: the
// joystick on the left one, the shoot button on the right one, standing up off them. Elsewhere they keep their
// corners.
const STICK_ON = ["left", 6.2, 2.7]; // the wall, metres along it from the back, metres out from its foot
const SHOOT_ON = ["right", 6.2, 2.7];
let controlsPlaced = null;
function placeControls() {
  const on = mode().freeMove && hasPanels() && boxShowing() && !opening() && IN_GAME.has(state.phase);
  const stick = document.querySelector(".touch-stick");
  const shoot = document.querySelector(".touch-shoot");
  if (!stick || !shoot) return;
  const knob = stick.querySelector(".touch-knob");
  const parts = [stick.querySelector(":scope > canvas:not(.arcade-art):not(.knob-art)"), knob?.querySelector(".knob-shaft"), knob?.querySelector(".knob-top"), shoot.querySelector(":scope > canvas:not(.arcade-art)")];
  // while the box is shut or opening there's nothing to steer yet
  const away = mode().freeMove && boxShowing() && opening();
  for (const el of [stick, shoot]) el.style.visibility = away ? "hidden" : "";
  if (!on) {
    if (controlsPlaced) {
      for (const el of [stick, shoot]) el.style.cssText = "";
      for (const prop of ["width", "height"]) knob?.style.removeProperty(prop);
      for (const img of parts) if (img) Object.assign(img.style, { filter: "", translate: "", transform: "" });
      for (const el of [stick, shoot]) el.classList.remove("on-box");
      const label = shoot.querySelector("span");
      if (label) Object.assign(label.style, { fontSize: "", transform: "" });
    }
    controlsPlaced = null;
    return;
  }
  // the knob keeps its share of the joystick however big it's drawn (styles.css gives it a fixed size)
  for (const prop of ["width", "height"]) knob?.style.setProperty(prop, "44%", "important");
  const rect = canvas.getBoundingClientRect();
  const s = rect.width / COURT_PX; // CSS pixels per court pixel
  // SHOOT shows pushed in while it's held: a finger on it, or Space (state.pressed, game.js press())
  const down = state.pressed || shoot.classList.contains("down");
  const key = `${rect.left},${rect.top},${s}|${down}|${stick.dataset.knob ?? ""}`;
  if (key === controlsPlaced) return;
  controlsPlaced = key;
  for (const [el, [wall, along, out], most] of [[stick, STICK_ON, 136], [shoot, SHOOT_ON, 112]]) {
    const w = onBox(wall, along, out);
    const len = Math.hypot(w.along.x, w.along.y);
    // about a third of the wall's length across, never so small it's hard to hit; its top towards the wall's foot
    const size = Math.max(72, Math.min(most, len * s * 3));
    const m = layOn(el, w, size, w.out);
    el.classList.add("on-box");
    if (el === stick) {
      // an arcade stick like the buttons: its base, then its shaft and ball leaning the way it's pushed
      let base = el.querySelector(".arcade-art");
      if (!base) el.prepend((base = Object.assign(document.createElement("canvas"), { className: "arcade-art" })));
      let top = el.querySelector(".knob-art");
      if (!top) el.append((top = Object.assign(document.createElement("canvas"), { className: "knob-art" })));
      const k = artPixel(rect);
      const baseTop = drawArcade(base, m, size, k, "stick", false);
      const off = (stick.dataset.knob ?? "0,0").split(",").map(Number);
      drawKnob(top, m, size, k, baseTop, size * 0.4, off);
    } else {
      // the same arcade button as START, a basketball on top
      let art = el.querySelector(".arcade-art");
      if (!art) el.prepend((art = Object.assign(document.createElement("canvas"), { className: "arcade-art" })));
      const up = drawArcade(art, m, size, artPixel(rect), "shoot", down);
      const label = el.querySelector("span");
      if (label) label.dataset.centre = "translate(-50%, -50%)";
      levelLabel(label, m, size, 0.62, 5, up);
    }
  }
}

function drawScoreboard() {
  if (scoreboardDirty || (court.scoreboard && pixelBoardCourt !== court)) renderScoreboard();
  if (!court.scoreboard) return;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const { canvas: c, x, y, scale } = pixelBoard;
  ctx.drawImage(c, x, y, c.width * scale, c.height * scale);
  ctx.imageSmoothingEnabled = smooth;
}

// The announcer's calls on the LED screen along the top of the hoop wall (engine/ledboard.js), on a court that has
// one, while its room can be seen: the call stays up as long as it takes to read (it may scroll), however soon
// state.banner goes. Elsewhere (the box shut, the old court) the call is drawn big over the court (drawBanner).
let led = null;
let ledCourt = null;
let ledFor = null; // the state.banner it's showing
let ledMessage = null;
let ledStart = 0;
const ledShowing = () => !!court.led && !(boxShowing() && opening());
function drawLed() {
  if (!court.led) return;
  if (ledCourt !== court) {
    led = createLedBoard(court, court.led);
    ledCourt = court;
  }
  const b = state.banner;
  if (b && b !== ledFor) {
    ledMessage = b;
    ledStart = performance.now();
  }
  ledFor = b;
  if (!ledShowing() || (!b && ledMessage?.flash)) ledMessage = null; // (a flashing one, like REPLAY, stops when its call goes)
  if (led.draw(ledMessage, (performance.now() - ledStart) / 1000)) ledMessage = null;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(led.canvas, led.x, led.y, led.canvas.width * led.scale, led.canvas.height * led.scale);
  ctx.imageSmoothingEnabled = smooth;
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
    // the ball in their hands, when the frame has its own (a kid from video): the game's ball, behind the
    // body, so the fingers in front of it stay in front
    const held = sheet.sprites.balls?.[`${sx},${sy}`];
    if (held) {
      const [cx, cy, r] = held;
      // it rolls a little as the dribble moves it up and down
      const sprite = ballFrame(art.ballSprites[nextBallKind()] ?? art.ballSprites[NORMAL], (cy / r) * HELD_ROLL);
      const d = 2 * r * scale * 1.04; // the sprite's ball fills a little less than its square
      ctx.drawImage(sprite, p.x + (ox + cx) * scale - d / 2, p.y + (oy + cy) * scale - d / 2, d, d);
    }
    ctx.drawImage(sheet.atlas, sx, sy, w, h, p.x + ox * scale, p.y + oy * scale, w * scale, h * scale);
    // a full-detail sheet from video: its number and team name over the frame
    const print = sheet.prints?.get(`${sx},${sy}`);
    if (print) ctx.drawImage(print, 0, 0, print.width, print.height, p.x + ox * scale, p.y + oy * scale, w * scale, h * scale);
  }
  ctx.globalAlpha = 1;
  drawArtLab(ctx, p);
}

const HELD_ROLL = 0.6; // how far a held ball turns for each radius it moves down in a dribble

function drawBall(b) {
  const p = project(b.u, b.v, b.z);
  const size = BALL_R * PX_PER_M * 2.6;
  const fade = b.age > 4.5 ? Math.max(0, (5 - b.age) / 0.5) : 1;
  // Turning about the level axis across the way it travels on the floor (engine/draw.js rollFrame), so backspin
  // off a shot turns it back towards the shooter whichever way it's going. `spin` is forward positive. Going
  // straight up or down (a dribble), it keeps the way it last had.
  if (Math.hypot(b.vu, b.vv) > 0.3) b.heading = (Math.atan2(b.vv, b.vu) / (Math.PI * 2)) * ROLL_HEADINGS;
  const sprite = rollFrame(art.ballSprites[b.kind ?? NORMAL], b.spin, b.heading ?? ROLL_HEADINGS / 4);
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
  const k = meterScale;
  const x = p.x + 110;
  const height = 260 * k;
  const top = p.y - 270 - height / 2; // grows from its middle, so it stays level with him
  const total = frameCount("jump") * JUMP_FRAME_TIME;
  const t = player.anim === "jump" ? player.t : 0;
  const fill = Math.min(1, t / total);

  ctx.fillStyle = "rgba(43, 22, 34, 0.85)";
  ctx.fillRect(x - 6 * k, top - 6 * k, 36 * k, height + 12 * k);
  // The top of the jump, unless the mode moves it; in a replay, where it was for that shot.
  const green = (state.phase === "replay" && replayGreen()) || { center: zoneCenter(), window: timingWindow() };
  const zoneTop = top + height * (1 - (green.center + green.window * 0.5) / total);
  const zoneH = (height * green.window) / total;
  ctx.fillStyle = fireLevel()?.color ?? "#3ddc84";
  ctx.fillRect(x, zoneTop, 24 * k, zoneH);
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 6 * k, top + height * (1 - fill) - 4 * k, 36 * k, 8 * k);
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
    : player.anim === "turn" || player.anim === "start" || player.anim === "dribble" ? howTo("Hold to jump", "Hold Space to jump", "Hold (or hold Space) to jump")
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

  showCourtArt();
  drawScoreboard();
  drawLed();
  mode().drawWall?.(ctx);
  renderStreet();
  renderBox();
  placeStart();

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
  if (!ledShowing()) drawBanner(ctx, state.banner);
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${state.flash * 0.6})`;
    ctx.fillRect(0, 0, COURT_PX, COURT_PX);
  }
  if (DEBUG) drawCourtLines(ctx);
}
