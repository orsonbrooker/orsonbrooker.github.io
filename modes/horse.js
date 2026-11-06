// HORSE, pass and play: 2 to 4 players on one device, taking turns. The leader picks a spot and shoots.
// If it goes in, everyone else (in turn) has to make the same shot from the same spot, or they get a
// letter: H, then O, R, S, E. Spell HORSE and you're out. If the leader misses, the lead passes to the
// next player. The last one without HORSE wins.
//
// Between shots the game waits on the turn screen (phase "turn", screens/horse.js) so the device can be
// passed on: "Pass to Jethro!". There's no fire, no bonus balls, no best and no leaderboard, and nothing
// is sent anywhere.

import { sound } from "../audio.js";
import { HORSE_LAYOUT, HORSE_WORD } from "../content/horse.js";
import { LINE_CLEARANCE, RIM, ROOM_U, ROOM_V, isThreePointSpot, project, threePointRadius } from "../engine/court.js";
import { characters, preloadCharacter, useCharacter } from "../play/players.js";
import { addPopup, announce, pixelFx } from "../play/react.js";
import { updateHud } from "../play/scene.js";
import { player, random, setAnim, state } from "../play/state.js";
import { showScreen, stage } from "../screens/base.js";
import { showTurn } from "../screens/horse.js";

const FONT = '"Press Start 2P", monospace';
const PAUSE = 1.5; // seconds after a shot before the turn screen comes up

// The spots in HORSE_LAYOUT (content/horse.js), in court metres, each with its name and whether it's a three.
let horseSpots = null;
export function spots() {
  horseSpots ??= HORSE_LAYOUT.map(([deg, metres, name]) => {
    const angle = (deg * Math.PI) / 180;
    const line = threePointRadius(RIM.u + Math.cos(angle), RIM.v + Math.sin(angle));
    const d = metres === "three" ? line + LINE_CLEARANCE + 0.35 : Math.min(metres, line - LINE_CLEARANCE - 0.3);
    const u = Math.max(1.8, Math.min(ROOM_U - 0.8, RIM.u + Math.cos(angle) * d));
    const v = Math.min(ROOM_V - 0.8, RIM.v + Math.sin(angle) * d);
    return { u, v, name, three: isThreePointSpot(u, v) };
  });
  return horseSpots;
}

// This game: who's playing (in turn order) and their letters, who leads, who's shooting now.
const game = {
  players: [], // { id, name, letters }
  leader: 0, // whose spot it is to pick
  shooter: 0, // who's shooting now
  role: "set", // "set": the leader shooting from a spot they picked; "match": copying the leader's make
  queue: [], // who still has to match the leader's make, in order
  spot: 2, // the spot being shot from (an index into spots())
  shots: 0,
  winner: null,
  wait: 0, // seconds until the turn screen
  next: null, // what the turn screen shows next: { news, call }
};

const name = (i) => game.players[i]?.name ?? "";
const isIn = (i) => game.players[i].letters < HORSE_WORD.length;
const playersIn = () => game.players.filter((p) => p.letters < HORSE_WORD.length).length;
const lettersOf = (p) => HORSE_WORD.slice(0, p.letters);
// The players still in after `i`, in turn order (not counting `i`).
function after(i) {
  const n = game.players.length;
  const list = [];
  for (let k = 1; k < n; k++) if (isIn((i + k) % n)) list.push((i + k) % n);
  return list;
}

// Who's playing, from the team picker (screens/menus.js): characters, in turn order.
function setPlayers(list) {
  game.players = list.map((c) => ({ id: c.id, name: c.name, letters: 0 }));
  for (const c of list) preloadCharacter(c.id);
}

// A new game (play/round.js startGame): everyone back to no letters, the first player leads.
function begin() {
  for (const p of game.players) p.letters = 0;
  game.leader = 0;
  game.shots = 0;
  game.winner = null;
  game.queue = [];
  game.spot = Math.floor(random("spots") * spots().length);
  state.phase = "turn";
  turn(0, "set", { news: "" });
  showNext(true);
}

// Sets who shoots next and what the turn screen will say, after a short pause for the reaction.
function turn(shooter, role, next) {
  game.shooter = shooter;
  game.role = role;
  game.next = next;
  game.wait = PAUSE;
  state.phase = "turn";
  updateHud();
}

// The turn screen: who's up, what just happened, the letters, and the spot.
function showNext(first = false) {
  const { news = "", call = null } = game.next ?? {};
  if (call) announce(call, call === "horseLetter" || call === "horseOut" ? "#ff6b6b" : "#3ddc84");
  game.wait = Infinity;
  const set = game.role === "set";
  if (set && !first) game.spot = Math.floor(random("spots") * spots().length); // a new spot to start from
  const leader = name(game.leader);
  showTurn({
    title: first ? `${name(game.shooter)} goes first!` : `Pass to ${name(game.shooter)}!`,
    news,
    face: characters.list.find((c) => c.id === game.players[game.shooter].id),
    note: set ? "Your lead! Pick a spot. Make it, and everyone has to match it." : `Match ${leader}'s shot. Miss it and you get a letter!`,
    spots: spots(),
    spot: game.spot,
    canPick: set,
    standings: game.players.map((p, i) => ({ name: p.name, face: characters.list.find((c) => c.id === p.id), letters: lettersOf(p), out: !isIn(i), up: i === game.shooter })),
    go: (spotIndex) => go(spotIndex),
  });
}

// They're ready: on court at the spot, already facing the hoop.
async function go(spotIndex) {
  if (state.phase !== "turn") return;
  if (game.role === "set") game.spot = spotIndex;
  const spot = spots()[game.spot];
  await useCharacter(game.players[game.shooter].id, { remember: false }).catch(() => {});
  player.u = spot.u;
  player.v = spot.v;
  player.fade = 0;
  player.moving = false;
  player.activeBall = null;
  setAnim("dribble");
  state.streak = 0; // no fire in HORSE: everyone gets the same shot
  state.coldStreak = 0;
  state.phase = "playing";
  showScreen(null);
  stage.focus({ preventScroll: true });
  updateHud();
}

function onMake(b) {
  if (state.phase !== "playing") return;
  if (b.log) b.log[2] = 1;
  game.shots++;
  sound.swish();
  sound.cheer(1.2);
  const p = project(RIM.u, RIM.v, RIM.z);
  pixelFx.swish(p.x, p.y, "cyan");
  addPopup(spots()[game.spot].three ? "3PT" : "BUCKET", "#ffe066", p.x, p.y - 60);
  if (game.role === "set") {
    game.queue = after(game.leader);
    announce("horseSet", "#ffe066");
    turn(game.queue.shift(), "match", { news: `${name(game.leader)} made it!` });
  } else {
    announce("horseMatch", "#3ddc84");
    const news = `${name(game.shooter)} matched it!`;
    if (game.queue.length) turn(game.queue.shift(), "match", { news });
    else turn(game.leader, "set", { news });
  }
}

function onMiss() {
  game.shots++;
  if (game.role === "set") {
    const missed = game.leader;
    game.leader = after(missed)[0];
    turn(game.leader, "set", { news: `${name(missed)} missed. Now ${name(game.leader)} leads!` });
    return;
  }
  // A missed match: a letter.
  const p = game.players[game.shooter];
  p.letters++;
  const letter = HORSE_WORD[p.letters - 1];
  const at = project(player.u, player.v);
  addPopup(`${letter}!`, "#ff6b6b", at.x, at.y - 520);
  const out = !isIn(game.shooter);
  if (playersIn() === 1) {
    game.winner = game.players.findIndex((q) => q.letters < HORSE_WORD.length);
    state.phase = "ending";
    sound.gameOver();
    updateHud();
    return;
  }
  const news = out ? `${p.name} spelled ${HORSE_WORD}. Out!` : `${p.name} gets an ${letter}!`;
  const call = out ? "horseOut" : "horseLetter";
  if (game.queue.length) turn(game.queue.shift(), "match", { news, call });
  else turn(game.leader, "set", { news, call });
}

// ---------- Drawing ----------

// The spot being shot from, on the floor under the player.
function drawFloor(ctx) {
  if (!["playing", "turn", "ending"].includes(state.phase) || !game.players.length) return;
  const p = project(spots()[game.spot].u, spots()[game.spot].v);
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
  ctx.save();
  ctx.globalAlpha = 0.55 + 0.3 * pulse;
  ctx.strokeStyle = "#ffe066";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 70, 30, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Everyone's letters, top left over the wall: a name and five tiles each, the shooter marked.
function drawOver(ctx) {
  if (!["playing", "turn", "ending"].includes(state.phase) || !game.players.length) return;
  // Big enough to read on a phone, where the whole court is under 400 pixels wide.
  const row = 100;
  const tile = 84;
  const x0 = 30;
  const y0 = 30;
  const nameW = 420;
  ctx.save();
  ctx.fillStyle = "rgba(43, 22, 34, 0.82)";
  ctx.fillRect(x0, y0, nameW + HORSE_WORD.length * (tile + 8) + 40, game.players.length * row + 24);
  ctx.textBaseline = "middle";
  game.players.forEach((p, i) => {
    const y = y0 + 12 + i * row + row / 2;
    const out = !isIn(i);
    ctx.globalAlpha = out ? 0.45 : 1;
    ctx.textAlign = "left";
    ctx.font = `44px ${FONT}`;
    ctx.fillStyle = i === game.shooter && state.phase === "playing" ? "#ffe066" : "#ffffff";
    const label = (i === game.shooter && state.phase === "playing" ? "> " : "") + p.name.toUpperCase();
    ctx.fillText(label.length > 9 ? label.slice(0, 8) + "." : label, x0 + 20, y + 2);
    for (let k = 0; k < HORSE_WORD.length; k++) {
      const tx = x0 + 20 + nameW + k * (tile + 8);
      const lit = k < p.letters;
      ctx.fillStyle = lit ? "#ff4d4d" : "rgba(255, 255, 255, 0.12)";
      ctx.fillRect(tx, y - tile / 2, tile, tile);
      ctx.fillStyle = lit ? "#ffffff" : "rgba(255, 255, 255, 0.35)";
      ctx.textAlign = "center";
      ctx.font = `56px ${FONT}`;
      ctx.fillText(HORSE_WORD[k], tx + tile / 2, y + 3);
    }
  });
  ctx.restore();
}

const standings = () => game.players.map((p) => `${p.name}: ${lettersOf(p) || "no letters"}`).join(" · ");

export default {
  id: "horse",
  bestKey: null, // no best: it's a game between friends
  bonusBalls: false,
  passAndPlay: { min: 2, max: 4 },
  setPlayers,
  begin,

  startSpot: () => spots()[game.spot],
  pickSpot: () => spots()[game.spot],
  clock(dt) {
    state.elapsed += dt;
    // The music builds as someone gets close to HORSE.
    const most = Math.max(0, ...game.players.filter((p) => p.letters < HORSE_WORD.length).map((p) => p.letters));
    sound.setIntensity({ stage: most >= 4 ? 2 : most >= 2 ? 1 : 0, fire: 0, final: most >= 4 });
  },
  betweenTurns(dt) {
    game.wait -= dt;
    if (game.wait <= 0 && screensClosed()) showNext();
  },
  gameSeconds: () => state.elapsed,
  countsShot: () => true,
  onMake,
  onMiss,
  squeeze: () => 0,
  rumble: () => 0,
  drawFloor,
  drawOver,

  hud: () => (game.players.length ? [`${name(game.shooter)} to shoot`, standings()] : ["HORSE", "2 to 4 players"]),
  scoreboard: () => [["SHOT", game.shots], ["IN", game.players.length ? playersIn() : 0]],
  result: () => game.winner,
  isBetter: () => false,
  endCall: () => "horseWin",
  overText: () => ({ title: "We have a winner!", final: name(game.winner), unit: "wins!", detail: standings() }),
  formatBest: () => "",
  boardScore: () => 0,
};

// Not while help or the leaderboard is open over the court.
const screensClosed = () => !document.querySelector(".panel-screen:not([hidden])");
