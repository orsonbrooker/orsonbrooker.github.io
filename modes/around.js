// Around the world: score from each of the 7 spots around the key in order, as fast as you can. A miss
// means another go from the same spot. It's against the clock (counting up), so the best is the
// lowest time, and there are no bonus balls. The green part of the jump bar moves a little each shot.

import { sound } from "../audio.js";
import { AROUND_LAYOUT } from "../content/around.js";
import { FIRE_LEVELS } from "../content/looks.js";
import { COURT_PX, LINE_CLEARANCE, RIM, ROOM_U, ROOM_V, project, threePointRadius } from "../engine/court.js";
import { addPopup, announce, confettiBurst, fireLevel, fireStage, pixelFx, recordMake } from "../play/react.js";
import { updateHud } from "../play/scene.js";
import { setPhase, state } from "../play/state.js";
import { movingGreen } from "../play/zone.js";
import { AROUND_SPOTS } from "../shared/rules.js";

// How far the green moves (its reach in play/zone.js, 0 to 1): gently, from the first shot.
const AROUND_GREEN = 0.4;

// The spots in AROUND_LAYOUT (content/around.js), kept off the 3-point line, in court metres.
let aroundSpots = null;
function spots() {
  aroundSpots ??= AROUND_LAYOUT.map(([deg, metres]) => {
    const angle = (deg * Math.PI) / 180;
    const line = threePointRadius(RIM.u + Math.cos(angle), RIM.v + Math.sin(angle));
    const d = Math.min(metres, line - LINE_CLEARANCE - 0.3);
    return {
      u: Math.max(1.8, Math.min(ROOM_U - 0.8, RIM.u + Math.cos(angle) * d)),
      v: Math.min(ROOM_V - 0.8, RIM.v + Math.sin(angle) * d),
    };
  });
  return aroundSpots;
}

// A make moves them on to the next spot; the last one finishes it.
function onMake(b) {
  if (state.phase !== "playing") return;
  if (b.log) b.log[2] = 1;
  state.streak++;
  state.coldStreak = 0;
  state.aroundAt++;
  if (state.aroundAt >= AROUND_SPOTS) state.stats.aroundTime = state.elapsed;
  recordMake(b);
  updateHud();
  sound.swish();
  const p = project(RIM.u, RIM.v, RIM.z);
  const swish = !b.touchedRim && !b.touchedBoard;
  if (swish) pixelFx.swish(p.x, p.y, "cyan");
  if (state.aroundAt >= AROUND_SPOTS) {
    state.aroundTime = state.elapsed;
    setPhase("ending");
    sound.gameOver();
    state.flash = 0.8;
    confettiBurst(160);
    pixelFx.fireworks(COURT_PX);
    addPopup(`${state.elapsed.toFixed(1)}s`, "#ffd700", p.x, p.y - 60);
    announce("aroundDone", "#ffd700", { big: true });
    return;
  }
  addPopup(`SPOT ${state.aroundAt + 1}`, "#ffe066", p.x, p.y - 60);
  const levelUp = FIRE_LEVELS.findIndex((l) => l.streak === state.streak);
  if (levelUp >= 0) {
    sound.fireIgnite(levelUp);
    announce(fireLevel().phrase, fireLevel().color);
  } else {
    sound.cheer(1);
    announce(state.aroundAt === AROUND_SPOTS - 1 ? "aroundLast" : swish ? "swish" : "make", "#ffffff");
  }
}

// The seven spots on the floor, numbered, with the one they're on lit up.
function drawFloor(ctx) {
  if (state.phase === "title") return;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
  spots().forEach((spot, i) => {
    const p = project(spot.u, spot.v);
    const done = i < state.aroundAt;
    const current = i === state.aroundAt;
    ctx.save();
    ctx.globalAlpha = done ? 0.55 : current ? 0.75 + 0.25 * pulse : 0.45;
    ctx.fillStyle = done ? "#3ddc84" : current ? "#ffe066" : "#ffffff";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 56, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = '22px "Press Start 2P", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#2b1622";
    ctx.fillText(String(i + 1), p.x, p.y + 2);
    ctx.restore();
  });
}

const spotNumber = () => Math.min(state.aroundAt + 1, AROUND_SPOTS);
const time = (best) => `${best.toFixed(1)}s`;

export default {
  id: "around",
  bestKey: "orson-hoops-best-around",
  bonusBalls: false,

  startSpot: () => spots()[0],
  // The spot they're on until they make it, then the next.
  pickSpot: () => spots()[Math.min(state.aroundAt, AROUND_SPOTS - 1)],
  clock(dt) {
    // Against the clock, counting up. The music builds as they get around.
    const before = Math.floor(state.elapsed);
    state.elapsed += dt;
    if (Math.floor(state.elapsed) !== before) updateHud();
    sound.setIntensity({ stage: state.aroundAt < 3 ? 0 : state.aroundAt < 5 ? 1 : 2, fire: fireStage(), final: state.aroundAt === AROUND_SPOTS - 1 });
  },
  gameSeconds: () => state.elapsed,
  countsShot: () => true,
  onMake,
  onMiss() {},
  squeeze: () => 0,
  // The green moves a little from shot to shot (a gentle setting: it's a race, not a test of nerve).
  zoneShift: () => (state.phase === "playing" ? movingGreen(AROUND_GREEN) : 0),
  rumble: () => 0,
  drawFloor,

  hud: () => [`spot ${spotNumber()} of ${AROUND_SPOTS}`, `${Math.floor(state.elapsed)} seconds`],
  // Which spot they're on, out of seven, and the time so far.
  scoreboard: () => [["SPOT", spotNumber()], ["TIME", Math.floor(state.elapsed)]],
  // The time, to a tenth of a second; lower is better.
  result: () => Math.round(state.aroundTime * 10) / 10,
  isBetter: (t, best) => !best || t < best,
  endCall: (t, isBest) => (isBest ? "newBest" : null),
  overText: (t, isBest) => ({
    title: isBest ? "New best time!" : "Around the world!",
    final: t.toFixed(1),
    unit: "seconds",
    detail: `${state.shotLog.length} shots for ${AROUND_SPOTS} spots · Best: ${time(state.best)}`,
  }),
  formatBest: time,
  // Sent to the leaderboard in tenths of a second.
  boardScore: () => Math.round(state.aroundTime * 10),
};
