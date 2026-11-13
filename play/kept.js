// Built players kept between visits. Building a kid from video in their colours, gear and size takes
// 3-8 s on a phone (play/players.js, loadBuilt), so the finished sheet and its frame list are kept in
// Cache Storage, under a name made from everything that went into them: the sheets' stamps, the
// colours, build and gear (with the gear layers' stamps), and the code that builds players. A later
// visit then only decodes one image. If anything changed, the name changes and it's built again.
// Kept here only, on this device, like the rest of the player.

const CODE = "__PLAYER_CODE__"; // vite.config.js: a hash of players/*.js, play/players.js and this file
const CACHE = "built-players";
const MAX = 6; // players kept; the oldest go first

const usable = () => typeof caches !== "undefined" && !!globalThis.crypto?.subtle && !CODE.startsWith("__"); // not in `npm run dev`

async function address(key) {
  const bytes = new TextEncoder().encode(JSON.stringify([CODE, key]));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new URL(`/built-player/${hex}/`, location.origin).href; // only a name in the cache, never fetched
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

/** Keeps a built player for next time, when the page is idle. Its number and team name (`img.prints`,
 * drawn finer than the art) are drawn into the kept sheet, as a kid's gear already does. */
export function keepPlayer(key, { meta, img }) {
  if (!usable()) return;
  const later = window.requestIdleCallback ?? ((f) => setTimeout(f, 2000));
  later(async () => {
    try {
      const blob = await new Promise((resolve, reject) => flat(meta, img).toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/webp", 1));
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
  });
}

// The sheet with its number and team name drawn in.
function flat(meta, img) {
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
    }
  return c;
}
