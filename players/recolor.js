// Player builder recolouring, shared by the game and the builder page.
//
// Each base body (assets/characters/bases/) has a regions.png whose red channel marks every
// pixel as skin (1), hair (2), jersey (3), team colour (4), shoes (5) or "leave as drawn" (0).
// The team colour is the jersey's trim and the shorts: a player can give the shorts a colour of their
// own (`shorts`), and team-colour pixels away from the jersey's edges take it (see shortsMask).
// Recolouring swaps a region's colour while keeping each pixel's light and shade relative to the
// region's average, so a red jersey keeps its folds and eyes and freckles drawn on the skin stay as
// they are. Hair instead gets a ramp of shades made from the chosen colour (shades.js), each pixel
// taking the shade its lightness ranks at, so black hair keeps its curls and blonde stays blonde.
// The player's number (and their team name on the front, KINGS unless they pick another) is
// printed onto jersey pixels only, tilted to follow the shoulders, so it looks printed on and arms
// and the ball pass in front of it.

import { shadeRanks, shadeTable, lightness } from "./shades.js";

const REGIONS = { 1: "skin", 2: "hair", 3: "jersey", 4: "team", 5: "shoes" };
const HAIR = 2;
const JERSEY = 3;
const TEAM = 4;
const TRIM_REACH = 4; // team-colour pixels this close to the jersey are its trim; the rest are shorts
export const DEFAULT_TEAM = "KINGS";

export const PALETTES = {
  skin: ["#f6d7c3", "#eec1a0", "#e0a983", "#c98c5f", "#ad7148", "#8d5a37", "#6b4227", "#4a2e1c"],
  hair: ["#e8c872", "#c99a45", "#9a6b3e", "#6e4a2b", "#4a3020", "#26222a", "#b5532a", "#8a3b22", "#3d6bd6", "#e06aa8"],
  jersey: ["#f2f2ef", "#2b2b2f", "#d63a3a", "#f08a3c", "#f2cf3d", "#3fa65c", "#59b7e8", "#8b5ad6", "#e86fb0", "#2c3e7a"],
  team: ["#2c3e7a", "#2b2b2f", "#d63a3a", "#f08a3c", "#f2cf3d", "#3fa65c", "#59b7e8", "#8b5ad6", "#e86fb0", "#f2f2ef"],
  shoes: ["#26222a", "#f2f2ef", "#d63a3a", "#f08a3c", "#f2cf3d", "#3fa65c", "#59b7e8", "#8b5ad6", "#e86fb0", "#2c3e7a"],
};
export const PARTS = ["skin", "hair", "jersey", "team", "shoes"];

let basesList;
export function loadBases(root = "/") {
  basesList ??= fetch(`${root}assets/characters/bases/index.json`).then((r) => r.json());
  return basesList;
}

const loaded = new Map();
// Loads a base's sprite sheet, colour map and frame info, once.
export function loadBase(base, root = "/") {
  if (!loaded.has(base.id)) {
    const img = (src) =>
      new Promise((resolve, reject) => {
        const i = new Image();
        // So pixels can be read when the site is on another origin (the admin page, run locally).
        i.crossOrigin = "anonymous";
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = root + src;
      });
    // The pixel font is needed before numbers can be printed.
    const font = document.fonts?.load('16px "Press Start 2P"').catch(() => {});
    const loading = Promise.all([img(base.atlas), img(base.regions), fetch(root + base.meta).then((r) => r.json()), font]).then(
      ([atlas, regions, meta]) => ({ ...base, atlasImg: atlas, regionsData: pixels(regions), meta }),
    );
    loaded.set(base.id, loading);
    loading.catch(() => loaded.delete(base.id));
  }
  return loaded.get(base.id);
}

function pixels(img, rect = [0, 0, img.width, img.height]) {
  const [x, y, w, h] = rect;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, x, y, w, h, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// The hair's lightness ranks over the whole sheet (every frame), worked out once per sheet (by its
// address, since the game loads a video kid's sheet afresh for each place it shows them).
const rankCache = new Map();
function hairRanks(loadedBase) {
  const { atlasImg, regionsData } = loadedBase;
  const key = atlasImg.src || atlasImg;
  if (!rankCache.has(key)) {
    const reg = regionsData.data;
    const px = pixels(atlasImg, [0, 0, regionsData.width, regionsData.height]).data;
    rankCache.set(key, shadeRanks([{ px, region: (i) => (reg[i * 4] === HAIR ? HAIR : 0) }])[HAIR]);
  }
  return rankCache.get(key);
}

// Which team-colour pixels are the shorts (1) rather than the jersey's trim (0): those more than
// TRIM_REACH pixels from any jersey pixel. Worked out once per sheet, like the hair's ranks.
const shortsCache = new Map();
function shortsMask(loadedBase) {
  const { atlasImg, regionsData } = loadedBase;
  const key = atlasImg.src || atlasImg;
  if (!shortsCache.has(key)) {
    const { data: reg, width: w, height: h } = regionsData;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (reg[(y * w + x) * 4] !== TEAM) continue;
        let near = false;
        for (let dy = -TRIM_REACH; dy <= TRIM_REACH && !near; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -TRIM_REACH; dx <= TRIM_REACH; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < w && reg[(yy * w + xx) * 4] === JERSEY) {
              near = true;
              break;
            }
          }
        }
        if (!near) mask[y * w + x] = 1;
      }
    shortsCache.set(key, mask);
  }
  return shortsCache.get(key);
}

// Returns a canvas of the base's sprite sheet (or one rectangle of it) in the given colours.
export function recolor(loadedBase, colours, rect) {
  const full = [0, 0, loadedBase.atlasImg.width, loadedBase.atlasImg.height];
  const [x, y, w, h] = rect ?? full;
  const src = pixels(loadedBase.atlasImg, [x, y, w, h]);
  const regionPx = loadedBase.regionsData.data;
  const atlasW = loadedBase.regionsData.width;
  const plans = {};
  for (const [id, name] of Object.entries(REGIONS)) {
    const target = colours[name];
    const ref = loadedBase.meta.regions[name];
    // Very dark regions (black shoes) have little shade to scale, so their range is stretched.
    // (a kid from video stores some parts in another colour than their own, e.g. keyed hair: `meta.art`)
    const own = loadedBase.meta.art?.[name] ?? loadedBase.colours[name];
    if (!target || !ref || target.toLowerCase() === own) continue;
    const hair = +id === HAIR && hairRanks(loadedBase);
    plans[id] = hair ? { table: shadeTable(hair, target) } : { t: hex(target), refL: Math.max(1, luma(...ref)), dark: luma(...ref) < 70 };
  }
  // Shorts in a colour of their own: the team colour's plan, aimed at the shorts colour.
  const teamRef = loadedBase.meta.regions.team;
  const shortsTarget = colours.shorts && colours.shorts.toLowerCase() !== (colours.team ?? "").toLowerCase() ? colours.shorts : null;
  const shortsPlan = shortsTarget && teamRef && { t: hex(shortsTarget), refL: Math.max(1, luma(...teamRef)), dark: luma(...teamRef) < 70 };
  const shorts = shortsPlan && shortsMask(loadedBase);
  const d = src.data;
  const shade = new Float32Array(w * h); // each jersey pixel's light/shade, for printing the number
  const jerseyRef = Math.max(1, luma(...(loadedBase.meta.regions.jersey ?? [200, 200, 200])));
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      if (!d[i + 3]) continue;
      const region = regionPx[((py + y) * atlasW + px + x) * 4];
      if (region === JERSEY) shade[py * w + px] = luma(d[i], d[i + 1], d[i + 2]) / jerseyRef;
      const plan = shorts && region === TEAM && shorts[(py + y) * atlasW + px + x] ? shortsPlan : plans[region];
      if (!plan) continue;
      if (plan.table) {
        const l = lightness(d[i], d[i + 1], d[i + 2]) * 3;
        d[i] = plan.table[l];
        d[i + 1] = plan.table[l + 1];
        d[i + 2] = plan.table[l + 2];
        continue;
      }
      let k = luma(d[i], d[i + 1], d[i + 2]) / plan.refL;
      if (plan.dark) k = 0.35 + 0.65 * k;
      for (let ch = 0; ch < 3; ch++) {
        const t = plan.t[ch];
        // Darker than average: scale the colour down. Lighter: blend toward white for highlights.
        d[i + ch] = k <= 1 ? t * k : Math.min(255, t + (255 - t) * (k - 1) * 0.6);
      }
    }
  }
  const hasNumber = colours.number !== undefined && colours.number !== "";
  if (hasNumber || colours.teamName !== "") printNumber(loadedBase, colours, [x, y, w, h], d, shade, regionPx, atlasW);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").putImageData(src, 0, 0);
  return canvas;
}

// Prints the number on the back (and the team name plus number on the front) in the team colour,
// or black/white if that wouldn't show up on the jersey. Only jersey pixels get ink.
function printNumber(loadedBase, colours, [x, y, w, h], d, shade, regionPx, atlasW) {
  const jersey = hex(colours.jersey ?? loadedBase.colours.jersey);
  let ink = hex(colours.team ?? loadedBase.colours.team);
  if (Math.abs(luma(...ink) - luma(...jersey)) < 60) ink = luma(...jersey) > 128 ? [32, 30, 36] : [242, 242, 239];

  const spots = Object.entries(loadedBase.meta.numbers ?? {}).filter(([, s]) => s.x >= x && s.x < x + w && s.y >= y && s.y < y + h);
  if (!spots.length) return;
  const stamp = document.createElement("canvas");
  stamp.width = w;
  stamp.height = h;
  const g = stamp.getContext("2d");
  g.fillStyle = "#000";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const front = new Set(loadedBase.meta.frames.idle.map((f) => `${f[0]},${f[1]}`));
  const number = colours.number === undefined || colours.number === null ? "" : String(colours.number);
  const team = (colours.teamName ?? DEFAULT_TEAM).toUpperCase();
  for (const [key, s] of spots) {
    const isFront = front.has(key);
    const size = number.length > 1 ? s.size : s.size * 1.2;
    g.save();
    // Two digits on the back sit a little right of centre, where the turned back reads as the middle.
    const nudge = !isFront && number.length > 1 ? (s.width ?? 0) * 0.08 : 0;
    g.translate(s.x - x + nudge, s.y - y);
    // The front of the jersey faces us; on the back, follow the slope of the shoulders.
    g.rotate(((isFront ? 0 : s.angle ?? 0) * Math.PI) / 180);
    if (number) {
      g.font = `${Math.round(size)}px "Press Start 2P", monospace`;
      g.fillText(number, 0, 0);
    }
    if (isFront && team) {
      // The pixel font's letters are as wide as they are tall: fit the name across the chest.
      const fit = Math.min(s.size * 1.05, ((s.width ?? s.size * 6) * 0.8) / team.length);
      g.font = `${Math.max(5, Math.round(fit))}px "Press Start 2P", monospace`;
      g.fillText(team, 0, number ? -s.size * 1.35 : 0);
    }
    g.restore();
  }
  const mask = g.getImageData(0, 0, w, h).data;
  for (let p = 0; p < w * h; p++) {
    if (mask[p * 4 + 3] < 128) continue;
    const px = p % w;
    const py = (p - px) / w;
    if (regionPx[((py + y) * atlasW + px + x) * 4] !== JERSEY) continue;
    const k = Math.min(1.15, shade[p]);
    const i = p * 4;
    for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.min(255, ink[ch] * k);
  }
}

// ---------- Players saved on this device ----------
// Anyone can play as their own player straight away; it's kept in this browser, and comes along to
// their other devices with their saved progress (progress.js, shared/save.js), never shown to anyone
// else. Sending it to Orson is separate, and puts it in the game for everyone once approved.

const MY_PLAYERS = "orson-hoops-my-players";
const GONE_PLAYERS = "orson-hoops-gone-players"; // ids removed, so another device's copy doesn't bring them back
const MAX_MY_PLAYERS = 6;

/** Replaces the list (with saved progress merged in). */
export function setMyPlayers(list) {
  try {
    localStorage.setItem(MY_PLAYERS, JSON.stringify(list.slice(0, MAX_MY_PLAYERS)));
  } catch {
    // Storage blocked.
  }
}

export function gonePlayers() {
  try {
    const list = JSON.parse(localStorage.getItem(GONE_PLAYERS) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function setGonePlayers(list) {
  try {
    localStorage.setItem(GONE_PLAYERS, JSON.stringify(list.slice(0, 50)));
  } catch {
    // Storage blocked.
  }
}

export function myPlayers() {
  try {
    const list = JSON.parse(localStorage.getItem(MY_PLAYERS) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Saves (or updates, by nickname) a player and returns its id.
export function saveMyPlayer(player) {
  const same = (p) => p.name.toLowerCase() === player.name.toLowerCase();
  // Remaking a player with the same name keeps its id, so its leaderboard scores stay linked; so does
  // editing one (player.id), even under a new name.
  const id = (player.id && myPlayers().some((p) => p.id === player.id) ? player.id : null) ?? myPlayers().find(same)?.id ?? `me${Date.now()}`;
  const list = myPlayers().filter((p) => p.id !== id && !same(p));
  list.unshift({ ...player, id });
  try {
    localStorage.setItem(MY_PLAYERS, JSON.stringify(list.slice(0, MAX_MY_PLAYERS)));
  } catch {
    // Storage blocked (private browsing): they can still play this visit.
  }
  return id;
}

export function removeMyPlayer(id) {
  try {
    localStorage.setItem(MY_PLAYERS, JSON.stringify(myPlayers().filter((p) => p.id !== id)));
  } catch {
    // Nothing to remove from.
  }
  setGonePlayers([id, ...gonePlayers().filter((g) => g !== id)]);
}

// Head-and-shoulders picture of a player, for pickers.
export function thumbnail(loadedBase, colours, size = 96) {
  if (loadedBase.card) {
    // a kid from video: their card's frame [x, y, w, h], placed at (dx, dy) in a square `side` across
    const [x, y, w, h, dx, dy, side] = loadedBase.card;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    const k = size / side;
    g.drawImage(recolor(loadedBase, colours, [x, y, w, h]), dx * k, dy * k, w * k, h * k);
    return c;
  }
  const [x, y, w, h] = loadedBase.meta.frames.idle[0];
  const head = recolor(loadedBase, colours, [x, y, w, Math.round(h * 0.45)]);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const side = Math.max(head.width, head.height);
  const scale = size / side;
  const g = c.getContext("2d");
  g.drawImage(head, ((side - head.width) / 2) * scale, (side - head.height) * scale, head.width * scale, head.height * scale);
  return c;
}
