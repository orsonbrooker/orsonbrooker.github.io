// Sudden death: no clock, keep shooting until the first miss. It gets harder the longer the run goes,
// and long runs get bigger calls. From 5 in a row the green part of the jump bar starts moving.

import { sound } from "../audio.js";
import { runCall } from "../content/calls.js";
import { COURT_PX } from "../engine/court.js";
import { pointsMode, scorePoints } from "../modes/points.js";
import { addPopup, announce, confettiBurst, fireStage, pixelFx } from "../play/react.js";
import { made, player, setAnim, state } from "../play/state.js";
import { movingGreen } from "../play/zone.js";

// Sudden death gets harder the longer the run goes. Each of these rises from nothing at `…From`
// makes in a row to all of it at `…Full`:
//   squeeze  how much of the green part of the jump bar is gone (0.65 = 65%). It used to start at 3
//            and be full at 30; it's slower now the green moves too.
//   move     how far the green moves from shot to shot (play/zone.js), as its reach (0 to 1): it
//            starts moving at `moveFrom` with `moveStart` of its reach, and reaches all of it at `moveFull`
//   rumble   how far the court shakes, in court pixels
export const SUDDEN_DEATH = {
  squeeze: 0.65, squeezeFrom: 6, squeezeFull: 45,
  moveFrom: 5, moveStart: 0.35, moveFull: 30,
  rumble: 14, rumbleFrom: 10, rumbleFull: 30,
};
function pressure(from, full) {
  if (state.phase !== "playing" && state.phase !== "ending") return 0;
  return Math.max(0, Math.min(1, (state.streak - from) / (full - from)));
}
// How far the green moves on this shot: not at all before `moveFrom` in a row.
function moveReach() {
  if (state.phase !== "playing" || state.streak < SUDDEN_DEATH.moveFrom) return 0;
  const { moveStart, moveFrom, moveFull } = SUDDEN_DEATH;
  return moveStart + (1 - moveStart) * pressure(moveFrom, moveFull);
}

// A bigger call the longer the run goes (runCall, content/calls.js). A milestone that also lights a
// new fire (10 in a row: supernova) gets both.
function celebrateRun(p, levelUp, fire) {
  const run = runCall(state.streak);
  if (!run) return false;
  if (levelUp >= 0) sound.fireIgnite(levelUp);
  const newFire = levelUp >= 0 ? fire : null;
  addPopup(`${run.streak} IN A ROW`, "#ffd700", p.x, p.y - 140);
  sound.cheer(1.4 + run.level * 0.2);
  if (run.level >= 2) {
    state.flash = 0.5;
    confettiBurst(run.level >= 3 ? 140 : 70);
  }
  if (run.level >= 3) pixelFx.fireworks(COURT_PX);
  if (newFire) announce(newFire.phrase, newFire.color, { big: run.level >= 2 });
  else announce(run.call, run.level >= 3 ? "#ffd700" : "#ffe066", { big: run.level >= 2 });
  return true;
}

export default {
  ...pointsMode,
  id: "survival",
  bestKey: "orson-hoops-best-survival",

  clock(dt) {
    // No clock. The music builds with the run instead.
    state.elapsed += dt;
    sound.setIntensity({ stage: state.streak < 5 ? 0 : state.streak < 12 ? 1 : 2, fire: fireStage(), final: false });
  },
  gameSeconds: () => state.elapsed,
  // Already missed: a ball still in the air doesn't count.
  countsShot: () => state.phase !== "ending",
  onMake: (b) => scorePoints(b, celebrateRun),
  // The first miss ends it, once the reaction has played.
  onMiss() {
    sound.gameOver();
    state.phase = "ending";
    if (player.anim === "gather" || player.anim === "jump") setAnim("dribble");
  },
  squeeze: () => SUDDEN_DEATH.squeeze * pressure(SUDDEN_DEATH.squeezeFrom, SUDDEN_DEATH.squeezeFull),
  zoneShift: () => movingGreen(moveReach()),
  rumble: () => SUDDEN_DEATH.rumble * pressure(SUDDEN_DEATH.rumbleFrom, SUDDEN_DEATH.rumbleFull),

  hud: () => [state.score, `${made()} made, sudden death`],
  // No clock: the right side counts makes instead.
  scoreboard: () => [["SCORE", state.score], ["MADE", made()]],
  overText: (score, isBest) => ({
    title: isBest && score > 0 ? "New high score!" : "Missed!",
    final: score,
    unit: "points",
    detail: `${made()} in a row · Best: ${state.best}`,
  }),
};
