// What else travels with saved progress (beyond coins and balls): personal bests, the daily challenge
// streak, players made in the builder and the nickname. Shared by the game (progress.js) and the
// Worker (worker/src/progress.ts), so both tidy and merge it the same way.
//
// Merging never loses anything: the better best, the longer streak, both devices' players (unless one
// was removed), the nickname typed most recently.
//
// A save: {
//   bests: { timed, survival, around, threes }   numbers; 0 is no best (Around the World is seconds, lower wins)
//   daily: { done, last, days }                  the date today's challenge was last done ("2026-11-09"), the streak
//   players: [{ id, name, base, colours, pronoun?, build?, gear?, sent? }]   made in the builder, newest first
//   gone: [id]                                   players removed, so a merge doesn't bring them back
//   nickname: { name, at }                       the leaderboard nickname, and when it was typed (ms)
//   team: { name, key?, at }                     the team the device plays for as Orson (key: a community
//                                                team), and when it was chosen (ms); name "" is none
// }

import { MODES, lowWins } from "./rules.js";

/** @typedef {{ id: string, name: string, base: string, colours: Record<string, string>, pronoun?: "he" | "she", build?: { height: number, bulk: number }, gear?: Record<string, string>, sent?: true, teamPicked?: true }} SavedPlayer */
/** @typedef {{ name: string, key?: string, at: number }} SavedTeam */
/** @typedef {{ bests: Record<string, number>, daily: { done: string, last: string, days: number }, players: SavedPlayer[], gone: string[], nickname: { name: string, at: number }, team: SavedTeam }} Save */

export const MAX_SAVED_PLAYERS = 6;
const MAX_GONE = 50;
const MAX_NAME = 12;
const MAX_TEAM = 10;
const PARTS = ["skin", "hair", "jersey", "team", "shoes"];
const GEAR_SLOTS = ["head", "face", "jersey", "arms", "legs", "shoes"]; // as in content/gear.json
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const NICKNAME = /^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u;

/** @type {(v: unknown, max: number) => string} */
const text = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** @type {(v: unknown, max: number) => number} */
const num = (v, max) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : 0);
/** @type {(v: unknown) => Record<string, any>} */
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

/** @param {unknown} raw @returns {SavedPlayer | null} */
function tidyPlayer(raw) {
  const p = obj(raw);
  const id = text(p.id, 20);
  const name = text(p.name, MAX_NAME);
  const base = text(p.base, 30);
  if (!/^me\d{1,15}$/.test(id) || !NICKNAME.test(name) || !/^[a-z0-9-]+$/.test(base)) return null;
  const c = obj(p.colours);
  if (!PARTS.every((part) => HEX.test(c[part] ?? ""))) return null;
  const colours = Object.fromEntries(PARTS.map((part) => [part, c[part].toLowerCase()]));
  if (HEX.test(c.shorts ?? "")) colours.shorts = c.shorts.toLowerCase(); // shorts of their own (else the team colour)
  const number = text(String(c.number ?? ""), 2);
  colours.number = /^\d{1,2}$/.test(number) ? number : "";
  if (typeof c.teamName === "string") {
    const team = text(c.teamName, MAX_TEAM).toUpperCase();
    if (team === "" || /^[A-Z0-9 ]+$/.test(team)) colours.teamName = team;
  }
  if (typeof c.teamId === "string" && /^c\d{1,10}$/.test(c.teamId)) colours.teamId = c.teamId; // a community team (worker/src/teams.ts)
  /** @type {SavedPlayer} */
  const player = { id, name, base, colours };
  if (p.pronoun === "he" || p.pronoun === "she") player.pronoun = p.pronoun;
  if (p.sent === true) player.sent = true; // sent to Orson (sending again sends the new look)
  if (p.teamPicked === true) player.teamPicked = true; // the kid picked their team (players/recolor.js teamPicked)
  // their size: height and build (bulk), -1 to 1 each
  const b = obj(p.build);
  /** @type {(v: unknown) => number} */
  const step = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100 : 0);
  if (step(b.height) || step(b.bulk)) player.build = { height: step(b.height), bulk: step(b.bulk) };
  // what they wear: one item per slot (content/gear.json), by id
  const gear = Object.entries(obj(p.gear)).filter(([slot, id]) => GEAR_SLOTS.includes(slot) && typeof id === "string" && /^[a-z0-9-]{1,20}$/.test(id));
  if (gear.length) player.gear = Object.fromEntries(gear);
  return player;
}

/**
 * A save made safe: only what's known, in the right shapes and sizes. Anything else is dropped.
 * @param {unknown} raw
 * @returns {Save}
 */
export function tidySave(raw) {
  const s = obj(raw);
  const b = obj(s.bests);
  const bests = Object.fromEntries(MODES.map((m) => [m, num(b[m], 100000)]));
  const d = obj(s.daily);
  const daily = {
    done: DATE.test(d.done ?? "") ? d.done : "",
    last: DATE.test(d.last ?? "") ? d.last : "",
    days: DATE.test(d.last ?? "") ? Math.floor(num(d.days, 100000)) : 0,
  };
  const gone = [...new Set((Array.isArray(s.gone) ? s.gone : []).map((/** @type {unknown} */ id) => text(id, 20)).filter((id) => /^me\d{1,15}$/.test(id)))].slice(0, MAX_GONE);
  const seen = new Set();
  const players = (Array.isArray(s.players) ? s.players : [])
    .slice(0, 20)
    .map(tidyPlayer)
    .filter(/** @returns {p is SavedPlayer} */ (p) => !!p && !gone.includes(p.id) && !seen.has(p.id) && !!seen.add(p.id))
    .slice(0, MAX_SAVED_PLAYERS);
  const n = obj(s.nickname);
  const name = text(n.name, MAX_NAME);
  const nickname = NICKNAME.test(name) ? { name, at: Math.floor(num(n.at, 1e14)) } : { name: "", at: 0 };
  const t = obj(s.team);
  const teamName = text(t.name, MAX_TEAM).toUpperCase();
  /** @type {SavedTeam} */
  const team = /^[A-Z0-9 ]*$/.test(teamName) ? { name: teamName, at: Math.floor(num(t.at, 1e14)) } : { name: "", at: 0 };
  if (team.name && typeof t.key === "string" && /^c\d{1,10}$/.test(t.key)) team.key = t.key; // a community team (worker/src/teams.ts)
  return { bests, daily, players, gone, nickname, team: { name: team.name, ...(team.key ? { key: team.key } : {}), at: team.at } };
}

/** @type {(mode: typeof MODES[number], a: number, b: number) => number} */
const better = (mode, a, b) => {
  if (!a || !b) return a || b;
  return lowWins(mode) ? Math.min(a, b) : Math.max(a, b);
};

/**
 * Two tidy saves as one, losing nothing.
 * @param {Save} a
 * @param {Save} b
 * @returns {Save}
 */
export function mergeSaves(a, b) {
  const bests = Object.fromEntries(MODES.map((m) => [m, better(m, a.bests[m], b.bests[m])]));
  // The streak from whichever device did a challenge last (on the same day, the longer one).
  const [x, y] = [a.daily, b.daily];
  const later = x.last > y.last || (x.last === y.last && x.days >= y.days) ? x : y;
  const daily = { done: x.done > y.done ? x.done : y.done, last: later.last, days: later.days };
  const gone = [...new Set([...a.gone, ...b.gone])].slice(0, MAX_GONE);
  // Both lists, newest made first (ids are "me" + when it was made). The same player on both: the
  // first save's (the device sending it, which has the latest edits). Two with the same name (made on
  // each device): just one, as the builder keeps one player per name.
  const byId = new Map();
  const names = new Set();
  for (const p of [...a.players, ...b.players]) {
    if (gone.includes(p.id) || byId.has(p.id) || names.has(p.name.toLowerCase())) continue;
    byId.set(p.id, p);
    names.add(p.name.toLowerCase());
  }
  const players = [...byId.values()].sort((p, q) => Number(q.id.slice(2)) - Number(p.id.slice(2))).slice(0, MAX_SAVED_PLAYERS);
  const nickname = b.nickname.at > a.nickname.at ? b.nickname : a.nickname;
  const team = b.team.at > a.team.at ? b.team : a.team; // the team chosen most recently
  return { bests, daily, players, gone, nickname, team };
}

/** Whether two tidy saves are the same (so nothing needs writing). @type {(a: Save, b: Save) => boolean} */
export const sameSave = (a, b) => JSON.stringify(a) === JSON.stringify(b);
