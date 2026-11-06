// Sudden death: no clock, keep shooting until the first miss. It gets harder the longer the run goes,
// and long runs get bigger calls.

import { sound } from "../audio.js?v=b614856c";
import { runCall } from "../content/calls.js?v=567f9a3e";
import { COURT_PX } from "../engine/court.js?v=7f81b538";
import { pointsMode, scorePoints } from "../modes/points.js?v=6733cfd7";
import { addPopup, announce, confettiBurst, fireStage, pixelFx } from "../play/react.js?v=900eeda3";
import { made, player, setAnim, state } from "../play/state.js?v=75933279";

// Sudden death gets harder the longer the run goes. pressure() rises from 0 at `from` makes in a
// row to 1 at `full`, and with it:
//   squeeze  how much of the green part of the jump bar is gone at full pressure (0.65 = 65%)
//   rumble   how far the court shakes at full pressure, in court pixels (it starts at `rumbleFrom`)
export const SUDDEN_DEATH = { from: 3, full: 30, squeeze: 0.65, rumble: 14, rumbleFrom: 10 };
function pressure(from = SUDDEN_DEATH.from) {
  if (state.phase !== "playing" && state.phase !== "ending") return 0;
  return Math.max(0, Math.min(1, (state.streak - from) / (SUDDEN_DEATH.full - from)));
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
  squeeze: () => SUDDEN_DEATH.squeeze * pressure(),
  rumble: () => SUDDEN_DEATH.rumble * pressure(SUDDEN_DEATH.rumbleFrom),

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
