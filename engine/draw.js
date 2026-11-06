// Drawing helpers for the court canvas, in court pixels: the spinning ball sprites, shadows, the
// big call banner, score popups, confetti, the hint bubble, the bonus ball badge, the wall
// scoreboard's lit digits, the debug lines, and finding a player's shoes in their sprite sheet.

import { BALL_LOOKS, BOARD_ART } from "../content/looks.js";
import { BOARD, COURT_PX, RIM, RIM_R, ROOM_U, ROOM_V, project, threePointRadius } from "../engine/court.js";
import { MONEY, NORMAL, RAINBOW } from "../shared/rules.js";

const FONT = '"Press Start 2P", monospace';

// ---------- Ball sprite (drawn in code so it can spin) ----------

// The seams turn while the light stays put, drawn fresh for each frame so the pixels stay crisp
// (rotating one picture smears its pixels). The seam pattern repeats every half turn.
export const BALL_FRAMES = 12;

// look: the ball's colours (BALL_LOOKS in content/looks.js).
function makeBallSprite(turn, look = BALL_LOOKS[NORMAL]) {
  const size = 16;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const mid = (size - 1) / 2;
  const cos = Math.cos(turn), sin = Math.sin(turn);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - mid, y - mid);
      if (d > 7.6) continue;
      // the seams, in the ball's own turned frame
      const rx = mid + (x - mid) * cos + (y - mid) * sin;
      const ry = mid - (x - mid) * sin + (y - mid) * cos;
      let color = look.rainbow
        ? `hsl(${Math.round(((rx + ry) * 22) % 360)}, 90%, ${x + y > 19 ? 48 : 60}%)`
        : x + y > 19 ? look.shade : look.main;
      if (Math.hypot(x - 5, y - 4.5) < 2) color = look.shine;
      const seam =
        Math.abs(rx - mid) < 0.6 ||
        Math.abs(ry - mid) < 0.6 ||
        Math.abs(Math.hypot(rx + 4, ry - mid) - 9.5) < 0.6 ||
        Math.abs(Math.hypot(rx - 19, ry - mid) - 9.5) < 0.6;
      if (seam) color = look.seam;
      if (d > 6.7) color = look.edge;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// One spinning set of frames for each kind of ball.
export function makeBallSprites() {
  const frames = (look) => Array.from({ length: BALL_FRAMES }, (_, i) => makeBallSprite((i / BALL_FRAMES) * Math.PI, look));
  return { [NORMAL]: frames(BALL_LOOKS[NORMAL]), [MONEY]: frames(BALL_LOOKS[MONEY]), [RAINBOW]: frames(BALL_LOOKS[RAINBOW]) };
}

// ---------- On the court ----------

export function drawShadow(ctx, u, v, rx, ry, alpha) {
  const p = project(u, v);
  ctx.fillStyle = `rgba(45, 20, 35, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawConfetti(ctx, confetti) {
  for (const c of confetti) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
    ctx.restore();
  }
}

// The announcer's call across the top: { text, color, age, big, duration }.
export function drawBanner(ctx, b) {
  if (!b) return;
  const pop = b.age < 0.12 ? 0.6 + (b.age / 0.12) * 0.55 : b.age < 0.22 ? 1.15 - ((b.age - 0.12) / 0.1) * 0.15 : 1;
  const fade = Math.min(1, (b.duration - b.age) / 0.3);
  ctx.save();
  ctx.font = `64px ${FONT}`;
  const width = ctx.measureText(b.text).width;
  const fit = Math.min(b.big ? 1.6 : 1, 1800 / width);
  ctx.translate(COURT_PX / 2, 120);
  ctx.scale(pop * fit, pop * fit);
  ctx.globalAlpha = fade;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#2b1622";
  ctx.strokeText(b.text, 0, 0);
  ctx.fillStyle = b.color;
  ctx.fillText(b.text, 0, 0);
  ctx.restore();
}

// Pulsing text (a bonus ball's name) above point p.
export function drawBadge(ctx, badge, p) {
  const pulse = 1 + 0.08 * Math.sin(performance.now() / 120);
  ctx.save();
  ctx.translate(p.x, p.y - 470);
  ctx.scale(pulse, pulse);
  ctx.font = `26px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#2b1622";
  ctx.strokeText(badge.text, 0, 0);
  ctx.fillStyle = badge.color;
  ctx.fillText(badge.text, 0, 0);
  ctx.restore();
}

// A blinking speech bubble with `text`, pointing down at point p.
export function drawHintBubble(ctx, text, p) {
  ctx.save();
  ctx.font = `34px ${FONT}`;
  const w = ctx.measureText(text).width + 56;
  const x = Math.max(w / 2 + 20, Math.min(COURT_PX - w / 2 - 20, p.x));
  const y = p.y - 520;
  const blink = 0.85 + 0.15 * Math.sin(performance.now() / 180);
  ctx.globalAlpha = blink;
  ctx.fillStyle = "rgba(43, 22, 34, 0.9)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 40, w, 80, 14);
  ctx.moveTo(p.x - 18, y + 40);
  ctx.lineTo(p.x, y + 66);
  ctx.lineTo(p.x + 18, y + 40);
  ctx.fill();
  ctx.fillStyle = "#ffe066";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 3);
  ctx.restore();
}

// Score popups rising and fading: { text, color, x, y, age }.
export function drawPopups(ctx, popups) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `48px ${FONT}`;
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#2b1622";
  for (const p of popups) {
    const y = p.y - p.age * 80;
    ctx.globalAlpha = Math.min(1, (1.2 - p.age) * 3);
    ctx.strokeText(p.text, p.x, y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, y);
  }
  ctx.globalAlpha = 1;
}

// ?debug: the rim, the backboard, the 3-point line and the room's floor edges.
export function drawCourtLines(ctx) {
  ctx.strokeStyle = "lime";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const p = project(RIM.u + Math.cos(a) * RIM_R, RIM.v + Math.sin(a) * RIM_R, RIM.z);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  }
  ctx.stroke();
  const corners = [
    [BOARD.u0, BOARD.z0], [BOARD.u1, BOARD.z0], [BOARD.u1, BOARD.z1], [BOARD.u0, BOARD.z1], [BOARD.u0, BOARD.z0],
  ];
  ctx.strokeStyle = "cyan";
  ctx.beginPath();
  corners.forEach(([u, z], i) => {
    const p = project(u, BOARD.v, z);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.strokeStyle = "yellow";
  ctx.beginPath();
  for (let i = 0; i <= 36; i++) {
    const a = (i / 36) * Math.PI;
    const r = threePointRadius(RIM.u + Math.cos(a), RIM.v + Math.sin(a));
    const p = project(RIM.u + Math.cos(a) * r, RIM.v + Math.sin(a) * r);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  }
  ctx.stroke();
  const room = [[0, 0], [ROOM_U, 0], [ROOM_U, ROOM_V], [0, ROOM_V], [0, 0]];
  ctx.strokeStyle = "red";
  ctx.beginPath();
  room.forEach(([u, v], i) => {
    const p = project(u, v);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  });
  ctx.stroke();
}

// ---------- Wall scoreboard ----------

const SEGMENTS = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];

function drawDigit(g, digit, x, y, w, h, t) {
  const half = h / 2;
  const rects = {
    a: [x + t, y, w - 2 * t, t],
    b: [x + w - t, y + t, t, half - 1.5 * t],
    c: [x + w - t, y + half + t / 2, t, half - 1.5 * t],
    d: [x + t, y + h - t, w - 2 * t, t],
    e: [x, y + half + t / 2, t, half - 1.5 * t],
    f: [x, y + t, t, half - 1.5 * t],
    g: [x + t, y + half - t / 2, w - 2 * t, t],
  };
  for (const [seg, r] of Object.entries(rects)) {
    g.fillStyle = SEGMENTS[digit].includes(seg) ? BOARD_ART.lit : BOARD_ART.unlit;
    g.fillRect(...r);
  }
}

function drawPanel(g, panel, value) {
  const [cx, cy, cw, ch] = panel.cover;
  g.fillStyle = BOARD_ART.face;
  g.fillRect(cx, cy, cw, ch);
  g.fillStyle = BOARD_ART.label;
  g.fillText(panel.label, ...panel.labelAt);

  const [wx, wy, ww, wh] = panel.window;
  g.fillStyle = BOARD_ART.window;
  g.fillRect(wx, wy, ww, wh);
  const digits = String(Math.min(999, value)).padStart(2, "0").split("").map(Number);
  const gap = digits.length > 2 ? 5 : 8;
  const w = digits.length > 2 ? 20 : 28;
  const h = 50;
  const total = digits.length * w + (digits.length - 1) * gap;
  digits.forEach((d, i) => drawDigit(g, d, wx + (ww - total) / 2 + i * (w + gap), wy + (wh - h) / 2, w, h, 6));
}

// The scoreboard on the wall, drawn into its own canvas (only when it changes) to lay over the
// court at BOARD_ART.area. Each side is [label, value], like ["SCORE", 12] and ["TIME", 45].
export function createWallScoreboard() {
  const canvas = document.createElement("canvas");
  canvas.width = BOARD_ART.area.w;
  canvas.height = BOARD_ART.area.h;
  return {
    canvas,
    draw([leftLabel, left], [rightLabel, right]) {
      const g = canvas.getContext("2d");
      const { origin, slope, area } = BOARD_ART;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, area.w, area.h);
      g.setTransform(1, slope, 0, 1, origin.x - area.x, origin.y - area.y);
      g.font = `16px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      drawPanel(g, { ...BOARD_ART.left, label: leftLabel }, left);
      drawPanel(g, { ...BOARD_ART.right, label: rightLabel }, right);
    },
  };
}

// ---------- Sprite sheets ----------

// Where the shoes are in each frame of a sprite sheet: for every frame, two [x, y] points (sprite pixels from the
// frame's corner) at the bottom middle of each shoe. Builder players have a colour map marking their shoe pixels
// (region 5), which is exact whatever colour the shoes are. Hand-made players don't, so their shoes are found by
// the lowest pixels in each column of the bottom of the frame, skipping warm colours so the ball and skin aren't
// mistaken for shoes. Cached per sheet.
const SHOES = 5;
const feetCache = new WeakMap();
export function shoesIn(sheet, meta, regions) {
  if (feetCache.has(sheet)) return feetCache.get(sheet);
  const c = document.createElement("canvas");
  c.width = sheet.width;
  c.height = sheet.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(sheet, 0, 0);
  const result = {};
  for (const [anim, frames] of Object.entries(meta.frames)) {
    result[anim] = frames.map(([sx, sy, w, h]) => {
      const px = g.getImageData(sx, sy, w, h).data;
      const isShoe = regions
        ? (x, y) => regions.data[((sy + y) * regions.width + sx + x) * 4] === SHOES
        : (x, y) => {
            const i = (y * w + x) * 4;
            const [r, gg, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
            return a >= 128 && !(r - b > 40 && r >= gg); // skip warm colours: ball, skin
          };
      const bottom = new Array(w).fill(-1);
      for (let x = 0; x < w; x++) {
        for (let y = h - 1; y >= h * 0.6; y--) {
          if (!isShoe(x, y)) continue;
          bottom[x] = y;
          break;
        }
      }
      // runs of columns that reach the bottom fifth of the frame
      const runs = [];
      for (let x = 0; x < w; x++) {
        if (bottom[x] < (regions ? 0 : h * 0.8)) continue;
        const run = runs.at(-1);
        if (run && x - run.x1 <= 2) run.x1 = x;
        else runs.push({ x0: x, x1: x });
      }
      let feet = runs.filter((r) => r.x1 - r.x0 >= 3).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0)).slice(0, 2);
      if (feet.length === 1) {
        const { x0, x1 } = feet[0], m = (x0 + x1) >> 1;
        feet = [{ x0, x1: m }, { x0: m + 1, x1 }];
      }
      if (!feet.length) return [[w * 0.35, h], [w * 0.65, h]];
      return feet
        .map(({ x0, x1 }) => [(x0 + x1) / 2, Math.max(...bottom.slice(x0, x1 + 1))])
        .sort((a, b) => a[0] - b[0]);
    });
  }
  feetCache.set(sheet, result);
  return result;
}
