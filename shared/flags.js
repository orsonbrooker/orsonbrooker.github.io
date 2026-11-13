// Feature flags: things that are built but not out yet, switched on by Luke on the admin page's Flags
// section. The list lives here, once: the game (flags.js) asks whether one is on, the Worker refuses
// what a hidden one would send (scores for a hidden mode, a hidden builder body), and the admin page
// lists them. The database only holds which are on (worker/src/flags.ts); anything not in it is off.
//
// To add one: an entry here, then `flagOn("key")` (flags.js) where the game shows it (and a Worker check if it sends
// anything). To retire one once it's out for good: take out the checks, then the entry.

/** @typedef {{ key: string, name: string, hides: string, modes?: string[], bodies?: string[] }} Flag */

/** @type {readonly Flag[]} */
export const FLAGS = Object.freeze([
  { key: "threes", name: "3-point contest", hides: "The 3-point contest: its card on Choose a game, its leaderboard tab and help.", modes: ["threes"] },
  {
    key: "videokids",
    name: "Curly and Buns from video",
    hides: "Curly and Buns made from video: they turn all the way round, change size (the builder's Body tab) and can wear gear. Off, the builder and the game use their old drawn bodies, and the server refuses a player with a size.",
  },
  { key: "gear", name: "Gear", hides: "Gear for kids from video (caps, beanies, headbands, flame shoes and more) in the builder's Gear tab, and on them in the game. Needs Curly and Buns from video on too." },
  { key: "freeplay", name: "Free play", hides: "Free play (move around and shoot from anywhere): its card on Choose a game.", modes: ["free"] },
]);

export const FLAG_KEYS = FLAGS.map((f) => f.key);

/** The flag that hides a game mode, or undefined if the mode is out for everyone. @param {string} mode */
export const flagForMode = (mode) => FLAGS.find((f) => f.modes?.includes(mode))?.key;

/** The flag that hides a builder body, or undefined if the body is out for everyone. @param {string} base */
export const flagForBody = (base) => FLAGS.find((f) => f.bodies?.includes(base))?.key;

/**
 * Which flags `?flags=` turns on: a comma list of keys, or "all". Unknown keys are left out.
 * @param {string | null} param
 * @returns {string[]}
 */
export function parseFlagList(param) {
  if (!param) return [];
  const asked = param.split(",").map((s) => s.trim().toLowerCase());
  return asked.includes("all") ? [...FLAG_KEYS] : FLAG_KEYS.filter((k) => asked.includes(k));
}
