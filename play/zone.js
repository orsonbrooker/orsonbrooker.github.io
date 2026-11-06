// The moving green zone: a mechanic a mode can switch on. Instead of always sitting at the top of the
// jump, the green part of the timing bar moves to a new place for each shot, so you have to watch it.
// A mode turns it on with zoneShift() (modes/index.js), usually by returning movingGreen(reach).
// Where it goes comes from the game's seeded "zone" stream, so the same seed and inputs give the
// same game, and the other streams (spots, aim) give what they always did.

import { random, state } from "../play/state.js";

// How far the middle of the green can move from the top of the jump, in seconds of the jump, at full
// reach. (The whole jump is about 0.6 s with the top at 0.29 s, and the green is 0.13 s wide.)
// Each shot moves it between half and all of that, times the mode's reach. react.js keeps it on the bar.
export const MOVING_GREEN = { most: 0.15 };

let drawn = [];
let drawnFor = null; // the game they were drawn for (its shot log)

// Where the green's middle sits for the shot about to be taken, in seconds from the top of the jump
// (negative is earlier). `reach` (0 to 1) is how far it may move; 0 keeps it at the top and draws
// nothing. Each shot's place is drawn once, the first time it's asked for.
export function movingGreen(reach) {
  if (reach <= 0) return 0;
  if (drawnFor !== state.shotLog) {
    drawn = [];
    drawnFor = state.shotLog;
  }
  const shot = state.shotLog.length;
  drawn[shot] ??= [random("zone"), random("zone")];
  const [side, size] = drawn[shot];
  // Mostly the other side of the top from last shot, so it really moves.
  const way = (shot % 2 ? 1 : -1) * (side < 0.3 ? -1 : 1);
  return way * MOVING_GREEN.most * reach * (0.5 + 0.5 * size);
}
