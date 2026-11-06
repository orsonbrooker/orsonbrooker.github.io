// 3-point contest: a rack of balls at each of 5 spots round the 3-point line (content/threes.js), shot
// in order, 5 balls a rack. Every shot is a three, and the last ball of each rack is a gold money ball
// worth double. It ends when the 60 seconds run out or the last rack is shot, whichever comes first
// (a shot in the air at the buzzer still counts). Fire still builds as usual, and the green part of
// the jump bar moves from shot to shot. The rules the server checks are in shared/rules.js.

import { sound } from "../audio.js";
import { RACK_ART, RACK_LAYOUT } from "../content/threes.js";
import { LINE_CLEARANCE, RIM, project, threePointRadius } from "../engine/court.js";
import timed from "../modes/timed.js";
import { pointsMode, scorePoints } from "../modes/points.js";
import { loadImage } from "../play/players.js";
import { announce, confettiBurst } from "../play/react.js";
import { player, setAnim, state } from "../play/state.js";
import { movingGreen } from "../play/zone.js";
import { MONEY, THREE_POINT_CONTEST, contestBall } from "../shared/rules.js";

const { racks: RACKS, balls: BALLS } = THREE_POINT_CONTEST;
const TOTAL = RACKS * BALLS;
// How far the green moves (its reach in play/zone.js, 0 to 1): a good way, from the first shot.
const CONTEST_GREEN = 0.7;

// A place in RACK_LAYOUT ([degrees, metres past the 3-point line]) in court metres.
function atLine([deg, past]) {
  const angle = (deg * Math.PI) / 180;
  const line = threePointRadius(RIM.u + Math.cos(angle), RIM.v + Math.sin(angle));
  const d = line + LINE_CLEARANCE + past;
  return { u: RIM.u + Math.cos(angle) * d, v: RIM.v + Math.sin(angle) * d };
}
let places = null;
const racks = () => (places ??= RACK_LAYOUT.map((r) => ({ spot: atLine(r.spot), rack: atLine(r.rack) })));

// Which rack the next ball comes from (the last one once they're all shot).
const rackAt = (shots) => Math.min(RACKS - 1, Math.floor(shots / BALLS));
const madeFrom = (rack) => state.shotLog.slice(rack * BALLS, (rack + 1) * BALLS).filter((s) => s[2]).length;

// Moving to a new rack: say so.
let lastRack = 0;
function pickSpot() {
  const rack = rackAt(state.shotLog.length);
  if (rack !== lastRack && state.phase === "playing") announce(rack === RACKS - 1 ? "rackLast" : "rackNext", "#ffe066");
  lastRack = rack;
  return racks()[rack].spot;
}

// A whole rack made (the money ball last): a bigger call than the basket's own.
function perfectRack(b, levelUp) {
  const i = state.shotLog.indexOf(b.log);
  if (i % BALLS !== BALLS - 1 || madeFrom(Math.floor(i / BALLS)) !== BALLS) return false;
  if (levelUp >= 0) sound.fireIgnite(levelUp);
  sound.cheer(1.8);
  confettiBurst(70);
  announce("rackPerfect", "#ffd700", { big: true });
  return true;
}

function onMake(b) {
  scorePoints(b, (p, levelUp) => perfectRack(b, levelUp));
  if (b.log === state.shotLog[TOTAL - 1]) finish();
}
function onMiss(b) {
  if (b.log === state.shotLog[TOTAL - 1]) finish();
}
// The last ball's been shot, and it's in or out: that's the contest (unless the buzzer went first).
function finish() {
  if (state.phase !== "playing") return;
  sound.gameOver();
  state.phase = "ending";
  state.flash = 0.6;
  if (player.anim === "gather" || player.anim === "jump") setAnim("dribble");
  setTimeout(() => announce("contestDone", "#ffd700", { big: true }), 900);
}

// ---------- The racks on the floor ----------
// Placeholder racks until the art is drawn (art/three-point-contest.md): a dark frame with the balls
// still on it, the last one gold. With RACK_ART filled in, the images instead.

const art = { rack: null, ball: null, moneyBall: null, loading: false };
function loadArt() {
  if (art.loading || !RACK_ART.rack) return;
  art.loading = true;
  for (const key of ["rack", "ball", "moneyBall"])
    if (RACK_ART[key]) loadImage(RACK_ART[key]).then((img) => (art[key] = img)).catch(() => {});
}

function drawRack(ctx, at, left, current) {
  const p = project(at.u, at.v);
  if (art.rack) {
    const [ax, ay] = RACK_ART.anchor;
    ctx.drawImage(art.rack, p.x - ax, p.y - ay);
    RACK_ART.balls.forEach(([bx, by], i) => {
      if (i < BALLS - left) return; // taken from the front of the rack first
      const img = i === BALLS - 1 ? art.moneyBall : art.ball;
      if (img) ctx.drawImage(img, p.x - ax + bx, p.y - ay + by);
    });
    return;
  }
  ctx.save();
  ctx.globalAlpha = current ? 1 : 0.8;
  ctx.fillStyle = "#3b2a33";
  ctx.fillRect(p.x - 70, p.y - 34, 140, 34);
  ctx.fillStyle = "#2b1622";
  ctx.fillRect(p.x - 66, p.y, 8, 14);
  ctx.fillRect(p.x + 58, p.y, 8, 14);
  for (let i = BALLS - left; i < BALLS; i++) {
    ctx.fillStyle = i === BALLS - 1 ? "#f0b424" : "#e8762b";
    ctx.beginPath();
    ctx.arc(p.x - 52 + i * 26, p.y - 46, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFloor(ctx) {
  if (state.phase === "title") return;
  loadArt();
  const shots = state.shotLog.length;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
  racks().forEach(({ spot, rack }, i) => {
    const current = i === rackAt(shots) && shots < TOTAL;
    const left = Math.max(0, Math.min(BALLS, (i + 1) * BALLS - shots));
    if (current) {
      const p = project(spot.u, spot.v);
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.3 * pulse;
      ctx.fillStyle = "#ffe066";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 56, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    drawRack(ctx, rack, left, current);
  });
}

const rackNumber = () => rackAt(state.shotLog.length) + 1;
const moneyMade = () => state.shotLog.filter((s) => s[4] === MONEY && s[2]).length;

export default {
  ...pointsMode,
  id: "threes",
  bestKey: "orson-hoops-best-threes",
  bonusBalls: false,
  ballKind: contestBall,

  startSpot() {
    lastRack = 0;
    return racks()[0].spot;
  },
  pickSpot,
  // The 60 second clock, the music and the buzzer, as in Time attack.
  clock: timed.clock,
  gameSeconds: timed.gameSeconds,
  onMake,
  onMiss,
  zoneShift: () => (state.phase === "playing" ? movingGreen(CONTEST_GREEN) : 0),
  drawFloor,

  hud: () => [state.score, `rack ${rackNumber()} of ${RACKS}, ${Math.ceil(state.timeLeft)} seconds left`],
  scoreboard: () => [["SCORE", state.score], ["TIME", Math.ceil(state.timeLeft)]],
  overText: (score, isBest) => ({
    title: isBest && score > 0 ? "New high score!" : state.buzzerBeater ? "Buzzer beater!" : state.shotLog.length >= TOTAL ? "All racks done!" : "Time's up!",
    final: score,
    unit: "points",
    detail: `${state.shotLog.filter((s) => s[2]).length} of ${TOTAL} made, ${moneyMade()} money balls · Best: ${state.best}`,
  }),
};
