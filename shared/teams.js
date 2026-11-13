// The official teams everyone can pick in the player builder, each with a home and an away kit (a kit
// is a jersey colour, a shorts colour and a trim colour: the jersey's edges and the number). Shared so
// the Worker's Top teams board (worker/src/teams.ts) knows which names are official. Kids' own teams
// (players/teams.js) are kept on their device.
//
// The team names are made up (no real teams), except KINGS, the game's own team from the start.

/** @typedef {{ jersey: string, shorts: string, trim: string }} Kit */
/** @type {readonly { id: string, name: string, home: Kit, away: Kit }[]} */
export const TEAMS = Object.freeze([
  { id: "kings", name: "KINGS", home: { jersey: "#2c3e7a", shorts: "#2c3e7a", trim: "#f2f2ef" }, away: { jersey: "#f2f2ef", shorts: "#2c3e7a", trim: "#2c3e7a" } },
  { id: "comets", name: "COMETS", home: { jersey: "#f2cf3d", shorts: "#2c3e7a", trim: "#2c3e7a" }, away: { jersey: "#2c3e7a", shorts: "#2c3e7a", trim: "#f2cf3d" } },
  { id: "sharks", name: "SHARKS", home: { jersey: "#59b7e8", shorts: "#2b2b2f", trim: "#2b2b2f" }, away: { jersey: "#f2f2ef", shorts: "#59b7e8", trim: "#59b7e8" } },
  { id: "dragons", name: "DRAGONS", home: { jersey: "#d63a3a", shorts: "#d63a3a", trim: "#f2cf3d" }, away: { jersey: "#2b2b2f", shorts: "#2b2b2f", trim: "#d63a3a" } },
  { id: "foxes", name: "FOXES", home: { jersey: "#f08a3c", shorts: "#f2f2ef", trim: "#f2f2ef" }, away: { jersey: "#f2f2ef", shorts: "#f08a3c", trim: "#f08a3c" } },
  { id: "robots", name: "ROBOTS", home: { jersey: "#2b2b2f", shorts: "#2b2b2f", trim: "#3fa65c" }, away: { jersey: "#3fa65c", shorts: "#2b2b2f", trim: "#2b2b2f" } },
]);

/** The game's own team: Orson's, and anyone's who didn't pick one. */
export const DEFAULT_TEAM = "KINGS";

/** How many of a team's best players add up to its score on the Top teams board. */
export const TEAM_COUNTS = 3;

/**
 * A team name as it's printed and saved: capitals, numbers and spaces, at most 10, or "" if there's
 * nothing left of it.
 * @param {unknown} name
 */
export const teamNameOf = (name) =>
  String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10)
    .trim();
