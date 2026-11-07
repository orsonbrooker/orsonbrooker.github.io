// Who you play as: the list of players, loading their sprite sheets, their faces for the picker and
// the leaderboard, and which frame of the chosen player's sheet to draw right now.
//
// assets/characters/index.json lists the hand-made players (tools/build_character.py). Players
// made with the builder (/players/) come from the API once approved, drawn from a base body in
// their chosen colours.

import { API } from "../api.js";
import { attributesFor } from "../content/attributes.js";
import { project } from "../engine/court.js";
import { shoesIn } from "../engine/draw.js";
import { load, save } from "../engine/storage.js";
import { ANIM_FPS, JUMP_APEX, JUMP_FRAME_TIME, player } from "../play/state.js";
import { DEFAULT_TEAM, loadBase, loadBases, myPlayers, recolor, thumbnail } from "../players/recolor.js";

const PLAYERS_API = `${API}/players`;
export const characters = {
  list: [{ id: "orson", name: "Orson", pronoun: "he", atlas: "assets/sprites.webp", meta: "assets/sprites.json", thumb: "" }],
  loaded: new Map(),
  selected: load("orson-hoops-character", "orson"),
};

// The chosen player's sprite sheet: frame positions (sprites), the image (atlas), and for builder
// players which pixels are shoes (shoeRegions).
export const sheet = { sprites: null, atlas: null, shoeRegions: null };

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
  const loaded = await loadBase(base);
  return { meta: loaded.meta, img: recolor(loaded, entry.colours), loaded };
}

async function loadCharacter(id) {
  if (!characters.loaded.has(id)) {
    const entry = characters.list.find((c) => c.id === id) ?? characters.list[0];
    const loading = entry.base
      ? loadBuilt(entry)
      : Promise.all([fetch(entry.meta).then((r) => r.json()), loadImage(entry.atlas)]).then(([meta, img]) => ({ meta, img }));
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
  sheet.shoeRegions = loaded?.regionsData ?? null; // builder players: which pixels are shoes
  characters.selected = id;
  player.attrs = attributesFor(id);
  player.pronoun = (characters.list.find((c) => c.id === id) ?? characters.list[0]).pronoun ?? "";
  if (remember) save("orson-hoops-character", id);
}

// Starts loading a player's sprite sheet, so switching to them later is quick.
export const preloadCharacter = (id) => loadCharacter(id).catch(() => {});

// The hand-made players, then ones made on this device, then approved builder players. Falls back to
// the first player if the remembered one is gone.
export async function loadRoster() {
  const list = await fetch("assets/characters/index.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (list?.length) characters.list = list;
  await loadBuiltPlayers();
  if (!characters.list.some((c) => c.id === characters.selected)) characters.selected = characters.list[0].id;
}

// Players made on this device (saved by the builder's "Play now"), then approved builder players.
async function loadBuiltPlayers() {
  const bases = await loadBases().catch(() => []);
  for (const p of myPlayers()) {
    const base = bases.find((b) => b.id === p.base);
    if (base) characters.list.push({ ...p, pronoun: p.pronoun || base.pronoun || "", mine: true, thumb: "/" + base.thumb, colours: { teamName: DEFAULT_TEAM, ...p.colours } });
  }
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

export function frameCount(anim) {
  return sheet.sprites.frames[anim].length;
}

// The frame of the chosen player's sheet to draw now: [x, y, w, h, offset x, offset y].
export function currentFrame() {
  const frames = sheet.sprites.frames[player.anim];
  let i;
  if (player.anim === "jump") i = Math.floor(player.t / JUMP_FRAME_TIME);
  else if (player.anim === "idle" || player.anim === "dribble") i = Math.floor(player.t * ANIM_FPS[player.anim]) % frames.length;
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

// The player's shoes right now, in court pixels.
export function shoePoints() {
  const { sprites, atlas, shoeRegions } = sheet;
  const [, , , , ox, oy] = currentFrame();
  const scale = 1 / sprites.res;
  const p = project(player.u, player.v, jumpLift());
  const frames = sprites.frames[player.anim];
  const i = frames.indexOf(currentFrame());
  const feet = shoesIn(atlas, sprites, shoeRegions)[player.anim][i];
  return feet.map(([x, y]) => [p.x + (ox + x) * scale, p.y + (oy + y) * scale]);
}
