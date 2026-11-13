// Gear on a kid made from video (a hat, a hoodie, high-tops): a layer drawn over their frames, never part
// of the body, so any item goes on any kid and comes off again. Each item is made per kid by
// tools/pixelart/gear_key.py: its own pixels for each frame (assets/characters/gear/<item>/<kid>.webp), a
// part map (gear1 and gear2, recoloured from their light and shade like hair) and which body pixels it
// hides (hair under a hat). content/gear.json lists the items: their slot, which of the player's colours
// gear1 and gear2 take (a second colour too close to the first is swapped for the item's `contrast` colour,
// or white or near-black, so flames on a shoe always show), whether an item goes over the held ball (arms) and whether the number and team
// name print over it (a striped jersey) or it covers them (a hoodie).
//
// wearGear() gives a new sheet with the items on: frames grow where an item reaches outside them (a
// beanie's pom-pom), so the sheet is repacked, with the region map, the held balls and the frame offsets
// moved to match, ready for stretchSheet() (height and build).

import GEAR from "../content/gear.json";

export { GEAR };
// drawn bottom first: a hoodie under wristbands, a hat over goggles' strap
const ORDER = ["jersey", "legs", "shoes", "arms", "face", "head"];
const W = 4096; // the new sheet's width

/** The items worn, one per slot, in drawing order: from { slot: id } or a list of ids. */
export function wornItems(gear) {
  const bySlot = new Map();
  for (const id of Array.isArray(gear) ? gear : Object.values(gear ?? {})) if (GEAR[id]) bySlot.set(GEAR[id].slot, id);
  return [...bySlot.values()].sort((a, b) => ORDER.indexOf(GEAR[a].slot) - ORDER.indexOf(GEAR[b].slot));
}

// The slots in the order the builder shows them: shoes first (everyone has shoes), then top to bottom.
export const SLOTS = [
  ["shoes", "Shoes"],
  ["head", "Head"],
  ["face", "Face"],
  ["jersey", "Jersey"],
  ["arms", "Arms"],
  ["legs", "Legs"],
];

/** The items made for a kid, by slot: { slot: [id, ...] }, in content/gear.json's order. */
export async function madeFor(kid, root = "/") {
  const made = await loadIndex(root);
  const out = {};
  for (const [id, info] of Object.entries(GEAR)) if (made[id]?.[kid]) (out[info.slot] ??= []).push(id);
  return out;
}

// Where on the body each slot's picture looks: a band of the frame's height, top to bottom.
const ZONE = { head: [0, 0.34], face: [0.08, 0.32], jersey: [0.22, 0.62], arms: [0.2, 0.62], legs: [0.55, 1], shoes: [0.74, 1] };

/**
 * A picture of an item for the builder: the kid wearing it in a frame where it shows well, cropped to where
 * it's worn (the feet for shoes, the head for a hat), scaled up sharp. frameOf(rect) gives that frame of
 * the kid in their colours; meta is the body sheet's.
 */
export function itemArt(layer, colours, size, frameOf, meta) {
  const c = Object.assign(document.createElement("canvas"), { width: size, height: size });
  layer.best ??= bestPiece(layer, meta);
  const key = layer.best && Object.keys(layer.meta.frames).find((k) => layer.meta.frames[k] === layer.best);
  const rect = key && Object.values(meta.frames).flat().find((f) => `${f[0]},${f[1]}` === key);
  if (!rect) return c;
  const [, , w, h] = rect;
  const piece = layer.best;
  const left = Math.min(0, piece[4]), top = Math.min(0, piece[5]);
  const fw = Math.max(w, piece[4] + piece[2]) - left, fh = Math.max(h, piece[5] + piece[3]) - top;
  const one = Object.assign(document.createElement("canvas"), { width: fw, height: fh });
  const g1 = one.getContext("2d", { willReadFrequently: true });
  g1.drawImage(frameOf(rect.slice(0, 4)), -left, -top);
  const data = g1.getImageData(0, 0, fw, fh);
  hide(layer, piece, data.data, fw, fh, piece[4] - left, piece[5] - top);
  paint(layer, piece, tintsOf(layer, colours), data.data, fw, fh, piece[4] - left, piece[5] - top);
  g1.putImageData(data, 0, 0);
  // the band where it's worn, widened to the drawn pixels in it, as a square
  const [z0, z1] = ZONE[layer.info.slot] ?? [0, 1];
  const y0 = Math.floor(-top + h * z0), y1 = Math.ceil(-top + h * z1);
  let l = fw, r = -1;
  for (let y = Math.max(0, y0); y < Math.min(fh, y1); y++)
    for (let x = 0; x < fw; x++)
      if (data.data[(y * fw + x) * 4 + 3] > 127) {
        if (x < l) l = x;
        if (x > r) r = x;
      }
  if (r < 0) return c;
  const bw = r - l + 1, bh = y1 - y0;
  const side = Math.max(bw, bh) + 4;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(one, l - (side - bw) / 2, y0 - (side - bh) / 2, side, side, 0, 0, size, size);
  return c;
}

// A well-shown, typical piece: three quarters of the way up the pieces by size (the biggest are often
// odd ones); for an item with its own contrast colour, only pieces where that colour is a usual share.
// Facing us, in a calm move: these frames come first.
const SHOW = ["dribble-fr", "dribble-fl", "idle", "start-fr", "start-fl", "jog-fr", "jog-fl", "dribble"];
function bestPiece(layer, meta) {
  const art = layer.art.data, part = layer.part.data, aw = layer.art.width;
  const rows = [];
  const front = new Set(SHOW.flatMap((a) => (meta.frames[a] ?? []).map((f) => `${f[0]},${f[1]}`)));
  const shown = Object.entries(layer.meta.frames).filter(([k]) => front.has(k));
  for (const [, p] of shown.length ? shown : Object.entries(layer.meta.frames)) {
    const [ax, ay, w, h] = p;
    let n = 0, second = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = ((ay + y) * aw + ax + x) * 4;
        if (art[i + 3] > 127) {
          n++;
          if (part[i] === 2) second++;
        }
      }
    if (n) rows.push({ p, n, share: second / n });
  }
  let pool = rows;
  if (layer.info.contrast) {
    const ok = rows.filter((r) => r.share > 0.1 && r.share < 0.4);
    if (ok.length) pool = ok;
  }
  pool.sort((a, b) => a.n - b.n);
  return pool[Math.floor(pool.length * 0.75)]?.p ?? null;
}

/** { slot: id } from a test link's "beanie,stripes". */
export function gearParam(text) {
  const out = {};
  for (const id of (text ?? "").split(",")) if (GEAR[id.trim()]) out[GEAR[id.trim()].slot] = id.trim();
  return out;
}

const indexes = new Map(); // "" (full size) or a size's name -> { item: { kid: stamp } }
const loadIndex = (root, size = null) => {
  const file = `${root}assets/characters/gear/index${size ? `@${size}` : ""}.json`;
  if (!indexes.has(file)) indexes.set(file, fetch(file).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  return indexes.get(file);
};

function image(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}

function pixels(img) {
  const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

const layers = new Map();
/** The layers for what a kid wears (only items made for that kid), loaded once each. */
// `size`: a smaller size's layers (tools/pixelart/sheet_sizes.py; null for full), for a kid drawn from that size of sheet.
export async function loadGear(kid, gear, root = "/", size = null) {
  const made = await loadIndex(root, size);
  const items = wornItems(gear).filter((id) => made[id]?.[kid]);
  return Promise.all(
    items.map((id) => {
      const key = `${id}/${kid}${size ? `@${size}` : ""}`;
      if (!layers.has(key)) {
        const at = `${root}assets/characters/gear/${id}/${kid}${size ? `@${size}` : ""}`;
        const v = `?v=${made[id][kid]}`;
        const p = Promise.all([image(`${at}.webp${v}`), image(`${at}.png${v}`), fetch(`${at}.json${v}`).then((r) => r.json())]).then(
          ([art, part, meta]) => ({ id, info: GEAR[id], art: pixels(art), part: pixels(part), meta }),
        );
        p.catch(() => layers.delete(key));
        layers.set(key, p);
      }
      return layers.get(key);
    }),
  );
}

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

// An item's two colours from the player's: { 1: { rgb, ref }, 2: ... }. A second colour that wouldn't show
// against the first takes the item's contrast colour instead.
function tintsOf(layer, colours) {
  const [a, b] = layer.info.colours.map((name) => (colours[name] ? hex(colours[name]) : null));
  const t = {};
  if (a) t[1] = { rgb: a, ref: layer.meta.refs.gear1 ?? 150 };
  if (b) {
    const close = a && Math.abs(luma(a) - luma(b)) < 60 && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 140;
    const swap = layer.info.contrast ? hex(layer.info.contrast) : luma(a) > 128 ? [43, 43, 47] : [242, 242, 239];
    t[2] = { rgb: close ? swap : b, ref: layer.meta.refs.gear2 ?? 150 };
  }
  return t;
}

// One item's piece onto a frame's pixels (d, w wide), its corner at (px, py): first the body pixels it
// hides, then its own, the key parts in the player's colours.
function hide(layer, piece, d, w, h, px, py) {
  const [ax, ay, pw, ph] = piece;
  const part = layer.part.data, pw0 = layer.part.width;
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      if (part[((ay + y) * pw0 + ax + x) * 4 + 1] < 128) continue;
      const tx = px + x, ty = py + y;
      if (tx >= 0 && ty >= 0 && tx < w && ty < h) d[(ty * w + tx) * 4 + 3] = 0;
    }
}

function paint(layer, piece, tints, d, w, h, px, py) {
  const [ax, ay, pw, ph] = piece;
  const art = layer.art.data, part = layer.part.data, aw = layer.art.width;
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const i = ((ay + y) * aw + ax + x) * 4;
      if (art[i + 3] < 128) continue;
      const tx = px + x, ty = py + y;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const o = (ty * w + tx) * 4;
      const tint = tints[part[i]];
      if (tint) {
        // lighter or darker than the stored mid-tone: the colour scaled down, or blended toward white
        const k = art[i] / tint.ref;
        for (let c = 0; c < 3; c++) d[o + c] = k <= 1 ? tint.rgb[c] * k : Math.min(255, tint.rgb[c] + (255 - tint.rgb[c]) * (k - 1) * 0.6);
      } else for (let c = 0; c < 3; c++) d[o + c] = art[i + c];
      d[o + 3] = 255;
    }
}

/**
 * The sheet with the gear on. sheet: { meta, img, prints, regions } (regions: the region map's
 * ImageData, at the sheet's places); worn: from loadGear(); colours: the player's (each item takes the
 * ones its entry names). Returns the same shape, repacked, with the prints drawn in.
 */
export function wearGear({ meta, img, prints, regions }, worn, colours) {
  if (!worn.length) return { meta, img, prints, regions };
  const tints = worn.map((layer) => tintsOf(layer, colours));
  const regionCanvas = Object.assign(document.createElement("canvas"), { width: regions.width, height: regions.height });
  // read back into a CPU canvas below, so kept on the CPU too (else every frame drawn is a GPU readback)
  regionCanvas.getContext("2d", { willReadFrequently: true }).putImageData(regions, 0, 0);

  const rects = new Map();
  for (const list of Object.values(meta.frames)) for (const f of list) rects.set(`${f[0]},${f[1]},${f[2]},${f[3]}`, f);
  const made = new Map();
  for (const [key, [x, y, w, h]] of rects) {
    const pieces = worn.map((l) => l.meta.frames[`${x},${y}`]);
    let left = 0, top = 0, right = w, bottom = h;
    for (const p of pieces) {
      if (!p) continue;
      left = Math.min(left, p[4]);
      top = Math.min(top, p[5]);
      right = Math.max(right, p[4] + p[2]);
      bottom = Math.max(bottom, p[5] + p[3]);
    }
    const fw = right - left, fh = bottom - top;
    const c = Object.assign(document.createElement("canvas"), { width: fw, height: fh });
    const g = c.getContext("2d", { willReadFrequently: true });
    let data;
    if (img.pixels) {
      // the sheet's own pixels, when recolor() left them on it: copied row by row (drawing a GPU canvas into
      // this one would read the whole sheet back from the GPU, for every frame)
      data = new ImageData(fw, fh);
      const src = img.pixels;
      for (let yy = 0; yy < h; yy++) data.data.set(src.data.subarray(((y + yy) * src.width + x) * 4, ((y + yy) * src.width + x + w) * 4), ((yy - top) * fw - left) * 4);
    } else {
      g.drawImage(img, x, y, w, h, -left, -top, w, h);
      data = g.getImageData(0, 0, fw, fh);
    }
    for (let i = 0; i < worn.length; i++) if (pieces[i]) hide(worn[i], pieces[i], data.data, fw, fh, pieces[i][4] - left, pieces[i][5] - top);
    const print = prints?.get(`${x},${y}`);
    const under = (i) => worn[i].info.print === "over"; // the number prints over it
    for (let i = 0; i < worn.length; i++) if (pieces[i] && under(i)) paint(worn[i], pieces[i], tints[i], data.data, fw, fh, pieces[i][4] - left, pieces[i][5] - top);
    if (print) {
      g.putImageData(data, 0, 0);
      g.drawImage(print, 0, 0, print.width, print.height, -left, -top, w, h);
      data = g.getImageData(0, 0, fw, fh);
    }
    for (let i = 0; i < worn.length; i++) if (pieces[i] && !under(i)) paint(worn[i], pieces[i], tints[i], data.data, fw, fh, pieces[i][4] - left, pieces[i][5] - top);
    g.putImageData(data, 0, 0);
    made.set(key, { canvas: c, x, y, w, h, left, top, fw, fh });
  }

  let px = 0, py = 0, shelf = 0;
  const at = new Map();
  for (const [key, m] of made) {
    if (px + m.fw > W) {
      px = 0;
      py += shelf + 1;
      shelf = 0;
    }
    at.set(key, [px, py]);
    px += m.fw + 1;
    shelf = Math.max(shelf, m.fh);
  }
  const H = py + shelf + 1;
  const sheet = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gs = sheet.getContext("2d");
  const regionOut = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gr = regionOut.getContext("2d", { willReadFrequently: true });
  const balls = {};
  for (const [key, m] of made) {
    const [ax, ay] = at.get(key);
    gs.drawImage(m.canvas, ax, ay);
    gr.drawImage(regionCanvas, m.x, m.y, m.w, m.h, ax - m.left, ay - m.top, m.w, m.h);
    const ball = meta.balls?.[`${m.x},${m.y}`];
    if (ball) balls[`${ax},${ay}`] = [ball[0] - m.left, ball[1] - m.top, ball[2]];
  }
  const frames = {};
  for (const [anim, list] of Object.entries(meta.frames))
    frames[anim] = list.map((f) => {
      const key = `${f[0]},${f[1]},${f[2]},${f[3]}`;
      const m = made.get(key);
      return [...at.get(key), m.fw, m.fh, f[4] + m.left, f[5] + m.top];
    });
  return {
    meta: { ...meta, frames, balls, printsFrom: undefined, numbers: undefined },
    img: sheet,
    prints: null,
    regions: gr.getImageData(0, 0, W, H),
  };
}
