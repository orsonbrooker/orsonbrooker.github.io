// Layered players: one shared moving body (Orson's, made from video, with his head taken off) plus a
// head chosen from a list, at a chosen build, put together once when the player loads.
//
//   assets/characters/rig/       body.png and rig.json: every frame of the body, and where the head
//                                goes in each (tools/pixelart/rig.py)
//   assets/characters/heads/     a head per style (five facings, normal and looking up), and index.json listing them
//                                (tools/pixelart/heads.py, from art/heads/head-<style>.png)
//
// The result is a sheet just like a pixel-art sheet made from video (frames, jersey faces for the
// number and team name, the palette), so recolouring and printing work the same way
// (players/pixelkit.js). Drawing it costs the same as any other player: the layers are only put
// together here.

import { loadImage } from "../play/players.js";

const RIG = "assets/characters/rig/";
const HEADS = "assets/characters/heads/";

// How far the build can go: height (taller or shorter) and bulk (wider or thinner), each from -1 to 1.
const HEIGHT_STEP = 0.06; // a share of his height at 1
const BULK_STEP = 0.1; // a share of his width at 1
const PAD = 1; // clear pixels round each frame

let rigLoading = null;
let headsLoading = null;

function pixels(img) {
  const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

function loadRig(v) {
  rigLoading ??= Promise.all([fetch(`${RIG}rig.json?v=${v}`).then((r) => r.json()), loadImage(`${RIG}body.png?v=${v}`)]).then(([meta, img]) => ({ meta, body: pixels(img) }));
  rigLoading.catch(() => (rigLoading = null));
  return rigLoading;
}

// The heads list: { rig: body version, styles: { style: { views: { f: [x, y, w, h], ... }, v } } }.
function loadIndex() {
  headsLoading ??= fetch(HEADS + "index.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((i) => i ?? { styles: {} });
  return headsLoading;
}

// The head styles there are, by name.
export const loadHeads = () => loadIndex().then((i) => i.styles);

// Which source row (or column) each output row comes from, with `n` extra (or, below zero, fewer)
// spread evenly between `from` and `to`.
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
  // where each source row lands (the first output row showing it, or the next one)
  const fwd = new Array(size + 1);
  let o = map.length;
  for (let s = size; s >= 0; s--) {
    const i = map.indexOf(s);
    if (i >= 0) o = i;
    fwd[s] = s === size ? map.length : o;
  }
  return { map, fwd: (v) => fwd[Math.max(0, Math.min(size, Math.round(v)))] + (v - Math.round(v)) };
}

// Puts a player together: `head` (a style from the heads list), `build` ({ height, bulk }, each -1..1).
// Returns { meta, img } for the game's sheet, before recolouring.
export async function buildPlayer({ head, build = {} }) {
  const index = await loadIndex();
  const { meta: rig, body } = await loadRig(index.rig ?? "");
  const style = index.styles[head];
  const headImg = style ? pixels(await loadImage(`${HEADS}${head}.png?v=${style.v ?? ""}`)) : null;
  const height = Math.max(-1, Math.min(1, +build.height || 0));
  const bulk = Math.max(-1, Math.min(1, +build.bulk || 0));

  // every distinct frame once, then laid out in rows
  const cells = new Map();
  for (const list of Object.values(rig.frames))
    for (const f of list) {
      const key = `${f[0]},${f[1]}`;
      if (cells.has(key)) continue;
      const [x, y, w, h, ox, oy] = f;
      const spot = rig.heads.frames[key]; // [facing, middle of his hair x, y, "up" in a shot]
      // the build: rows added or taken from below his neck to above his feet, columns across his middle
      const neck = spot ? spot[2] + 8 : h * 0.3;
      const rows = stretch(h, Math.round(height * HEIGHT_STEP * h), neck, h - 6);
      const mid = spot ? spot[1] : -ox;
      const half = w * 0.22;
      const cols = stretch(w, Math.round(bulk * BULK_STEP * w), mid - half, mid + half);
      // where the head goes, in the stretched frame
      let view = null;
      if (spot && style) {
        // the view: its facing (left ones flipped from right ones), looking up in a shot if the head has it
        const [facing, cx, cy, pose] = spot;
        const base = rig.heads.mirror[facing] ?? facing;
        const name = pose === "up" && style.views[`up-${base}`] ? `up-${base}` : base;
        const c = rig.heads.cells[name];
        const v = style.views[name];
        if (c && v) {
          const flip = base !== facing;
          const nx = cols.fwd(cx), ny = rows.fwd(cy);
          view = { v, flip, x: Math.round(flip ? nx - c.ox - v[2] : nx + c.ox), y: Math.round(ny + c.oy) };
        }
      }
      const W = cols.map.length, H = rows.map.length;
      const left = Math.min(0, view ? view.x : 0), top = Math.min(0, view ? view.y : 0);
      const right = Math.max(W, view ? view.x + view.v[2] : 0);
      cells.set(key, {
        src: [x, y, w, h], rows, cols, view,
        dx: PAD - left, dy: PAD - top, // where the stretched frame sits in its cell
        w: right - left + 2 * PAD, h: H - top + PAD, // nothing below his feet
        feet: [cols.fwd(-ox), rows.fwd(-oy)],
      });
    }
  const SHEET_W = 2048;
  let px = 0, py = 0, rowH = 0;
  for (const c of cells.values()) {
    if (px + c.w > SHEET_W) [px, py, rowH] = [0, py + rowH, 0];
    [c.x, c.y] = [px, py];
    px += c.w;
    rowH = Math.max(rowH, c.h);
  }
  const sheetH = py + rowH;
  const canvas = Object.assign(document.createElement("canvas"), { width: SHEET_W, height: sheetH });
  const g = canvas.getContext("2d");
  const out = g.createImageData(SHEET_W, sheetH);
  const o = out.data, b = body.data, bw = body.width;
  for (const c of cells.values()) {
    const [sx, sy] = c.src;
    // the body, stretched
    c.rows.map.forEach((r, oy) => {
      const ty = c.y + c.dy + oy;
      c.cols.map.forEach((col, ox) => {
        const si = ((sy + r) * bw + sx + col) * 4;
        if (!b[si + 3]) return;
        const ti = (ty * SHEET_W + c.x + c.dx + ox) * 4;
        o[ti] = b[si];
        o[ti + 1] = b[si + 1];
        o[ti + 2] = b[si + 2];
        o[ti + 3] = 255;
      });
    });
    // the head, under the body (his shoulders, arms and the ball stay in front)
    if (c.view) {
      const [vx, vy, vw, vh] = c.view.v;
      const hd = headImg.data, hw = headImg.width;
      for (let yy = 0; yy < vh; yy++)
        for (let xx = 0; xx < vw; xx++) {
          const si = ((vy + yy) * hw + vx + (c.view.flip ? vw - 1 - xx : xx)) * 4;
          if (!hd[si + 3]) continue;
          const tx = c.x + c.dx + c.view.x + xx, ty = c.y + c.dy + c.view.y + yy;
          if (tx < c.x || ty < c.y || tx >= c.x + c.w || ty >= c.y + c.h) continue;
          const ti = (ty * SHEET_W + tx) * 4;
          if (o[ti + 3]) continue;
          o[ti] = hd[si];
          o[ti + 1] = hd[si + 1];
          o[ti + 2] = hd[si + 2];
          o[ti + 3] = 255;
        }
    }
  }
  // A short gap between the new head's neck and his shoulders (the new neck ends a little higher than
  // his did): filled down from the neck.
  for (const c of cells.values()) {
    if (!c.view) continue;
    const vh = c.view.v[3];
    const y0 = c.y + c.dy + c.view.y + Math.floor(vh * 0.5);
    const y1 = Math.min(c.y + c.h - 1, c.y + c.dy + c.view.y + vh + 6);
    for (let x = c.x; x < c.x + c.w; x++) {
      for (let y = y0; y < y1; y++) {
        const i = (y * SHEET_W + x) * 4;
        if (!o[i + 3] || o[i + 4 * SHEET_W + 3]) continue;
        // a solid pixel with a clear run under it: how long, and is there something solid below?
        let n = 1;
        while (n <= 4 && y + n < y1 + 4 && !o[i + n * 4 * SHEET_W + 3]) n++;
        if (n > 4 || y + n >= c.y + c.h || !o[i + n * 4 * SHEET_W + 3]) continue;
        for (let k = 1; k < n; k++) o.copyWithin(i + k * 4 * SHEET_W, i, i + 4);
      }
    }
  }
  // Pinholes where his own head came off and the new one doesn't quite reach (by the chin): a clear
  // pixel with solid pixels on nearly every side takes the colour below it, or beside it.
  for (const c of cells.values()) {
    if (!c.view) continue;
    for (let y = c.y + 1; y < c.y + c.h - 1; y++)
      for (let x = c.x + 1; x < c.x + c.w - 1; x++) {
        const i = (y * SHEET_W + x) * 4;
        if (o[i + 3]) continue;
        let solid = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dy || dx) && o[i + (dy * SHEET_W + dx) * 4 + 3]) solid++;
        if (solid < 6) continue;
        const from = [SHEET_W, -1, 1, -SHEET_W].map((d) => i + d * 4).find((j) => o[j + 3]);
        o.copyWithin(i, from, from + 4);
      }
  }
  g.putImageData(out, 0, 0);

  // the sheet's description, moved to the new places
  const at = (key) => cells.get(key);
  const frames = {};
  for (const [name, list] of Object.entries(rig.frames))
    frames[name] = list.map((f) => {
      const c = at(`${f[0]},${f[1]}`);
      return [c.x, c.y, c.w, c.h, -(c.dx + c.feet[0]), -(c.dy + c.feet[1])];
    });
  const faces = {};
  for (const [key, [rows, ...pts]] of Object.entries(rig.faces ?? {})) {
    const c = at(key);
    if (!c) continue;
    const [sx, sy] = c.src;
    const moved = [];
    for (let i = 0; i < pts.length; i += 2) moved.push(c.x + c.dx + c.cols.fwd(pts[i] - sx), c.y + c.dy + c.rows.fwd(pts[i + 1] - sy));
    faces[`${c.x},${c.y}`] = [rows, ...moved];
  }
  const tall = 1 + height * HEIGHT_STEP;
  const scaled = (p) => (p ? [p[0], Math.round(p[1] * tall)] : p);
  const meta = {
    ...rig,
    frames,
    faces,
    prints: undefined,
    heads: undefined,
    releaseOffset: scaled(rig.releaseOffset),
    releaseOffsets: Object.fromEntries(Object.entries(rig.releaseOffsets ?? {}).map(([d, p]) => [d, scaled(p)])),
  };
  return { meta, img: canvas };
}
