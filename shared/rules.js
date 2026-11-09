// Shootaround's scoring rules, used by both the game (in the browser) and the Worker (which checks
// every score sent to the leaderboard). One copy, so they can't drift apart: change a rule here and
// both sides change. Plain JavaScript with no imports, so the browser can load it as it is.
// Tests: worker/test/rules.test.ts (run `npm --prefix worker test`).

/** A game of Time attack lasts this long. */
export const GAME_SECONDS = 60;

/** The game modes, each with its own leaderboard. */
export const MODES = /** @type {const} */ (["timed", "survival", "around", "threes"]);
/** @typedef {typeof MODES[number]} Mode */

/**
 * Anything that isn't a known mode is Time attack (older games sent no mode).
 * @param {unknown} value
 * @returns {Mode}
 */
export const modeOf = (value) => (value === "survival" || value === "around" || value === "threes" ? value : "timed");

/** Around the World: spots to score from, in order. Its "score" is the time in tenths of a second. */
export const AROUND_SPOTS = 7;

/**
 * 3-point contest: a rack of balls at each spot round the 3-point line, shot in order. Every shot is a
 * three, and the last ball of each rack is a money ball (double points). It ends when the clock runs
 * out or the last rack is shot, whichever comes first. Its score is points, like Time attack.
 */
export const THREE_POINT_CONTEST = { racks: 5, balls: 5, seconds: GAME_SECONDS };

/**
 * The ball for shot number `index` (0 is the first) in a 3-point contest: the last of each rack is a
 * money ball. Past the last rack there are no balls left (null).
 * @param {number} index
 * @returns {number | null}
 */
export function contestBall(index) {
  const { racks, balls } = THREE_POINT_CONTEST;
  if (index >= racks * balls) return null;
  return index % balls === balls - 1 ? MONEY : NORMAL;
}

/**
 * Around the World ranks the lowest time first; the other modes the highest score.
 * @param {Mode} mode
 */
export const lowWins = (mode) => mode === "around";

/** Seconds: letting go, the ball's flight, moving to the next spot and jumping take longer than this. */
export const MIN_SHOT_GAP = 1.0;

// ---------- Fire ----------

/**
 * Makes in a row needed for each fire level, and the extra points per basket while on it. The game
 * adds the looks (colour, flames, announcer lines) and the wider timing window in game.js.
 * In order: on fire, purple fire, blue supernova.
 */
export const FIRE_RULES = [
  { streak: 3, bonus: 1 },
  { streak: 6, bonus: 2 },
  { streak: 10, bonus: 3 },
];

/**
 * The fire level reached with this many makes in a row: -1 for none, 0 on fire, 1 purple, 2 supernova.
 * @param {number} streak
 */
export function fireLevelIndex(streak) {
  let level = -1;
  FIRE_RULES.forEach((rule, i) => {
    if (streak >= rule.streak) level = i;
  });
  return level;
}

/**
 * Extra points for a basket made with this many makes already in a row.
 * @param {number} streak
 */
export const fireBonus = (streak) => FIRE_RULES[fireLevelIndex(streak)]?.bonus ?? 0;

// ---------- Bonus balls ----------
// Now and then the next ball is a gold money ball (double points) or a rare rainbow ball (5 points).
// Which shots get one comes from the game's start token, so the server works out the same answer and
// a score can't claim bonus balls it didn't get.

export const NORMAL = 0;
export const MONEY = 1;
export const RAINBOW = 2;

export const MONEY_CHANCE = 1 / 8;
export const RAINBOW_CHANCE = 1 / 40;

/**
 * The kind of ball for shot number `index` (0 is the first shot) in the game with this token.
 * @param {string | null | undefined} token
 * @param {number} index
 * @returns {number} NORMAL, MONEY or RAINBOW
 */
export function ballKind(token, index) {
  if (!token) return NORMAL;
  // FNV-1a: a small hash that gives the same number in the browser and on the server.
  let h = 0x811c9dc5;
  const text = `${token}#${index}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Then mix all the bits, so shot 3 and shot 4 come out completely different.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  const roll = h / 2 ** 32;
  return roll < RAINBOW_CHANCE ? RAINBOW : roll < RAINBOW_CHANCE + MONEY_CHANCE ? MONEY : NORMAL;
}

/**
 * Points for a basket: 2 or 3, plus the fire bonus, doubled for a money ball. A rainbow ball is
 * always worth 5, plus the fire bonus.
 * @param {number} kind NORMAL, MONEY or RAINBOW
 * @param {number | boolean} three
 * @param {number} bonus the fire bonus
 */
export function ballPoints(kind, three, bonus) {
  if (kind === RAINBOW) return 5 + bonus;
  const points = (three ? 3 : 2) + bonus;
  return kind === MONEY ? points * 2 : points;
}

// ---------- A whole game ----------

/**
 * One shot in a game's shot log: seconds in, three-pointer (1/0), made (1/0), release timing (in
 * green-zone widths from the top of the jump; within 0.5 is "in the green"), ball kind. Games from
 * before bonus balls have no fifth number.
 * @typedef {[number, number, number, number, number?]} Shot
 */

/**
 * The points a shot log adds up to, by the game's rules. (Around the World is timed, not scored.)
 * @param {Shot[]} shots
 */
export function recountScore(shots) {
  let score = 0;
  let streak = 0;
  for (const [, three, made, , kind] of shots) {
    if (!made) {
      streak = 0;
      continue;
    }
    score += ballPoints(kind ?? NORMAL, three, fireBonus(streak));
    streak++;
  }
  return score;
}

// ---------- Coins ----------
// Earned only by playing: worked out from a game's shot log by the server when the game is sent, the
// same way scores are checked. No real money, ever.

export const COINS = { basket: 1, onFire: 2, bonusBall: 5 };

/**
 * HORSE (pass and play) isn't scored, so a finished match earns a flat amount, for the device it was
 * played on. It can't have finished faster than `minSeconds` (at least ten shots and the turn screens).
 */
export const HORSE_MATCH = { mode: "horse", coins: 20, minSeconds: 30 };

/**
 * Coins for a game: 1 a basket, 2 while on fire, 5 for a money or rainbow ball that goes in.
 * @param {Shot[]} shots
 */
export function coinsFor(shots) {
  let coins = 0;
  let streak = 0;
  for (const [, , made, , kind] of shots) {
    if (!made) {
      streak = 0;
      continue;
    }
    coins += kind === MONEY || kind === RAINBOW ? COINS.bonusBall : fireBonus(streak) ? COINS.onFire : COINS.basket;
    streak++;
  }
  return coins;
}
