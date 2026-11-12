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

export const BALL_PX = 24; // the sprite's size: enough pixels for round shading and thin seams

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hsl = (h, s, l) => {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
};

// A basketball's seams: one line round its middle, one over the top, and a curved seam on each side
// (parallel to the one over the top). Seen turned a little, so those curve like ( and ), as in the art.
const TURNED = 0.55; // radians about the vertical
const SIDE_SEAM = 0.68; // where the side seams sit, across the ball (0 middle, 1 edge)
const LIGHT = (() => {
  const l = [-0.4, -0.5, 0.77];
  const n = Math.hypot(...l);
  return l.map((v) => v / n);
})();

// look: the ball's colours (BALL_LOOKS in content/looks.js, or a ball style from shared/shop.js).
// With `panels`, three stripes that turn with the seams; `rainbow`, colours that run round it.
// Shaded like a sphere lit from the top left, in a few flat tones (pixel art, no blur): the shine
// colour toward the light, the main colour, the shade, and the edge colour round the dark side,
// with a thin outline. The seams are drawn on the sphere, so they curve and turn as it spins.
function makeBallSprite(turn, look = BALL_LOOKS[NORMAL]) {
  const size = BALL_PX;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const mid = (size - 1) / 2;
  const R = size / 2 - 0.5;
  const seamW = 0.62 / R; // half a seam's width: lines about a pixel wide
  const edge = rgb(look.edge);
  const seamC = rgb(look.seam);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - mid) / R, ny = (y - mid) / R;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) continue;
      const nz = Math.sqrt(1 - r2);
      // the light, flattened into four tones
      const lit = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      // the point on the ball's own surface, the ball turned (and spinning) about its vertical axis
      const a = TURNED + turn;
      const px = nx * Math.cos(a) + nz * Math.sin(a);
      const py = ny;
      let base, light, dark;
      if (look.rainbow) {
        const hue = ((Math.atan2(py, px) / Math.PI) * 180 + 360) % 360;
        base = hsl(hue, 0.85, 0.55);
        light = hsl(hue, 0.9, 0.72);
        dark = hsl(hue, 0.8, 0.38);
      } else if (look.panels) {
        base = rgb(look.panels[py < -0.33 ? 0 : py < 0.33 ? 1 : 2]);
        light = mixRgb(base, [255, 255, 255], 0.35);
        dark = mixRgb(base, [0, 0, 0], 0.3);
      } else {
        base = rgb(look.main);
        light = rgb(look.shine);
        dark = rgb(look.shade);
      }
      let col = lit > 0.86 ? mixRgb(base, light, 0.55) : lit > 0.42 ? base : lit > 0.16 ? dark : mixRgb(dark, edge, 0.4);
      // a small highlight where the light hits straight on
      if (lit > 0.985) col = rgb(look.shine);
      // the seams, each about a pixel wide on screen: how fast px changes across the screen here
      const zs = Math.max(nz, 0.2);
      const grad = Math.min(3, Math.hypot(Math.cos(a) - (Math.sin(a) * nx) / zs, (Math.sin(a) * ny) / zs));
      const w = seamW * grad;
      const middle = Math.abs(py - 0.5 / R) < 0.5 / R; // the row just under the centre, one pixel
      const seam = middle || Math.abs(px) < w || Math.abs(Math.abs(px) - SIDE_SEAM) < w;
      if (seam) col = mixRgb(seamC, edge, lit > 0.42 ? 0 : 0.5);
      // the outline
      if (r2 > ((R - 1) / R) ** 2) col = edge;
      const i = (y * size + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// One spinning set of frames for a look.
export const makeBallFrames = (look) => Array.from({ length: BALL_FRAMES }, (_, i) => makeBallSprite((i / BALL_FRAMES) * Math.PI, look));

// One spinning set of frames for each kind of ball. `normal`: the look of an everyday ball (their ball
// style from the shop); money and rainbow balls always look the same, so they stand out.
export function makeBallSprites(normal = BALL_LOOKS[NORMAL]) {
  return { [NORMAL]: makeBallFrames(normal), [MONEY]: makeBallFrames(BALL_LOOKS[MONEY]), [RAINBOW]: makeBallFrames(BALL_LOOKS[RAINBOW]) };
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
