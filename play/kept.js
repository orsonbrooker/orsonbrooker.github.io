// Built players kept between visits. Building a kid from video in their colours, gear and size takes
// 3-8 s on a phone (play/players.js, loadBuilt), so the finished sheet and its frame list are kept in
// Cache Storage, under a name made from everything that went into them: the sheets' stamps, the
// colours, build and gear (with the gear layers' stamps), and the code that builds players. A later
// visit then only decodes one image. If anything changed, the name changes and it's built again.
// Kept here only, on this device, like the rest of the player.

import { runSliced } from "../players/slices.js";

const CODE = "__PLAYER_CODE__"; // vite.config.js: a hash of players/*.js, play/players.js and this file
const CACHE = "built-players";
const MAX = 6; // players kept; the oldest go first

const usable = () => typeof caches !== "undefined" && !!globalThis.crypto?.subtle && !CODE.startsWith("__"); // not in `npm run dev`

// (keys in a fixed order, so the same player is the same name whichever page made it)
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);

async function address(key) {
  const bytes = new TextEncoder().encode(JSON.stringify([CODE, sorted(key)]));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new URL(`/built-player/${hex}/`, location.origin).href; // only a name in the cache, never fetched
}

/** Whether a player is kept already (without decoding it). */
export async function isKept(key) {
  if (!usable()) return false;
  try {
    const at = await address(key);
    return !!(await (await caches.open(CACHE)).match(at + "meta"));
  } catch {
    return false;
  }
}

/** A kept player ({ meta, img }), or null. */
export async function keptPlayer(key) {
  if (!usable()) return null;
  try {
    const cache = await caches.open(CACHE);
    const at = await address(key);
    const [meta, sheet] = await Promise.all([cache.match(at + "meta"), cache.match(at + "sheet")]);
    if (!meta || !sheet) return null;
    // decoded off the main thread
    const [m, img] = await Promise.all([meta.json(), sheet.blob().then((b) => createImageBitmap(b))]);
    return { meta: m, img };
  } catch {
    return null;
  }
}

/** Keeps a built player for next time, when the page is idle (or `now`, resolving once it's kept: the
 * builder, about to open the game). Its number and team name (`img.prints`, drawn finer than the art) are
 * drawn into the kept sheet, as a kid's gear already does. */
export function keepPlayer(key, { meta, img }, { now = false } = {}) {
  if (!usable()) return Promise.resolve();
  const later = now ? (f) => f() : window.requestIdleCallback ?? ((f) => setTimeout(f, 2000));
  return new Promise((done) => later(async () => {
    try {
      const sheet = await runSliced(flatSteps(meta, img));
      // PNG: kept exactly (WebP, even at its best, changes the soft edges of a kid from video)
      const blob = await new Promise((resolve, reject) => sheet.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
      const cache = await caches.open(CACHE);
      const at = await address(key);
      await cache.put(at + "sheet", new Response(blob, { headers: { "Content-Type": blob.type } }));
      await cache.put(at + "meta", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
      // only the newest few
      const kept = [...new Set((await cache.keys()).map((r) => r.url.replace(/[^/]*$/, "")))];
      for (const old of kept.slice(0, Math.max(0, kept.length - MAX))) await Promise.all(["sheet", "meta"].map((f) => cache.delete(old + f)));
    } catch {
      // Full, or private browsing: it's built again next time.
    }
    done();
  }));
}

// The sheet with its number and team name drawn in (a print at a time: players/slices.js).
function* flatSteps(meta, img) {
  if (img.toBlob && !img.prints?.size) return img;
  const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const done = new Set(); // a frame used by two moves gets its print once
  for (const list of Object.values(meta.frames))
    for (const [x, y, w, h] of list) {
      const print = img.prints.get(`${x},${y}`);
      if (!print || done.has(print)) continue;
      done.add(print);
      g.drawImage(print, 0, 0, print.width, print.height, x, y, w, h);
      yield;
    }
  return c;
}
