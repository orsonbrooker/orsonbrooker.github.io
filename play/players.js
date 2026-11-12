// Who you play as: the list of players, loading their sprite sheets, their faces for the picker and
// the leaderboard, and which frame of the chosen player's sheet to draw right now.
//
// assets/characters/index.json lists the hand-made players (tools/build_character.py). Players
// made with the builder (/players/) come from the API once approved, drawn from a base body in
// their chosen colours.

import { API } from "../api.js";
import { attributesFor } from "../content/attributes.js";
import { EU, EV, RIM, project } from "../engine/court.js";
import { shoesIn } from "../engine/draw.js";
import { load, save } from "../engine/storage.js";
import { ANIM_FPS, JUMP_APEX, JUMP_FRAME_TIME, player } from "../play/state.js";
import { buildPlayer, loadHeads } from "../players/layered.js";
import { paletteSwap } from "../players/pixelkit.js";
import { stretchSheet } from "../players/stretch.js";
import { DEFAULT_TEAM, loadBase, loadBases, myPlayers, recolor, thumbnail } from "../players/recolor.js";

const PLAYERS_API = `${API}/players`;
export const characters = {
  list: [{ id: "orson", name: "Orson", pronoun: "he", atlas: "assets/sprites.webp", meta: "assets/sprites.json", thumb: "" }],
  loaded: new Map(),
  selected: load("orson-hoops-character", "orson"),
};

// The chosen player's sprite sheet: frame positions (sprites), the image (atlas), and for builder
// players which pixels are shoes (shoeRegions).
export const sheet = { sprites: null, atlas: null, shoeRegions: null, prints: null };

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadBuilt(entry) {
  const base = (await loadBases()).find((b) => b.id === entry.base);
  if (base.video) {
    // a kid made from their own videos: their full-detail sheet in the player's colours, as for Orson
    const [meta, img, regions] = await Promise.all([fetch("/" + base.meta).then((r) => r.json()), loadImage("/" + base.atlas), loadImage("/" + base.regions)]);
    const kit = await withKit(meta, img, entry, entry.colours);
    if (!+entry.build?.height && !+entry.build?.bulk) return kit;
    // their height and build: the frames stretched, the number and team name with them
    const c = Object.assign(document.createElement("canvas"), { width: regions.width, height: regions.height });
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(regions, 0, 0);
    const s = stretchSheet({ meta: kit.meta, img: kit.img, prints: kit.img.prints }, g.getImageData(0, 0, c.width, c.height), entry.build);
    return { meta: s.meta, img: s.img };
  }
  const loaded = await loadBase(base);
  return { meta: loaded.meta, img: recolor(loaded, entry.colours), loaded };
}

// A sheet made from video has a plain jersey: print his number and team name on it. A pixel-art
// sheet carries its own jersey faces; a full-detail one borrows them from its pixel-art twin
// (`printsFrom`), whose frames sit at the same places, `scale` times smaller.
// `colours` (optional) recolours it like a builder player: { skin, hair, jersey, team, shoes,
// number, teamName }.
async function withKit(meta, img, entry, colours = {}) {
  const kit = { number: colours.number ?? 28, team: colours.teamName ?? DEFAULT_TEAM };
  const parts = Object.fromEntries(Object.entries(colours).filter(([k]) => ["skin", "hair", "jersey", "team", "shoes"].includes(k)));
  if (meta.prints || meta.faces) {
    const c = paletteSwap(img, meta, parts, kit);
    return { meta, img: Object.assign(c, { prints: c.printLayers }) };
  }
  if (meta.printsFrom) {
    const { atlas, meta: url, frames } = meta.printsFrom;
    const [pm, pimg, regions] = await Promise.all([
      fetch(url).then((r) => r.json()),
      loadImage(atlas),
      Object.keys(parts).length ? loadImage(meta.regionsFile) : null,
    ]);
    // His colours, the way builder players get theirs (players/recolor.js), from the region map.
    let out = img;
    if (regions) {
      const c = Object.assign(document.createElement("canvas"), { width: regions.width, height: regions.height });
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(regions, 0, 0);
      const regionsData = g.getImageData(0, 0, c.width, c.height);
      out = recolor({ atlasImg: img, regionsData, meta, colours: meta.colours }, parts);
    }
    // The number and team name come from the pixel-art twin's jersey faces, in his team colour.
    const layers = paletteSwap(pimg, pm, parts, kit).printLayers ?? new Map();
    const prints = new Map();
    for (const [key, pixelKey] of Object.entries(frames)) if (layers.has(pixelKey)) prints.set(key, layers.get(pixelKey));
    return { meta, img: Object.assign(out, { prints }) };
  }
  return { meta, img };
}

async function loadCharacter(id) {
  if (!characters.loaded.has(id)) {
    const entry = characters.list.find((c) => c.id === id) ?? characters.list[0];
    const font = document.fonts?.load('16px "Press Start 2P"').catch(() => {}); // for printing the number
    const loading = entry.layered
      ? Promise.all([buildPlayer(entry.layered), font]).then(([{ meta, img }]) => withKit(meta, img, entry, entry.colours))
      : entry.base
      ? loadBuilt(entry)
      : Promise.all([
          fetch(entry.meta).then((r) => r.json()),
          loadImage(entry.atlas),
          document.fonts?.load('16px "Press Start 2P"').catch(() => {}), // for printing the number
        ]).then(([meta, img]) => withKit(meta, img, entry, entry.colours));
    characters.loaded.set(id, loading);
    loading.catch(() => characters.loaded.delete(id));
  }
  return characters.loaded.get(id);
}

// Plays as this player from now on (and remembers it, unless it's only for now: a turn in a pass and
// play game, or a replay).
export async function useCharacter(id, { remember = true } = {}) {
  const { meta, img, loaded } = await loadCharacter(id);
  sheet.sprites = meta;
  sheet.atlas = img;
  sheet.prints = img.prints ?? null; // a video sheet's number and team name, drawn over each frame
  sheet.shoeRegions = loaded?.regionsData ?? null; // builder players: which pixels are shoes
  characters.selected = id;
  player.attrs = attributesFor(id);
  player.pronoun = (characters.list.find((c) => c.id === id) ?? characters.list[0]).pronoun ?? "";
  if (remember) save("orson-hoops-character", id);
}

// Starts loading a player's sprite sheet, so switching to them later is quick.
export const preloadCharacter = (id) => loadCharacter(id).catch(() => {});

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
  if (orson && params.has("old")) Object.assign(orson, { atlas: "assets/sprites.webp", meta: "assets/sprites.json" });
  if (orson && params.has("pixel")) Object.assign(orson, { atlas: "assets/characters/orson-pixel/sprites.png", meta: "assets/characters/orson-pixel/sprites.json" });
  // ?head=orson&height=1&bulk=-1: him as a layered player (players/layered.js), with that head and build.
  if (orson && /^[a-z-]+$/.test(params.get("head") ?? "")) orson.layered = { head: params.get("head"), build: { height: params.get("height"), bulk: params.get("bulk") } };
  const custom = {};
  for (const k of ["skin", "hair", "jersey", "team", "shoes"]) if (/^[0-9a-f]{6}$/i.test(params.get(k) ?? "")) custom[k] = `#${params.get(k).toLowerCase()}`;
  if (/^\d{1,2}$/.test(params.get("number") ?? "")) custom.number = params.get("number");
  if (params.get("teamName")) custom.teamName = params.get("teamName").toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 10);
  if (orson && Object.keys(custom).length) orson.colours = custom;
  await loadBuiltPlayers();
  const moved = MOVED[characters.selected];
  if (moved && characters.list.some((c) => c.id === moved)) characters.selected = moved;
  if (!characters.list.some((c) => c.id === characters.selected)) characters.selected = characters.list[0].id;
}

// Players made on this device (or on another of theirs, with saved progress), as picker entries.
// A body whose head has been made for the layered players moves like Orson (players/layered.js);
// the others keep their hand-drawn sheet.
// A kid made from their own videos (Curly, Buns) moves as themselves.
const layeredOf = (heads, bases = []) => (p) =>
  bases.find((b) => b.id === p.base)?.video ? {} : heads[p.base] ? { layered: { head: p.base, build: p.build ?? {} } } : {};

function minePlayers(bases, heads) {
  const layered = layeredOf(heads, bases);
  return myPlayers().flatMap((p) => {
    const base = bases.find((b) => b.id === p.base);
    return base ? [{ ...p, ...layered(p), pronoun: p.pronoun || base.pronoun || "", mine: true, thumb: "/" + base.thumb, colours: { teamName: DEFAULT_TEAM, ...p.colours } }] : [];
  });
}

/** Their own players again, after saved progress brought some from another device (or removed some). */
export async function reloadMyPlayers() {
  const [bases, heads] = await Promise.all([loadBases().catch(() => []), loadHeads()]);
  const others = characters.list.filter((c) => !c.mine);
  const at = others.findIndex((c) => /^p\d+$/.test(c.id)); // before the approved builder players
  const cut = at < 0 ? others.length : at;
  characters.list = [...others.slice(0, cut), ...minePlayers(bases, heads), ...others.slice(cut)];
  for (const id of characters.loaded.keys()) if (/^me\d+$/.test(id)) characters.loaded.delete(id); // colours may have changed
  const keep = characters.list.some((c) => c.id === characters.selected) ? characters.selected : characters.list[0].id;
  if (keep !== characters.selected || /^me\d+$/.test(keep)) await useCharacter(keep).catch(() => {});
}

// Players made on this device (saved by the builder's "Play now"), then approved builder players.
async function loadBuiltPlayers() {
  const [bases, heads] = await Promise.all([loadBases().catch(() => []), loadHeads()]);
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
        colours: { skin: p.skin, hair: p.hair, jersey: p.jersey, team: p.team, shoes: p.shoes, number: p.number ?? "", teamName: p.team_name ?? DEFAULT_TEAM },
      });
    }
  } catch {
    // Offline or the API is down: the hand-made players still work.
  }
}

// ---------- Faces ----------

// A player's face for the picker and the leaderboard.
// Builder players' faces, drawn once each, so redrawing a list doesn't flash the plain body.
const faces = new Map(); // base + colours -> data URL
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
  loadBuilt(c)
    .then(({ loaded }) => {
      faces.set(key, thumbnail(loaded, c.colours).toDataURL());
      img.src = faces.get(key);
    })
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
  let meta, img;
  if (c) ({ meta, img } = await loadCharacter(c.id));
  else if (row.base) {
    const base = (await loadBases()).find((b) => b.id === row.base);
    const loaded = await loadBase(base);
    ({ meta } = loaded);
    img = recolor(loaded, row.colours ?? {});
  } else ({ meta, img } = await loadCharacter(characters.list[0].id));
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
  const [, , , , ox, oy] = currentFrame();
  const scale = 1 / sprites.res;
  const p = project(player.u, player.v, liftNow());
  const frames = sprites.frames[named(player.anim)];
  const i = frames.indexOf(currentFrame());
  const feet = shoesIn(atlas, sprites, shoeRegions)[named(player.anim)][i];
  return feet.map(([x, y]) => [p.x + (ox + x) * scale, p.y + (oy + y) * scale]);
}
