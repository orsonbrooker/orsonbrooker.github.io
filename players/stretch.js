// Height and build for a kid made from their own videos: each frame gets rows doubled (or taken out)
// between the top of the jersey and the feet, and columns across the jersey. The number and team name are
// drawn on first, so they stretch with the jersey; the held ball moves with the hands but keeps its size.
// Returns a new sheet: { meta, img } with no prints, and `meta.feet`: where the shoes are in each frame (from
// the region map, moved with the stretch), since the stretched sheet has no region map of its own.

import { regionFeet } from "../engine/draw.js";

// How far each goes at 1 (or -1): a share of the height, and of the jersey's width.
const HEIGHT_STEP = 0.06;
const BULK_STEP = 0.1;
const JERSEY = 3; // in the region map
const W = 4096; // the new sheet's width

// Which source row (or column) each output one shows, with `n` extra (or, below zero, fewer) spread
// evenly between `from` and `to`; and `fwd`, where a source position lands.
function stretch(size, n, from, to) {
  const map = [];
  const span = Math.max(1, to - from);
  const at = new Set();
  for (let i = 0; i < Math.abs(n); i++) at.add(Math.round(from + ((i + 0.5) * span) / Math.abs(n)));
  for (let s = 0; s < size; s++) {
    if (n < 0 && at.has(s)) continue;
    map.push(s);
    if (n > 0 && at.has(s)) map.push(s);
  }
  const first = new Array(size).fill(-1);
  for (let i = map.length - 1; i >= 0; i--) first[map[i]] = i;
  const fwd = new Array(size + 1);
  let o = map.length;
  for (let s = size; s >= 0; s--) {
    const i = s < size ? first[s] : -1;
    if (i >= 0) o = i;
    fwd[s] = s === size ? map.length : o;
  }
  return { map, fwd: (v) => fwd[Math.max(0, Math.min(size, Math.round(v)))] + (v - Math.round(v)) };
}

// Draws `map` (which source row or column each output one shows) in as few strips as it takes.
function runs(map) {
  const out = [];
  for (let i = 0; i < map.length; i++) {
    const last = out[out.length - 1];
    if (last && map[i] === last.src + last.n && i === last.at + last.n) last.n++;
    else out.push({ src: map[i], at: i, n: 1 });
  }
  return out;
}

// Where the jersey is in a frame (from the region map): its top row and left and right columns.
function jerseyBox(regions, x, y, w, h) {
  if (!regions) return null;
  const d = regions.data, rw = regions.width;
  let top = -1, left = w, right = -1;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++)
      if (d[((y + py) * rw + x + px) * 4] === JERSEY) {
        if (top < 0) top = py;
        if (px < left) left = px;
        if (px > right) right = px;
      }
  return top < 0 ? null : { top, left, right };
}

// A frame's jersey box and feet, from the region map: they don't change with the height or build, so kept for
// each region map (the builder re-stretches the same sheet at each step).
const partsCache = new WeakMap(); // region map -> Map(frame's place -> { j, feet })
function frameParts(regions, x, y, w, h) {
  if (!regions) return { j: null, feet: null };
  let known = partsCache.get(regions);
  if (!known) partsCache.set(regions, (known = new Map()));
  const key = `${x},${y},${w},${h}`;
  if (!known.has(key)) known.set(key, { j: jerseyBox(regions, x, y, w, h), feet: regionFeet(regions, [x, y, w, h]) });
  return known.get(key);
}

// One frame at a size: the frame [x, y, w, h, ox] drawn from `src` at (sx, sy) (and its print, if any),
// with the region map read at the frame's own place. Returns { canvas, w, h, dx (columns added left of
// the feet), dy (rows added), ball } for a held ball at [x, y, r] in the frame.
export function stretchFrame(src, [sx, sy], regions, [x, y, w, h, ox], build = {}, { print, ball } = {}) {
  const height = Math.max(-1, Math.min(1, +build.height || 0));
  const bulk = Math.max(-1, Math.min(1, +build.bulk || 0));
  const one = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g1 = one.getContext("2d");
  g1.drawImage(src, sx, sy, w, h, 0, 0, w, h);
  if (print) g1.drawImage(print, 0, 0, print.width, print.height, 0, 0, w, h);
  const { j, feet } = frameParts(regions, x, y, w, h);
  const top = j ? j.top : Math.round(h * 0.36);
  const rowFit = stretch(h, Math.round(height * HEIGHT_STEP * h), top, h - 6);
  const rows = rowFit.map;
  const [l, r] = j ? [j.left, j.right] : [Math.round(w * 0.28), Math.round(w * 0.72)];
  const colFit = stretch(w, Math.round(bulk * BULK_STEP * (r - l + 1) * 2), l, r);
  const cols = colFit.map;
  const tall = Object.assign(document.createElement("canvas"), { width: w, height: rows.length });
  const gt = tall.getContext("2d");
  for (const s of runs(rows)) gt.drawImage(one, 0, s.src, w, s.n, 0, s.at, w, s.n);
  const out = Object.assign(document.createElement("canvas"), { width: cols.length, height: rows.length });
  const go = out.getContext("2d");
  for (const s of runs(cols)) go.drawImage(tall, s.src, 0, s.n, rows.length, s.at, 0, s.n, rows.length);
  // the feet stay where they stand: how far they moved right (columns added to their left), and down
  return {
    canvas: out,
    w: cols.length,
    h: rows.length,
    dx: colFit.fwd(-ox) + ox,
    dy: rows.length - h,
    ball: ball && [colFit.fwd(ball[0]), rowFit.fwd(ball[1]), ball[2]],
    feet: feet && feet.map(([fx, fy]) => [colFit.fwd(fx), rowFit.fwd(fy)]),
  };
}

export function stretchSheet({ meta, img, prints }, regions, build = {}) {
  const height = Math.max(-1, Math.min(1, +build.height || 0));
  const bulk = Math.max(-1, Math.min(1, +build.bulk || 0));
  if (!height && !bulk) return { meta, img, prints };

  // each frame once, however many moves use it
  const rects = new Map();
  for (const list of Object.values(meta.frames)) for (const f of list) rects.set(`${f[0]},${f[1]},${f[2]},${f[3]}`, f);
  const made = new Map(); // key -> stretchFrame's result
  for (const [key, f] of rects) {
    const [x, y] = f;
    made.set(key, stretchFrame(img, [x, y], regions, f, { height, bulk }, { print: prints?.get(`${x},${y}`), ball: meta.balls?.[`${x},${y}`] }));
  }

  // packed in shelves on a new sheet
  let px = 0, py = 0, shelf = 0;
  const at = new Map();
  for (const [key, m] of made) {
    if (px + m.w > W) {
      px = 0;
      py += shelf + 1;
      shelf = 0;
    }
    at.set(key, [px, py]);
    px += m.w + 1;
    shelf = Math.max(shelf, m.h);
  }
  const sheet = Object.assign(document.createElement("canvas"), { width: W, height: py + shelf + 1 });
  const gs = sheet.getContext("2d");
  for (const [key, m] of made) gs.drawImage(m.canvas, ...at.get(key));

  const balls = {};
  const feet = {};
  for (const [key, m] of made) {
    if (m.ball) balls[at.get(key).join(",")] = m.ball;
    if (m.feet) feet[at.get(key).join(",")] = m.feet;
  }
  const frames = {};
  for (const [anim, list] of Object.entries(meta.frames))
    frames[anim] = list.map((f) => {
      const key = `${f[0]},${f[1]},${f[2]},${f[3]}`;
      const m = made.get(key);
      return [...at.get(key), m.w, m.h, f[4] - m.dx, f[5] - m.dy];
    });
  // the ball leaves the hands higher (or lower) and further out with them
  const ky = 1 + height * HEIGHT_STEP, kx = 1 + bulk * BULK_STEP;
  const move = ([x, y]) => [Math.round(x * kx), Math.round(y * ky)];
  const releaseOffsets = meta.releaseOffsets && Object.fromEntries(Object.entries(meta.releaseOffsets).map(([k, v]) => [k, move(v)]));
  const releaseOffset = meta.releaseOffset && move(meta.releaseOffset);
  return { meta: { ...meta, frames, balls, feet, releaseOffsets, releaseOffset, printsFrom: undefined }, img: sheet, prints: null };
}
