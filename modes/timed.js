// Time attack: score as much as you can in 60 seconds. A shot in the air at the buzzer still counts
// (and if it goes in, that's a buzzer beater).

import { sound } from "../audio.js";
import { pointsMode, scorePoints } from "../modes/points.js";
import { fireStage } from "../play/react.js";
import { updateHud } from "../play/scene.js";
import { player, setAnim, setPhase, state } from "../play/state.js";
import { GAME_SECONDS } from "../shared/rules.js";

export default {
  ...pointsMode,
  id: "timed",
  bestKey: "orson-hoops-best",

  clock(dt) {
    state.elapsed += dt;
    const before = Math.ceil(state.timeLeft);
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    const after = Math.ceil(state.timeLeft);
    if (after !== before) {
      if (after <= 5 && after > 0) sound.tick();
      updateHud();
    }
    // The music builds as time runs down, and gets a lead line while he's on fire.
    sound.setIntensity({
      stage: state.timeLeft > 40 ? 0 : state.timeLeft > 20 ? 1 : 2,
      fire: fireStage(),
      final: state.timeLeft <= 10,
    });
    if (state.timeLeft <= 0) {
      sound.gameOver();
      setPhase("ending");
      for (const b of state.balls) if (!b.decided) b.atBuzzer = true;
      // A shot already in the air still counts.
      if (player.anim === "gather" || player.anim === "jump") setAnim("dribble");
    }
  },
  gameSeconds: () => GAME_SECONDS - state.timeLeft,
  onMake: (b) => scorePoints(b),

  hud: () => [state.score, `${Math.ceil(state.timeLeft)} seconds left`],
  scoreboard: () => [["SCORE", state.score], ["TIME", Math.ceil(state.timeLeft)]],
  overText: (score, isBest) => ({
    title: isBest && score > 0 ? "New high score!" : state.buzzerBeater ? "Buzzer beater!" : "Time's up!",
    final: score,
    unit: "points",
    detail: (state.buzzerBeater ? "Won it at the buzzer! " : "") + `Best: ${state.best}`,
  }),
};
