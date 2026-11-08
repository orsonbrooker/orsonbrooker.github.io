// What each player is good at: the start of "Player stats". Every player is neutral (plays exactly
// the same) unless they're listed in PLAYER_ATTRIBUTES below, and nobody is yet: the leaderboard
// compares everyone, so Luke and Orson decide the real values.
//
// To give a player attributes, add them by player id (built-ins are "orson" and "jethro"; approved
// builder players are "p" + their id in the players table, e.g. "p12"). Players made on someone's
// device always get the neutral ones. Leave out anything that should stay neutral.
//
//   timing  how wide the green zone is, times this (1.2 = 20% wider). It's the whole timing window,
//           so the shot log's release timing is still measured in this player's own green-zone widths.
//   jump    how much higher he jumps, in metres at the top of the jump (0.2 = 20 cm higher). He's
//           drawn that much higher and the ball leaves his hands from there.
//   three   3-point accuracy: on a 3-pointer his timing mistakes and the shot's random wobble are
//           divided by this (1.25 = a quarter less off; under 1 is worse).
//
// Changing these changes how players' scores compare on the leaderboard. The server checks scores
// from the shot log and doesn't model the shot, so it needs no change.

export const NEUTRAL = Object.freeze({ timing: 1, jump: 0, three: 1 });

// Kept in sensible bounds, whatever is typed below.
const LIMITS = { timing: [0.5, 2], jump: [0, 0.6], three: [0.5, 2] };

export const PLAYER_ATTRIBUTES = {
  // orson: { timing: 1.1 },
  // jethro: { three: 1.2 },
};

// A player's attributes: theirs from the table above, neutral for anything not set.
export function attributesFor(id) {
  const set = Object.hasOwn(PLAYER_ATTRIBUTES, id) ? PLAYER_ATTRIBUTES[id] : null;
  if (!set) return NEUTRAL;
  const out = { ...NEUTRAL };
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const value = Number(set[key]);
    if (Number.isFinite(value)) out[key] = Math.max(lo, Math.min(hi, value));
  }
  return Object.freeze(out);
}

// What a player is good at, in a few words for their card in the picker (none for a neutral player).
export function skillWords(a) {
  const words = [];
  if (a.timing > 1) words.push("Big green zone");
  if (a.timing < 1) words.push("Small green zone");
  if (a.jump > 0) words.push("Jumps high");
  if (a.three > 1) words.push("3-point shooter");
  if (a.three < 1) words.push("Better up close");
  return words;
}
