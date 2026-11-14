// Community teams (behind the `teams` flag): teams kids make, apart from the six official ones. Private
// from the start: friends join with a code, shared in person. The maker can ask for a team to be shown
// to everyone (Luke OKs the name). The server is worker/src/teams.ts.
//
// This device keeps the teams it's on (and, for teams it made, their codes: the server only keeps a
// hash) so the builder and the game work offline. Which of its players wears which team is kept with
// the player (colours.teamId).

import { API } from "../api.js";
import { deviceId } from "../leaderboard.js";

const KEPT = "orson-hoops-community-teams";
const HEX = /^#[0-9a-f]{6}$/;
const goodKit = (k) => k && ["jersey", "shorts", "trim"].every((p) => HEX.test(k[p] ?? ""));
const good = (t) => t && /^c\d{1,10}$/.test(t.key) && typeof t.name === "string" && goodKit(t.home) && goodKit(t.away);

/** The community teams this device is on or made, as last seen: { id, key, name, home, away, maker?, listing?, code? }. */
export function keptTeams() {
  try {
    const list = JSON.parse(localStorage.getItem(KEPT) ?? "[]");
    return Array.isArray(list) ? list.filter(good) : [];
  } catch {
    return [];
  }
}

function keep(list) {
  try {
    localStorage.setItem(KEPT, JSON.stringify(list));
  } catch {
    // Storage blocked: they last for this visit (the server still knows).
  }
}

/** A kept team, by key ("c12"). */
export const keptTeam = (key) => keptTeams().find((t) => t.key === key) ?? null;

function remember(team, code) {
  const old = keptTeam(team.key);
  const t = { ...old, ...team, ...(code ? { code } : {}) };
  keep([...keptTeams().filter((k) => k.key !== team.key), t]);
  return t;
}

async function post(path, body = {}) {
  const res = await fetch(`${API}/teams${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device: deviceId(), ...body }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || "That didn't work. Please try again.");
  return out;
}

/** This device's teams, fresh from the server (kept codes stay). Falls back to the kept ones offline. */
export async function refreshTeams() {
  try {
    const { teams, most } = await post("/mine");
    const codes = new Map(keptTeams().map((t) => [t.key, t.code]));
    const list = teams.map((t) => ({ ...t, ...(codes.get(t.key) ? { code: codes.get(t.key) } : {}) }));
    keep(list);
    return { teams: list, most };
  } catch {
    return { teams: keptTeams(), most: 3, offline: true };
  }
}

/** Listed community teams anyone can join: [{ id, key, name, home, away, members }]. */
export async function listedTeams() {
  try {
    const res = await fetch(`${API}/teams/list`);
    if (!res.ok) return [];
    return (await res.json()).teams.filter(good);
  } catch {
    return [];
  }
}

/** Makes a team: { name, home, away, turnstileToken } → the team, with its code. */
export async function makeTeam(team) {
  const { team: made, code } = await post("", team);
  return remember(made, code);
}

/** Joins with a code, or a listed team by id. */
export async function joinTeam({ code, id }) {
  const { team } = await post("/join", code !== undefined ? { code } : { id });
  return remember(team);
}

export async function leaveTeam(team) {
  await post("/leave", { id: team.id });
  keep(keptTeams().filter((t) => t.key !== team.key));
}

/** The maker's changes: "code", "list" (with turnstileToken), "unlist", "kit" ({ home, away }), "name" ({ name, turnstileToken }). */
export async function changeTeam(team, action, extra = {}) {
  const { team: now, code } = await post(`/${team.id}`, { action, ...extra });
  return remember(now, code);
}

/** A team's rank and players, for a device on it (a private team's rank is just for its members). */
export const teamStanding = (key, mode, range) => post("/players", { key, mode, range });

// ---------- The device's team ----------

// The team this device plays for when it plays as Orson or someone else's approved player (who have no
// team of their own here): chosen the first time it plays (screens/team.js). Its own players wear the
// team picked for them in the builder.
const MY_TEAM = "orson-hoops-my-team";

/** The device's team: { name, key? } (key for a community team), or null if it hasn't chosen one. */
export function myTeam() {
  try {
    const t = JSON.parse(localStorage.getItem(MY_TEAM) ?? "null");
    return t && typeof t.name === "string" && t.name && (t.key === undefined || /^c\d{1,10}$/.test(t.key)) ? { name: t.name, ...(t.key ? { key: t.key } : {}) } : null;
  } catch {
    return null;
  }
}

/** Sets (or, with null, forgets) the device's team: an official team or a kept community team. */
export function setMyTeam(t) {
  try {
    if (t) localStorage.setItem(MY_TEAM, JSON.stringify(t.key ? { name: t.name, key: t.key } : { name: t.name }));
    else localStorage.removeItem(MY_TEAM);
  } catch {
    // Storage blocked: they choose again next visit.
  }
}

/**
 * The community teams this device was on and isn't any more (Luke hid one, or it left on another
 * device), asked once a visit by the game: [{ key, name }]. None offline, or when it's on none.
 */
export async function goneTeams() {
  const before = keptTeams().filter((t) => t.member !== false);
  if (!before.length) return [];
  const { teams, offline } = await refreshTeams();
  if (offline) return [];
  return before.filter((b) => !teams.some((t) => t.key === b.key && t.member !== false)).map(({ key, name }) => ({ key, name }));
}
