// What the modes that score points share (time attack and sudden death): a basket's points and calls,
// random spots, bonus balls, and a result that's the score, where higher is better.

import { sound } from "../audio.js?v=b614856c";
import { overCall } from "../content/calls.js?v=567f9a3e";
import { BALL_BADGES, FIRE_LEVELS } from "../content/looks.js?v=42313b70";
import { DEFAULT_SPOT, RIM, project, randomSpot } from "../engine/court.js?v=7f81b538";
import { addPopup, announce, celebrateBuzzerBeater, fireLevel, pixelFx, recordMake } from "../play/react.js?v=900eeda3";
import { updateHud } from "../play/scene.js?v=8def5f40";
import { player, random, state } from "../play/state.js?v=75933279";
import { MONEY, NORMAL, ballPoints } from "../shared/rules.js?v=acc1af2d";

// A basket: its points (shared/rules.js), the streak, and the reaction. `celebrateRun(p, levelUp, fire)`
// lets a mode take over the call for a long run; it returns true if it did.
export function scorePoints(b, celebrateRun = () => false) {
  const points = ballPoints(b.kind ?? NORMAL, b.three, b.fire?.bonus ?? 0);
  if (b.log) b.log[2] = 1;
  state.score += points;
  state.streak++;
  state.coldStreak = 0;
  recordMake(b);
  updateHud();
  sound.swish();
  const p = project(RIM.u, RIM.v, RIM.z);
  addPopup(`+${points}`, BALL_BADGES[b.kind]?.color ?? b.fire?.color ?? "#ffe066", p.x, p.y - 60);
  if (BALL_BADGES[b.kind]) pixelFx.swish(p.x, p.y, b.kind === MONEY ? "gold" : "pink");

  const swish = !b.touchedRim && !b.touchedBoard;
  if (swish) pixelFx.swish(p.x, p.y, b.fire ? "gold" : "cyan");
  const levelUp = FIRE_LEVELS.findIndex((l) => l.streak === state.streak);
  const fire = fireLevel();
  if (state.phase === "ending") {
    celebrateBuzzerBeater();
    return;
  }
  if (celebrateRun(p, levelUp, fire)) return;
  if (levelUp >= 0) sound.fireIgnite(levelUp);
  else sound.cheer(b.three || state.streak === FIRE_LEVELS[0].streak - 1 ? 1.4 : 1);

  if (levelUp >= 0) announce(fire.phrase, fire.color);
  else if (state.streak === FIRE_LEVELS[0].streak - 1) announce("heatingUp", "#ffb86b");
  else if (fire && Math.random() < 0.5) announce(fire.stillPhrase, fire.color);
  else if (b.three) announce("three", "#ffe066");
  else if (b.touchedBoard && !b.touchedRim) announce("bank", "#a0e7ff");
  else if (swish) announce("swish", "#7cf0ff");
  else announce("make", "#ffffff");
}

// The parts of a mode that are the same for every mode that scores points.
export const pointsMode = {
  bonusBalls: true,
  startSpot: () => DEFAULT_SPOT,
  // Anywhere around the hoop, about a third behind the 3-point line (from the seeded "spots" stream).
  pickSpot: () => randomSpot(() => random("spots"), player),
  countsShot: () => true,
  onMiss() {},
  squeeze: () => 0,
  rumble: () => 0,
  result: () => state.score,
  isBetter: (score, best) => score > best,
  endCall: (score, isBest) => (isBest && score > 0 ? "newBest" : overCall(score)),
  formatBest: (best) => best,
  boardScore: () => state.score,
};
