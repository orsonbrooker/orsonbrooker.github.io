// Teams for the player builder. Every team has a home kit and an away kit; a kit is a jersey colour,
// a shorts colour and a trim colour (the jersey's edges and the number). Kids pick one of the teams
// everyone has, or make their own, kept on this device.
//
// The official teams are in shared/teams.js (the Worker's Top teams board knows them too).

import { TEAMS } from "../shared/teams.js";

export { TEAMS };

export const KIT_PARTS = ["jersey", "shorts", "trim"];
const HEX = /^#[0-9a-f]{6}$/;
const MY_TEAMS = "orson-hoops-my-teams";
const MAX_MY_TEAMS = 12;

const goodKit = (k) => k && KIT_PARTS.every((p) => HEX.test(k[p] ?? ""));
const goodTeam = (t) => t && typeof t.id === "string" && typeof t.name === "string" && goodKit(t.home) && goodKit(t.away);

/** Teams this device made, newest last. */
export function myTeams() {
  try {
    const list = JSON.parse(localStorage.getItem(MY_TEAMS) ?? "[]");
    return Array.isArray(list) ? list.filter(goodTeam) : [];
  } catch {
    return [];
  }
}

export function saveMyTeams(list) {
  try {
    localStorage.setItem(MY_TEAMS, JSON.stringify(list.slice(-MAX_MY_TEAMS)));
  } catch {
    // Storage blocked: the teams last for this visit.
  }
}

/** A new team of this device's, ready to edit. */
export function newTeam(count) {
  const green = "#3fa65c";
  const white = "#f2f2ef";
  return {
    id: `mine${Date.now()}`,
    name: count ? `MY TEAM ${count + 1}` : "MY TEAM",
    home: { jersey: green, shorts: green, trim: white },
    away: { jersey: white, shorts: green, trim: green },
  };
}

/** The colours a player wears in a kit: jersey, shorts, and the trim (saved as the team colour). */
export const kitColours = (kit) => ({ jersey: kit.jersey, shorts: kit.shorts, team: kit.trim });
