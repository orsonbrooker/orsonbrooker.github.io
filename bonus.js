// Shootaround's bonus balls: now and then the next ball is a gold money ball (double points) or a
// rare rainbow ball (5 points). Which shots get one comes from the game's start token, so the
// server works out the same answer and a score can't claim bonus balls it didn't get.
// worker/src/index.ts has a copy of ballKind and ballPoints: change both together.

export const NORMAL = 0;
export const MONEY = 1;
export const RAINBOW = 2;

const MONEY_CHANCE = 1 / 8;
const RAINBOW_CHANCE = 1 / 40;

// The kind of ball for shot number `index` (0 is the first shot) in the game with this token.
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

// Points for a basket: 2 or 3, plus the fire bonus, doubled for a money ball. A rainbow ball is
// always worth 5, plus the fire bonus.
export function ballPoints(kind, three, fireBonus) {
  if (kind === RAINBOW) return 5 + fireBonus;
  const points = (three ? 3 : 2) + fireBonus;
  return kind === MONEY ? points * 2 : points;
}
