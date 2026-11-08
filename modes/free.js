// Free play: no clock, no score to beat, no leaderboard and no game over. They move him round the
// court themselves (arrow keys, WASD or the on-screen joystick) and shoot from wherever he stands, for
// as long as they like; it only ends when they leave. Makes and misses still get the usual calls,
// fire and effects, and a shot from behind the line is a 3 (shared/rules.js, through scorePoints).

import { sound } from "../audio.js";
import { DEFAULT_SPOT } from "../engine/court.js";
import { scorePoints } from "../modes/points.js";
import { fireStage } from "../play/react.js";
import { made, player, state } from "../play/state.js";

export default {
  id: "free",
  bestKey: null, // no best, and nothing sent to the leaderboard
  ranked: false,
  freeMove: true,
  bonusBalls: false,

  startSpot: () => DEFAULT_SPOT,
  // He keeps the ball where he is after a shot.
  pickSpot: () => ({ u: player.u, v: player.v }),
  clock(dt) {
    // No clock. The music stays easy, with the lead line while he's on fire.
    state.elapsed += dt;
    sound.setIntensity({ stage: 0, fire: fireStage(), final: false });
  },
  gameSeconds: () => state.elapsed,
  countsShot: () => true,
  onMake: (b) => scorePoints(b),
  onMiss() {},
  squeeze: () => 0,
  rumble: () => 0,

  hud: () => [`${made()} made`, `${state.streak} in a row`],
  scoreboard: () => [["MADE", made()], ["STREAK", state.streak]],
};
