// A builder player made ready for the game: their body's sheet in their colours, with (for a kid from
// video) their number and team name, gear, height and build. The game draws it (play/players.js), and the
// builder makes it ahead (prepareBuilt) while they're still choosing, so pressing Play doesn't wait for it.
// Every step runs a slice at a time (players/slices.js), so it never freezes the page, and the finished
// sheet is kept on this device (play/kept.js) under a name made from everything that went into it.

import { flagOn } from "../flags.js";
import { regionFeet } from "../engine/draw.js";
import { Progress, loadImage } from "../engine/download.js";
import { isKept, keepPlayer, keptPlayer } from "../play/kept.js";
import { gearParam, gearStamps, loadGear, readyGear, wearGearSliced } from "./gear.js";
import { paletteSwapSliced } from "./pixelkit.js";
import { DEFAULT_TEAM, gameScale, loadBase, loadBases, pickSize, recolorSliced, sized } from "./recolor.js";
import { stretchSheetSliced } from "./stretch.js";
import { runSliced } from "./slices.js";

// The parts of a player's colours that recolour the body, and their number and team name.
const PARTS = ["skin", "hair", "jersey", "team", "shoes"];
export const partsOf = (colours = {}) => Object.fromEntries(Object.entries(colours).filter(([k]) => PARTS.includes(k)));
// (a smaller sheet's number is printed less finely: still at least as fine as its art)
const fineFor = (meta = {}) => {
  const scale = meta.fullRes ? meta.res / meta.fullRes : 1;
  return scale < 0.7 ? 2 : scale < 0.9 ? 3 : undefined;
};
export const kitOf = (colours = {}, meta = {}) => ({ number: colours.number ?? 28, team: colours.teamName ?? DEFAULT_TEAM, fine: fineFor(meta) });

// A full-detail sheet's pixel-art twin (`printsFrom`), loaded once: its jersey faces print the number
// and team name.
const twins = new Map();
export function loadTwin(printsFrom) {
  const { meta } = printsFrom;
  if (!twins.has(meta)) {
    // (with a Progress: decoded as an ImageBitmap, off the main thread, engine/download.js)
    const p = Promise.all([fetch("/" + meta).then((r) => r.json()), loadImage("/" + printsFrom.atlas, new Progress())]);
    p.catch(() => twins.delete(meta));
    twins.set(meta, p);
  }
  return twins.get(meta);
}

/** The number and team name for each frame of a full-detail sheet, from its twin's jersey faces. */
export async function twinPrints(meta, colours, twin = loadTwin(meta.printsFrom)) {
  const [pm, pimg] = await twin;
  const layers = (await paletteSwapSliced(pimg, pm, partsOf(colours), kitOf(colours, meta))).printLayers ?? new Map();
  const prints = new Map();
  for (const [key, pixelKey] of Object.entries(meta.printsFrom.frames)) if (layers.has(pixelKey)) prints.set(key, layers.get(pixelKey));
  return prints;
}

// Where the shoes are in every frame ({ "x,y": feet }), from a colour map at the sheet's places.
function* feetFromSteps(regions, frames) {
  const feet = {};
  for (const list of Object.values(frames))
    for (const f of list) {
      const key = `${f[0]},${f[1]}`;
      if (key in feet) continue;
      feet[key] = regionFeet(regions, f);
      yield;
    }
  return feet;
}

// Their gear: saved with them (?gear=beanie,stripes tries some on every kid from video), only items ready
// for this kid, and only with the gear flag on.
function gearOf(base, entry) {
  const test = new URLSearchParams(location.search).get("gear");
  return test ? gearParam(test) : flagOn("gear") ? readyGear(base.id, entry.gear) : {};
}

// The name it's kept under: the sheets of the size used, the size, the colours, build, and the version
// of each gear layer.
async function keyOf(base, entry, size, gear) {
  const files = sized(base, size);
  return { size: files.size, sheets: [files.atlas, files.meta, files.regions], base: base.colours, colours: entry.colours, build: entry.build, gear: base.video ? await gearStamps(base.id, gear, "/", files.size) : {} };
}

/** A builder player ({ base, colours, build, gear }) at a sheet size, ready to draw: kept from before, or built now. */
export async function loadBuilt(entry, size, progress, { keepNow = false } = {}) {
  const base = (await loadBases()).find((b) => b.id === entry.base);
  const gear = base.video ? gearOf(base, entry) : {};
  const key = await keyOf(base, entry, size, gear);
  const kept = await keptPlayer(key);
  performance.mark(kept ? "player-kept" : "player-built"); // (verify perf reports which)
  if (kept) return kept;
  const built = await build(base, entry, gear, size, progress);
  const keeping = keepPlayer(key, built, { now: keepNow });
  if (keepNow) await keeping;
  return built;
}

// Building one: a drawn body is recoloured; a kid from video also gets the number from their twin, their
// gear, and their height and build (the frames stretched, with the number and gear on them).
async function build(base, entry, gear, size, progress) {
  const loaded = await loadBase(base, "/", size, progress);
  if (!base.video) {
    // (with where the shoes are, from the region map: a kept copy has no region map, and guessing from the
    // pixels puts the shoe fire in the wrong place)
    const img = await recolorSliced(loaded, entry.colours);
    return { meta: { ...loaded.meta, feet: await runSliced(feetFromSteps(loaded.regionsData, loaded.meta.frames)) }, img };
  }
  const [prints, worn] = await Promise.all([twinPrints(loaded.meta, entry.colours), loadGear(base.id, gear, "/", loaded.size).catch(() => [])]);
  const img = await recolorSliced(loaded, partsOf(entry.colours));
  const dressed = await wearGearSliced({ meta: loaded.meta, img, prints, regions: loaded.regionsData }, worn, { ...base.colours, ...entry.colours });
  img.pixels = null; // (only needed by wearGear)
  const s = await stretchSheetSliced(dressed, dressed.regions, entry.build);
  // the shoes: a stretched sheet carries its own feet; otherwise they're found in the region map now, so a
  // kept copy has them too
  const meta = s.meta.feet ? s.meta : { ...s.meta, feet: await runSliced(feetFromSteps(dressed.regions, s.meta.frames)) };
  return { meta, img: Object.assign(s.img, { prints: s.prints }) };
}

// The court's width on this screen, as the game page lays it out (styles.css, .game-page --court): the
// size of sheet the game will want, worked out on another page.
function courtWidth() {
  const w = innerWidth, h = innerHeight;
  const bar = 48 + 2 * 12, rail = 3 * 48 + 2 * 8 + 2 * 12;
  return w < h ? Math.max(Math.min(w, h - 2 * bar), 0.85 * w) : Math.max(Math.min(h, w - 2 * rail), 0.85 * h);
}

/** Makes (and keeps) the sheet the game will draw for this player, ahead of time, without freezing the page. */
export async function prepareBuilt(entry) {
  const base = (await loadBases()).find((b) => b.id === entry.base);
  if (!base) return;
  const size = pickSize(base, gameScale(courtWidth()));
  if (await isKept(await keyOf(base, entry, size, base.video ? gearOf(base, entry) : {}))) return; // ready already
  await loadBuilt(entry, size, null, { keepNow: true });
}
