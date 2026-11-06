// How the game reacts, in every mode: the announcer's calls, score popups, confetti, the buzzer beater
// celebration, the pixel effects layer, fire (and the wider timing window it gives), the next ball's
// kind, and the stats the daily challenge counts.

import { sound } from "../audio.js";
import { BALL_BADGES, CONFETTI_COLORS, FIRE_LEVELS } from "../content/looks.js";
import { countsIn, doneToday, markDone, progress, todaysChallenge } from "../daily.js";
import { COURT_PX, RIM, project } from "../engine/court.js";
import { createFxLayer } from "../fx.js";
import { pickPhrase } from "../phrases.js";
import { MONEY, NORMAL, RAINBOW, ballKind } from "../shared/rules.js";
import { TIMING_WINDOW, mode, player, state } from "../play/state.js";

export const pixelFx = createFxLayer();

const BANNER_SECONDS = 1.7;
export const BUZZER_CELEBRATION = 3.2; // seconds to celebrate a buzzer beater before the game-over screen

// ---------- Fire ----------

// The fire level for the current streak, or null when not on fire.
export function fireLevel() {
  let level = null;
  for (const l of FIRE_LEVELS) if (state.streak >= l.streak) level = l;
  return level;
}

// For the music: 0 when not on fire, else which fire level (1 to 3).
export function fireStage() {
  const fire = fireLevel();
  return fire ? FIRE_LEVELS.indexOf(fire) + 1 : 0;
}

// How long around the top of the jump a release still counts as perfect: wider on fire, narrower
// as the mode squeezes it (sudden death, the longer the run goes), and wider or narrower for a
// player whose `timing` attribute says so (content/attributes.js).
export function timingWindow() {
  return TIMING_WINDOW * (fireLevel()?.window ?? 1) * (1 - mode().squeeze()) * player.attrs.timing;
}

// The next ball's kind: money or rainbow now and then, but only in games that score points.
export function nextBallKind() {
  if (state.phase !== "playing" || !mode().bonusBalls) return NORMAL;
  return ballKind(state.gameToken, state.shotLog.length);
}
export const nextBallBadge = () => BALL_BADGES[nextBallKind()];

// ---------- Calls and celebrations ----------

export function addPopup(text, color, x, y) {
  state.popups.push({ text, color, x, y, age: 0 });
}

export function announce(category, color, { big = false } = {}) {
  const text = pickPhrase(category);
  state.banner = { text: text.toUpperCase(), color, age: 0, big, duration: big ? BUZZER_CELEBRATION : BANNER_SECONDS };
  sound.say(text);
}

export function confettiBurst(count) {
  for (let i = 0; i < count; i++) {
    state.confetti.push({
      x: Math.random() * COURT_PX,
      y: -40 - Math.random() * 600,
      vx: (Math.random() - 0.5) * 200,
      vy: 250 + Math.random() * 350,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      size: 14 + Math.random() * 14,
      color: CONFETTI_COLORS[i % 6],
    });
  }
}

// The biggest moment in the game: flash, confetti, a roar and a big gold call.
export function celebrateBuzzerBeater() {
  state.buzzerBeater = true;
  state.flash = 1;
  confettiBurst(180);
  pixelFx.fireworks(COURT_PX);
  sound.buzzerBeater();
  announce("buzzer", "#ffd700", { big: true });
}

// ---------- Daily challenge ----------

// What happened in this game, for the daily challenge (daily.js).
export function newStats() {
  return { makes: 0, threes: 0, threeRun: 0, bestThreeRun: 0, swishRun: 0, bestSwishRun: 0, banks: 0, fires: 0, bestStreak: 0, money: 0, rainbow: 0, score: 0, aroundTime: 0, buzzerBeater: false };
}

export function recordMake(b) {
  const s = state.stats;
  const swish = !b.touchedRim && !b.touchedBoard;
  s.makes++;
  s.threes += b.three ? 1 : 0;
  s.threeRun = b.three ? s.threeRun + 1 : 0;
  s.bestThreeRun = Math.max(s.bestThreeRun, s.threeRun);
  s.swishRun = swish ? s.swishRun + 1 : 0;
  s.bestSwishRun = Math.max(s.bestSwishRun, s.swishRun);
  s.banks += b.touchedBoard && !b.touchedRim ? 1 : 0;
  s.fires += state.streak === FIRE_LEVELS[0].streak ? 1 : 0;
  s.bestStreak = Math.max(s.bestStreak, state.streak);
  s.money += b.kind === MONEY ? 1 : 0;
  s.rainbow += b.kind === RAINBOW ? 1 : 0;
  // A moment later, so the basket's own call comes first.
  setTimeout(checkDaily, 700);
}

export function recordMiss() {
  state.stats.threeRun = 0;
  state.stats.swishRun = 0;
}

// Done the daily challenge in this game? Celebrate (once a day).
export function checkDaily() {
  const challenge = todaysChallenge();
  if (state.dailyDone || doneToday() || !state.stats || !countsIn(challenge, state.mode)) return;
  state.stats.score = state.score;
  state.stats.buzzerBeater = state.buzzerBeater;
  if (progress(challenge, state.stats) < challenge.goal) return;
  state.dailyDone = true;
  const days = markDone();
  const p = project(RIM.u, RIM.v, RIM.z);
  addPopup(days > 1 ? `CHALLENGE DONE · ${days} DAYS` : "CHALLENGE DONE", "#3ddc84", p.x, p.y - 200);
  confettiBurst(90);
  sound.cheer(2);
  announce("challenge", "#3ddc84", { big: state.phase !== "playing" });
}
