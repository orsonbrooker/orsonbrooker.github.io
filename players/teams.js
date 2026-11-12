// Teams for the player builder. Every team has a home kit and an away kit; a kit is a jersey colour,
// a shorts colour and a trim colour (the jersey's edges and the number). Kids pick one of the teams
// everyone has, or make their own, kept on this device.
//
// The team names are made up (no real teams), except KINGS, the game's own team from the start.

export const TEAMS = [
  { id: "kings", name: "KINGS", home: { jersey: "#2c3e7a", shorts: "#2c3e7a", trim: "#f2f2ef" }, away: { jersey: "#f2f2ef", shorts: "#2c3e7a", trim: "#2c3e7a" } },
  { id: "comets", name: "COMETS", home: { jersey: "#f2cf3d", shorts: "#2c3e7a", trim: "#2c3e7a" }, away: { jersey: "#2c3e7a", shorts: "#2c3e7a", trim: "#f2cf3d" } },
  { id: "sharks", name: "SHARKS", home: { jersey: "#59b7e8", shorts: "#2b2b2f", trim: "#2b2b2f" }, away: { jersey: "#f2f2ef", shorts: "#59b7e8", trim: "#59b7e8" } },
  { id: "dragons", name: "DRAGONS", home: { jersey: "#d63a3a", shorts: "#d63a3a", trim: "#f2cf3d" }, away: { jersey: "#2b2b2f", shorts: "#2b2b2f", trim: "#d63a3a" } },
  { id: "foxes", name: "FOXES", home: { jersey: "#f08a3c", shorts: "#f2f2ef", trim: "#f2f2ef" }, away: { jersey: "#f2f2ef", shorts: "#f08a3c", trim: "#f08a3c" } },
  { id: "robots", name: "ROBOTS", home: { jersey: "#2b2b2f", shorts: "#2b2b2f", trim: "#3fa65c" }, away: { jersey: "#3fa65c", shorts: "#2b2b2f", trim: "#2b2b2f" } },
];

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
