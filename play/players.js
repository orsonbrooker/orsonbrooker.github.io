// Who you play as: the list of players, loading their sprite sheets, their faces for the picker and
// the leaderboard, and which frame of the chosen player's sheet to draw right now.
//
// assets/characters/index.json lists the hand-made players (tools/build_character.py). Players
// made with the builder (/players/) come from the API once approved, drawn from a base body in
// their chosen colours.

import { myTeamKit } from "../players/community.js";
import { API } from "../api.js";
import { flagOn } from "../flags.js";
import { attributesFor } from "../content/attributes.js";
import { EU, EV, RIM, project } from "../engine/court.js";
import { feetIn, regionFeet } from "../engine/draw.js";
import { Progress, loadImage } from "../engine/download.js";
import { load, save } from "../engine/storage.js";
import { ANIM_FPS, JUMP_APEX, JUMP_FRAME_TIME, player } from "../play/state.js";
import { gearParam, gearStamps, loadGear, readyGear, wearGear } from "../players/gear.js";
import { buildPlayer, loadHeads } from "../players/layered.js";
import { keepPlayer, keptPlayer } from "./kept.js";
import { paletteSwap } from "../players/pixelkit.js";
import { stretchSheet } from "../players/stretch.js";
import { DEFAULT_TEAM, gameScale, loadBase, loadBases, loadStill, myPlayers, pickSize, recolor, sized, thumbnail, useDrawnKids } from "../players/recolor.js";

// Kids from video and their gear aren't out until their flags are on (shared/flags.js): until then
// Curly and Buns play with their drawn bodies.
if (!flagOn("videokids")) useDrawnKids();

const PLAYERS_API = `${API}/players`;
export const characters = {
  list: [{ id: "orson", name: "Orson", pronoun: "he", atlas: "assets/sprites.webp", meta: "assets/sprites.json", thumb: "" }],
  loaded: new Map(),
  progress: new Map(), // the same keys: how far along each one's download is (engine/download.js)
  selected: load("orson-hoops-character", "orson"),
};

// The chosen player's sprite sheet: frame positions (sprites), the image (atlas), and for builder
// players which pixels are shoes (shoeRegions).
export const sheet = { sprites: null, atlas: null, shoeRegions: null, prints: null, id: null, size: null };

// Which size of a player's sheet the game draws (players/recolor.js pickSize): the smallest that isn't drawn
// enlarged on this court, else full. Worked out again when the court's size changes (recheckSheet).
const basesById = new Map(); // the builder bodies, once the roster is in
const stageWidth = () => document.getElementById("stage")?.getBoundingClientRect().width || innerWidth;
function sizeFor(entry, current) {
  const sizing = entry.base ? basesById.get(entry.base) : entry;
  return sizing ? pickSize(sizing, gameScale(stageWidth()), current) : null;
}
const keyOf = (id, size) => `${id}@${size ?? "full"}`;

export { loadImage };

// The parts of a player's colours that recolour the body, and their number and team name.
const PARTS = ["skin", "hair", "jersey", "team", "shoes"];
const partsOf = (colours = {}) => Object.fromEntries(Object.entries(colours).filter(([k]) => PARTS.includes(k)));
// (a smaller sheet's number is printed less finely: still at least as fine as its art)
const fineFor = (meta = {}) => {
  const scale = meta.fullRes ? meta.res / meta.fullRes : 1;
  return scale < 0.7 ? 2 : scale < 0.9 ? 3 : undefined;
};
const kitOf = (colours = {}, meta = {}) => ({ number: colours.number ?? 28, team: colours.teamName ?? DEFAULT_TEAM, fine: fineFor(meta) });

// A drawn copy of an image: kept by the GPU, where a big <img> can be thrown away and decoded again
// (on a phone, close to a second for a full-detail sheet) in the middle of a game.
function toCanvas(img) {
  const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}

// A full-detail sheet's pixel-art twin (`printsFrom`), loaded once: its jersey faces print the number
// and team name.
const twins = new Map();
function loadTwin({ atlas, meta }) {
  if (!twins.has(meta)) {
    const p = Promise.all([fetch(meta).then((r) => r.json()), loadImage(atlas)]);
    p.catch(() => twins.delete(meta));
    twins.set(meta, p);
  }
  return twins.get(meta);
}

// The number and team name for each frame of a full-detail sheet, from its twin's jersey faces.
async function twinPrints(meta, colours, twin = loadTwin(meta.printsFrom)) {
  const [pm, pimg] = await twin;
  const layers = paletteSwap(pimg, pm, partsOf(colours), kitOf(colours, meta)).printLayers ?? new Map();
  const prints = new Map();
  for (const [key, pixelKey] of Object.entries(meta.printsFrom.frames)) if (layers.has(pixelKey)) prints.set(key, layers.get(pixelKey));
  return prints;
}

async function loadBuilt(entry, size, progress) {
  const base = (await loadBases()).find((b) => b.id === entry.base);
  if (!base.video) {
    const loaded = await loadBase(base, "/", size, progress);
    return { meta: loaded.meta, img: recolor(loaded, entry.colours), loaded };
  }
  // a kid made from their own videos: built on an earlier visit (play/kept.js), else built now and
  // kept. The key names the sheets of the size used, the size, and the version of each gear layer.
  // Their gear: saved with them (?gear=beanie,stripes tries some on every kid from video).
  const testGear = new URLSearchParams(location.search).get("gear");
  const gear = testGear ? gearParam(testGear) : flagOn("gear") ? readyGear(base.id, entry.gear) : {}; // only items ready for this kid
  const files = sized(base, size);
  const key = { size: files.size, sheets: [files.atlas, files.meta, files.regions], base: base.colours, colours: entry.colours, build: entry.build, gear: await gearStamps(base.id, gear, "/", files.size) };
  const kept = await keptPlayer(key);
  if (kept) return kept;
  const built = await buildVideoKid(base, entry, gear, size, progress);
  keepPlayer(key, built);
  return built;
}

// Their full-detail sheet in the player's colours (as for Orson), with their gear, height and build.
async function buildVideoKid(base, entry, gear, size, progress) {
  const loaded = await loadBase(base, "/", size, progress);
  const [prints, worn] = await Promise.all([twinPrints(loaded.meta, entry.colours), loadGear(base.id, gear, "/", loaded.size).catch(() => [])]);
  const img = recolor(loaded, partsOf(entry.colours));
  const dressed = wearGear({ meta: loaded.meta, img, prints, regions: loaded.regionsData }, worn, { ...base.colours, ...entry.colours });
  img.pixels = null; // (only needed by wearGear)
  // their height and build: the frames stretched, the number and team name (and gear) with them
  const s = stretchSheet(dressed, dressed.regions, entry.build);
  // the shoes: a stretched sheet carries its own feet; otherwise they're found in the region map now,
  // so a kept copy has them too
  const meta = s.meta.feet ? s.meta : { ...s.meta, feet: feetFrom(dressed.regions, s.meta.frames) };
  return { meta, img: Object.assign(s.img, { prints: s.prints }) };
}

// Where the shoes are in every frame ({ "x,y": feet }), from a colour map at the sheet's places.
function feetFrom(regions, frames) {
  const feet = {};
  for (const list of Object.values(frames)) for (const f of list) feet[`${f[0]},${f[1]}`] ??= regionFeet(regions, f);
  return feet;
}

// A sheet made from video has a plain jersey: print his number and team name on it. A pixel-art
// sheet carries its own jersey faces; a full-detail one borrows them from its pixel-art twin
// (`printsFrom`), whose frames sit at the same places, `scale` times smaller.
// `colours` (optional) recolours it like a builder player: { skin, hair, jersey, team, shoes,
// number, teamName }. `twin`: the twin already loading.
async function withKit(meta, img, entry, colours = {}, twin) {
  const parts = partsOf(colours);
  if (meta.prints || meta.faces) {
    const c = paletteSwap(img, meta, parts, kitOf(colours));
    return { meta, img: Object.assign(c, { prints: c.printLayers }) };
  }
  if (meta.printsFrom) {
    const [prints, regions] = await Promise.all([twinPrints(meta, colours, twin), Object.keys(parts).length ? loadImage(meta.regionsFile) : null]);
    // His colours, the way builder players get theirs (players/recolor.js), from the region map.
    let out;
    if (regions) {
      const c = Object.assign(document.createElement("canvas"), { width: regions.width, height: regions.height });
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(regions, 0, 0);
      const regionsData = g.getImageData(0, 0, c.width, c.height);
      // (Orson in a team's kit has shorts of their own colour: dressInTeam)
      const shorts = entry?.id === "orson" && colours.shorts ? { shorts: colours.shorts } : {};
      out = recolor({ atlasImg: img, regionsData, meta, colours: meta.colours }, { ...parts, ...shorts });
    } else out = toCanvas(img);
    return { meta, img: Object.assign(out, { prints }) };
  }
  return { meta, img };
}

async function loadCharacter(id, size = null) {
  const key = keyOf(id, size);
  if (!characters.loaded.has(key)) {
    const entry = characters.list.find((c) => c.id === id) ?? characters.list[0];
    const font = document.fonts?.load('16px "Press Start 2P"').catch(() => {}); // for printing the number
    const progress = new Progress();
    characters.progress.set(key, progress);
    let loading;
    if (entry.layered) loading = Promise.all([buildPlayer(entry.layered), font]).then(([{ meta, img }]) => withKit(meta, img, entry, entry.colours));
    else if (entry.base) loading = Promise.all([loadBuilt(entry, size, progress), font]).then(([built]) => built);
    else {
      // the smaller sheet where it's drawn small; the number's twin starts loading with the sheet
      const { meta: metaUrl, atlas } = sized(entry, size);
      const meta = fetch(metaUrl).then((r) => r.json());
      const twin = meta.then((m) => (m.printsFrom ? loadTwin(m.printsFrom) : null));
      twin.catch(() => {});
      loading = Promise.all([meta, loadImage(atlas, progress), font]).then(([m, img]) => withKit(m, img, entry, entry.colours, m.printsFrom ? twin : undefined));
    }
    characters.loaded.set(key, loading);
    loading.catch(() => characters.loaded.delete(key)).finally(() => progress.finish());
  }
  return characters.loaded.get(key);
}

/** How far along loading player `id` is (a Progress, for a loading bar), or null if they're in. */
export function loadingProgress(id) {
  const entry = characters.list.find((c) => c.id === id) ?? characters.list[0];
  const progress = characters.progress.get(keyOf(entry.id, sizeFor(entry, sheet.id === entry.id ? sheet.size : undefined)));
  return progress && !progress.finished ? progress : null;
}

// Plays as this player from now on (and remembers it, unless it's only for now: a turn in a pass and
// play game, or a replay).
let using = 0; // the latest player asked for: an earlier one still loading doesn't take over when it's in
export async function useCharacter(id, { remember = true } = {}) {
  const ticket = ++using;
  const entry = characters.list.find((c) => c.id === id) ?? characters.list[0];
  const size = sizeFor(entry, sheet.id === id ? sheet.size : undefined);
  const { meta, img, loaded, regions } = await loadCharacter(id, size);
  if (ticket !== using) return;
  Object.assign(sheet, { id, size });
  sheet.sprites = meta;
  sheet.atlas = img;
  sheet.prints = img.prints ?? null; // a video sheet's number and team name, drawn over each frame
  sheet.shoeRegions = regions ?? loaded?.regionsData ?? null; // which pixels are shoes, where there's a colour map
  characters.selected = id;
  player.attrs = attributesFor(id);
  player.pronoun = (characters.list.find((c) => c.id === id) ?? characters.list[0]).pronoun ?? "";
  if (remember) save("orson-hoops-character", id);
}

// Every player's sheets (and their pixel-art twins, for the number and team name), and every builder
// body's, to keep so any of them can be chosen offline (offline.js): at the size this device draws
// them, and only what's out (the list and the bodies already follow the flags; gear and heads aren't
// kept ahead).
export async function playerFiles() {
  const strip = (u) => u.replace(/^\//, "");
  const builtIn = characters.list.filter((c) => c.atlas && c.meta && !c.base && !c.layered);
  const bases = await loadBases().catch(() => []);
  const sheets = [...builtIn, ...bases].map((b) => sized(b, sizeFor(b)));
  const metas = await Promise.all(sheets.map((b) => fetch("/" + strip(b.meta)).then((r) => r.json()).catch(() => ({}))));
  return sheets.flatMap((b, i) => [b.atlas, b.meta, b.regions, b.thumb, metas[i].printsFrom?.atlas, metas[i].printsFrom?.meta].filter(Boolean).map((u) => "/" + strip(u)));
}

// Starts loading a player's sprite sheet, so switching to them later is quick.
export const preloadCharacter = (id) => loadCharacter(id, sizeFor(characters.list.find((c) => c.id === id) ?? characters.list[0])).catch(() => {});

let recheck = 0;
/** The court was drawn at a new size (play/scene.js resize): the player's sheet at the size that suits it now. */
export function recheckSheet() {
  clearTimeout(recheck);
  recheck = setTimeout(() => {
    if (!sheet.id) return;
    const entry = characters.list.find((c) => c.id === sheet.id);
    if (entry && sizeFor(entry, sheet.size) !== sheet.size) useCharacter(sheet.id, { remember: false }).catch(() => {});
  }, 300);
}

// Built-in players that became builder players: a device that remembered the old one gets the new one.
const MOVED = { jethro: "p25" };

// The hand-made players, then ones made on this device, then approved builder players. Falls back to
// the first player if the remembered one is gone.
export async function loadRoster() {
  const list = await fetch("assets/characters/index.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (list?.length) characters.list = list;
  // Test only. Orson is drawn from video at full detail (tools/pixelart/); ?old plays him with his
  // earlier art, ?pixel with the pixel-art version. ?jersey=d63a3a&team=f2cf3d&skin=&hair=&shoes=
  // &number=7&teamName=HAWKS recolours him the way the builder's players are, to try customising.
  const params = new URLSearchParams(location.search);
  const orson = characters.list.find((c) => c.id === "orson");
  // His art from video waits for the orsonvideo flag (shared/flags.js); until then, his current art.
  if (orson && (params.has("old") || !flagOn("orsonvideo"))) Object.assign(orson, { atlas: "assets/sprites.webp", meta: "assets/sprites.json", sizes: undefined });
  if (orson && params.has("pixel")) Object.assign(orson, { atlas: "assets/characters/orson-pixel/sprites.png", meta: "assets/characters/orson-pixel/sprites.json", sizes: undefined });
  // ?head=orson&height=1&bulk=-1: him as a layered player (players/layered.js), with that head and build.
  if (orson && flagOn("layered") && /^[a-z-]+$/.test(params.get("head") ?? "")) orson.layered = { head: params.get("head"), build: { height: params.get("height"), bulk: params.get("bulk") } };
  const custom = {};
  for (const k of ["skin", "hair", "jersey", "team", "shoes"]) if (/^[0-9a-f]{6}$/i.test(params.get(k) ?? "")) custom[k] = `#${params.get(k).toLowerCase()}`;
  if (/^\d{1,2}$/.test(params.get("number") ?? "")) custom.number = params.get("number");
  if (params.get("teamName")) custom.teamName = params.get("teamName").toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 10);
  if (orson && Object.keys(custom).length) Object.assign(orson, { colours: custom, tryingColours: true });
  await loadBuiltPlayers();
  dressInTeam();
  const moved = MOVED[characters.selected];
  if (moved && characters.list.some((c) => c.id === moved)) characters.selected = moved;
  if (!characters.list.some((c) => c.id === characters.selected)) characters.selected = characters.list[0].id;
}

/**
 * Orson and the approved builder players wear the team the device chose (players/community.js myTeam,
 * while the teams flag is on), since that's the team their games count for: its home kit and its name on
 * the jersey. Before one's chosen, Orson is drawn as he is (KINGS) and an approved player in the kit they
 * were sent in. Called when the roster loads and whenever the team changes; whoever is playing is drawn
 * again in the new kit. (Not Orson with ?jersey= and the like, which try other colours on him.)
 */
export async function dressInTeam() {
  const kit = flagOn("teams") ? myTeamKit() : null;
  const wear = kit && { jersey: kit.home.jersey, team: kit.home.trim, shorts: kit.home.shorts, teamName: kit.name };
  const redraw = new Set();
  const orson = characters.list.find((c) => c.id === "orson");
  if (orson && !orson.tryingColours) {
    const colours = wear && kit.name !== DEFAULT_TEAM ? wear : undefined;
    if (JSON.stringify(colours) !== JSON.stringify(orson.colours)) {
      orson.colours = colours;
      redraw.add("orson");
    }
  }
  for (const p of characters.list.filter((c) => /^p\d+$/.test(c.id))) {
    p.sentColours ??= p.colours; // as they were sent in, for when no team is chosen
    const colours = wear ? { ...p.sentColours, ...wear } : p.sentColours;
    if (JSON.stringify(colours) === JSON.stringify(p.colours)) continue;
    p.colours = colours;
    redraw.add(p.id);
  }
  for (const key of [...characters.loaded.keys()]) if (redraw.has(key.split("@")[0])) characters.loaded.delete(key);
  if (redraw.has(sheet?.id)) await useCharacter(sheet.id, { remember: false });
}

// Players made on this device (or on another of theirs, with saved progress), as picker entries.
// A body whose head has been made for the layered players moves like Orson (players/layered.js);
// the others keep their hand-drawn sheet.
// A kid made from their own videos (Curly, Buns) moves as themselves.
const layeredOf = (heads, bases = []) => (p) =>
  bases.find((b) => b.id === p.base)?.video ? {} : heads[p.base] && flagOn("layered") ? { layered: { head: p.base, build: p.build ?? {} } } : {};
// The heads list is only needed while layered players are on.
const headStyles = () => (flagOn("layered") ? loadHeads() : Promise.resolve({}));

function minePlayers(bases, heads) {
  const layered = layeredOf(heads, bases);
  return myPlayers().flatMap((p) => {
    const base = bases.find((b) => b.id === p.base);
    return base ? [{ ...p, ...layered(p), pronoun: p.pronoun || base.pronoun || "", mine: true, thumb: "/" + base.thumb, colours: { teamName: DEFAULT_TEAM, ...p.colours } }] : [];
  });
}

// What a player made on a device looks like: a change on another device means drawing them afresh.
const lookOf = (c) => JSON.stringify([c.base, c.colours, c.build, c.gear, c.layered]);

/** Their own players again, after saved progress brought some from another device (or removed some). */
export async function reloadMyPlayers() {
  const [bases, heads] = await Promise.all([loadBases().catch(() => []), headStyles()]);
  const before = new Map(characters.list.filter((c) => c.mine).map((c) => [c.id, lookOf(c)]));
  const others = characters.list.filter((c) => !c.mine);
  const at = others.findIndex((c) => /^p\d+$/.test(c.id)); // before the approved builder players
  const cut = at < 0 ? others.length : at;
  characters.list = [...others.slice(0, cut), ...minePlayers(bases, heads), ...others.slice(cut)];
  // a player whose look changed (on another device) is drawn afresh; the others stay as they are
  for (const key of characters.loaded.keys()) {
    const id = key.split("@")[0];
    const now = characters.list.find((c) => c.id === id);
    if (/^me\d+$/.test(id) && (!now || lookOf(now) !== before.get(id))) characters.loaded.delete(key);
  }
  const keep = characters.list.some((c) => c.id === characters.selected) ? characters.selected : characters.list[0].id;
  if (keep !== characters.selected || !characters.loaded.has(keyOf(keep, sheet.size))) await useCharacter(keep).catch(() => {});
}

// Players made on this device (saved by the builder's "Play now"), then approved builder players.
async function loadBuiltPlayers() {
  const [bases, heads] = await Promise.all([loadBases().catch(() => []), headStyles()]);
  for (const b of bases) basesById.set(b.id, b);
  const layered = layeredOf(heads, bases);
  characters.list.push(...minePlayers(bases, heads));
  try {
    const res = await fetch(PLAYERS_API);
    if (!res.ok) return;
    const { players } = await res.json();
    for (const p of players) {
      const base = bases.find((b) => b.id === p.base);
      if (!base) continue;
      characters.list.push({
        id: `p${p.id}`,
        name: p.name,
        pronoun: p.pronoun ?? base.pronoun ?? "", // set by the admin, else the body's
        base: p.base,
        thumb: "/" + base.thumb,
        ...layered(p),
        colours: { skin: p.skin, hair: p.hair, jersey: p.jersey, team: p.team, shorts: p.shorts ?? undefined, shoes: p.shoes, number: p.number ?? "", teamName: p.team_name ?? DEFAULT_TEAM },
        build: p.build,
      });
    }
  } catch {
    // Offline or the API is down: the hand-made players still work.
  }
}

// ---------- Faces ----------

// A player's face for the picker and the leaderboard.
// Builder players' faces, drawn once each, so redrawing a list doesn't flash the plain body. Only the
// face's own frame is recoloured (thumbnail), never the whole sheet.
const faces = new Map(); // base + colours -> data URL
const facing = new Map(); // base + colours -> the face being drawn
export function setFace(img, c) {
  if (!c.base) {
    img.src = c.thumb;
    return;
  }
  const key = c.base + JSON.stringify(c.colours);
  if (faces.has(key)) {
    img.src = faces.get(key);
    return;
  }
  img.src = c.thumb;
  // Show their own colours once their base body has loaded.
  if (!facing.has(key)) {
    const p = loadBases()
      .then((list) => {
        const base = list.find((b) => b.id === c.base);
        // (the size the game would use; a drawn body's face needs only its first frame read: loadStill)
        const size = pickSize(base, gameScale(stageWidth()));
        return base.card ? loadBase(base, "/", size) : loadStill(base, "/", size);
      })
      .then((loaded) => {
        faces.set(key, thumbnail(loaded, c.colours).toDataURL());
        return faces.get(key);
      });
    p.catch(() => facing.delete(key));
    facing.set(key, p);
  }
  facing
    .get(key)
    .then((url) => (img.src = url))
    .catch(() => {});
}

// Leaderboard rows show the face of who they played as.
export function boardFace(row, img) {
  const c = characters.list.find((p) => p.id === row.player);
  if (c) return setFace(img, c);
  img.src = characters.list[0].thumb;
  // Players made on someone's device: their own colours, or the body's own if none were sent.
  if (row.base) setFace(img, { thumb: img.src, base: row.base, colours: row.colours ?? {} });
}

// The whole player standing, for the card a leaderboard row opens.
export async function boardBody(row) {
  const c = characters.list.find((p) => p.id === row.player);
  if (!c && row.base) {
    // only the one frame, recoloured (thumbnail-sized work, not the whole sheet)
    const base = (await loadBases()).find((b) => b.id === row.base);
    const loaded = await loadBase(base, "/", pickSize(base, gameScale(stageWidth())));
    return recolor(loaded, row.colours ?? {}, loaded.meta.frames.idle[0].slice(0, 4));
  }
  const entry = c ?? characters.list[0];
  const { meta, img } = await loadCharacter(entry.id, sizeFor(entry));
  const [x, y, w, h] = meta.frames.idle[0];
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  canvas.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h);
  return canvas;
}

// ---------- Frames ----------

// Which way he faces the hoop from where he stands: b (away), bl (up-left), l, fl, f, fr, r, br,
// from the hoop's direction on screen. Sheets drawn in several directions have moves named
// "dribble-bl", "dribble-b"...; the others just have "dribble".
const DIRS = ["r", "fr", "f", "fl", "l", "bl", "b", "br"];
export function faceHoop() {
  faceToward(RIM.u, RIM.v);
}

// Which way each facing points on screen (angle, down is positive). Straight right, down, left and up,
// and the diagonals along the court's own lines, as the isometric art draws them (flatter than 45°).
// (Worked out when used: the court can change.)
const axis = (d) => Math.atan2(d.y, d.x);
const dirAngles = () => ({
  r: 0,
  fr: axis(EV),
  f: Math.PI / 2,
  fl: axis(EU),
  l: Math.PI,
  bl: axis({ x: -EV.x, y: -EV.y }),
  b: -Math.PI / 2,
  br: axis({ x: -EU.x, y: -EU.y }),
});

// Faces him toward a point on the court (where he's jogging to, or the hoop): the facing nearest
// that direction on screen.
export function faceToward(u, v) {
  const p = project(player.u, player.v);
  const h = project(u, v);
  const a = Math.atan2(h.y - p.y, h.x - p.x);
  const DIR_ANGLES = dirAngles();
  const off = (d) => Math.abs(Math.atan2(Math.sin(a - DIR_ANGLES[d]), Math.cos(a - DIR_ANGLES[d])));
  player.dir = DIRS.reduce((best, d) => (off(d) < off(best) ? d : best));
}

// Whether this player's sheet has him jogging (in every direction), so he can run between spots.
export function canJog() {
  const f = sheet.sprites?.frames;
  return !!f && DIRS.every((d) => f[`run-${d}`]);
}

// The name of a move as drawn for the way he's facing, or the nearest way it's drawn (one step
// round, then two...), or plain.
function named(anim) {
  const f = sheet.sprites.frames;
  const at = DIRS.indexOf(player.dir);
  if (at < 0) return f[`${anim}-bl`] ? `${anim}-bl` : anim;
  for (const step of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const name = `${anim}-${DIRS[(at + step + 8) % 8]}`;
    if (f[name]) return name;
  }
  return anim;
}

// Whether this player's sheet has a move at all (a sheet made from video has more of them).
export function hasMove(anim) {
  const f = sheet.sprites?.frames;
  return !!f && !!f[named(anim)];
}

export function frameCount(anim) {
  return sheet.sprites.frames[named(anim)].length;
}

// Where the ball leaves his hands, from his feet, for the way he's facing.
export function releaseOffset() {
  // The shot as drawn for his facing (the nearest drawn way, see named()).
  const drawn = named("jump").split("-")[1];
  return sheet.sprites.releaseOffsets?.[drawn] ?? sheet.sprites.releaseOffset;
}

// Frames per second of a looping move (idle, dribble): a sheet made from video can have more
// frames and play them at its own speed.
export function loopFps(anim) {
  return sheet.sprites.fps?.[named(anim)] ?? sheet.sprites.fps?.[anim] ?? ANIM_FPS[anim];
}

// The frame of the chosen player's sheet to draw now: [x, y, w, h, offset x, offset y].
export function currentFrame() {
  const frames = sheet.sprites.frames[named(player.anim)];
  let i;
  if (player.anim === "jump") i = Math.floor(player.t / JUMP_FRAME_TIME);
  else if (player.anim === "idle" || player.anim === "dribble" || player.anim === "run") i = Math.floor(player.t * loopFps(player.anim)) % frames.length;
  else i = Math.floor(player.t * ANIM_FPS[player.anim]);
  return frames[Math.min(i, frames.length - 1)];
}

// How far a higher jump (the player's `jump` attribute) lifts him right now, in metres: most at the
// top of the jump, none on the floor. 0 for a neutral player.
export function jumpLift() {
  const extra = player.attrs.jump;
  if (!extra) return 0;
  const air = 2 * JUMP_APEX; // takeoff to landing
  const t = player.anim === "jump" ? player.t : player.anim === "release" ? player.airT + player.t : 0;
  if (!(t > 0 && t < air)) return 0;
  const f = t / air;
  return extra * 4 * f * (1 - f);
}

// How far off the floor he's drawn right now, in metres: a dunk's own leap (play/round.js) while
// dunking, else a higher jumper's extra height.
export const liftNow = () => (player.dunk ? player.lift : jumpLift());

// The player's shoes right now, in court pixels.
export function shoePoints() {
  const { sprites, atlas, shoeRegions } = sheet;
  const frame = currentFrame();
  const [, , , , ox, oy] = frame;
  const scale = 1 / sprites.res;
  const p = project(player.u, player.v, liftNow());
  const feet = sprites.feet?.[`${frame[0]},${frame[1]}`] ?? feetIn(atlas, frame, shoeRegions);
  return feet.map(([x, y]) => [p.x + (ox + x) * scale, p.y + (oy + y) * scale]);
}
