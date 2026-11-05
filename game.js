// Orson's shootaround: an isometric basketball game (time attack, sudden death, around the world).
//
// The ball is simulated in 3D court space (metres) and projected onto the
// isometric court art. Screen units are "court pixels": the 2048px court image.

import { loadVoiceClips, sound } from "./audio.js?v=b614856c";
import { createFxLayer } from "./fx.js?v=61e6d0cd";
import { pickPhrase } from "./phrases.js?v=481ae699";
import { confirmDialog } from "./ui/confirm.js?v=a65ef360";
import { fillIcons, icon } from "./ui/icons.js?v=c284e3ca";
import { MONEY, NORMAL, RAINBOW, ballKind, ballPoints } from "./bonus.js?v=80033a4c";
import { countsIn, doneToday, markDone, progress, streakDays, todaysChallenge } from "./daily.js?v=6f3b9099";
import { renderBoard, showRoundResult, startToken } from "./leaderboard.js?v=3bebb26c";
import { DEFAULT_TEAM, loadBase, loadBases, myPlayers, recolor, removeMyPlayer, thumbnail } from "./players/recolor.js?v=9235830f";

const COURT_PX = 2048;
const PX_PER_M = 132;
const ORIGIN = { x: 1024, y: 816 }; // back corner of the floor
const EU = { x: -115.3, y: 64.2 }; // +1m along the left wall (the hoop wall)
const EV = { x: 114.4, y: 65.8 }; // +1m out from the left wall
const ROOM_U = 8.2;
const ROOM_V = 8.25;

const GRAVITY = 9.81;
const BALL_R = 0.23;
const RIM_H = 3.05;
const RIM_R = 0.45; // to the centre of the rim tube
const RIM_TUBE = 0.035;
const RIM = { ...unprojectFloor(611, 790 + RIM_H * PX_PER_M), z: RIM_H };
const BOARD = { v: RIM.v - 0.62, u0: 3.35, u1: 6.4, z0: 2.85, z1: 5.0 };
// Distance from the hoop to the 3-point line painted in the court art, every 10 degrees
// from along the baseline (0) round to the other baseline (180). The painted arc is not a circle.
const THREE_POINT_LINE = [3.1, 3.17, 3.33, 3.6, 3.98, 4.25, 4.48, 4.65, 4.73, 4.74, 4.68, 4.59, 4.46, 4.22, 3.97, 3.67, 3.35, 3.19, 3.1];
const LINE_CLEARANCE = 0.25; // keep spots this far off the line so it's clear which side he's on
const THREE_POINT_SHARE = 0.35;
const HOOP_FRONT_AT = { x: 515, y: 735 };

// The wall scoreboard, in its own skewed coordinates (x runs along the wall, y straight down).
const BOARD_ART = {
  origin: { x: 753.3, y: 446.7 },
  slope: -0.53,
  area: { x: 745, y: 315, w: 260, h: 275 }, // court pixels the scoreboard can touch
  face: "#2d3238",
  window: "#281a2e",
  lit: "#ff4d4d",
  unlit: "rgba(255, 77, 77, 0.12)",
  label: "#e8eef0",
  left: { label: "SCORE", labelAt: [57, 46], cover: [12, 26, 88, 34], window: [18, 71, 78, 64] },
  right: { label: "TIME", labelAt: [190, 46], cover: [142, 26, 96, 34], window: [149, 69, 83, 69] },
};

const GAME_SECONDS = 60;
// Ways to play, each with its own best:
//   timed     time attack: score as much as you can in 60 seconds (has a leaderboard)
//   survival  sudden death: no clock, keep shooting until the first miss (has a leaderboard)
//   around    around the world: score from each spot around the key in order, as fast as you can
//             (the best is the lowest time, kept on this device)
const MODES = ["timed", "survival", "around"];
const BEST_KEYS = { timed: "orson-hoops-best", survival: "orson-hoops-best-survival", around: "orson-hoops-best-around" };
const bestKey = (mode) => BEST_KEYS[mode] ?? BEST_KEYS.timed;
const AROUND_SPOT_COUNT = 7; // one for each spot in AROUND_LAYOUT
const PHYSICS_STEP = 1 / 240;
const LAUNCH_ANGLE = (52 * Math.PI) / 180;

// Jump timing (seconds since leaving the ground). Releasing at the apex is a perfect shot.
const JUMP_FRAME_TIME = 0.085;
const JUMP_APEX = 0.29;
const TIMING_WINDOW = 0.13;

// Like NBA Jam: two makes in a row heats him up, three puts him on fire until he misses,
// keeping it going turns the flames purple, and ten in a row goes blue-white supernova.
// Add a level here to go even further (and to FIRE_BONUS in worker/src/index.ts, which
// checks scores).
//   streak: makes in a row to reach it
//   window: timing window is this much wider
//   bonus:  extra points per basket
const FIRE_LEVELS = [
  {
    streak: 3,
    window: 1.4,
    bonus: 1,
    phrase: "onFire",
    stillPhrase: "stillOnFire",
    color: "#ff9f43",
    fx: { palette: "fire", radius: 5 },
  },
  {
    streak: 6,
    window: 1.6,
    bonus: 2,
    phrase: "purpleFire",
    stillPhrase: "stillPurpleFire",
    color: "#c77dff",
    fx: { palette: "purpleFire", radius: 6 },
  },
  {
    streak: 10,
    window: 1.7,
    bonus: 3,
    phrase: "supernova",
    stillPhrase: "stillSupernova",
    color: "#8fd8ff",
    fx: { palette: "supernova", radius: 7 },
  },
];
const BANNER_SECONDS = 1.7;
const BUZZER_CELEBRATION = 3.2; // seconds to celebrate a buzzer beater before the game-over screen
const SLOW_MO = 0.35; // game speed while a shot at the buzzer drops toward the hoop

const ANIM_FPS = { idle: 3, turn: 20, dribble: 14, gather: 24, release: 16 };
const DEFAULT_SPOT = { u: 4.6, v: 4.6 };
const DEBUG = new URLSearchParams(location.search).has("debug");

const stage = document.getElementById("stage");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const pixelFx = createFxLayer();
const scoreEl = document.getElementById("score");
const timeEl = document.getElementById("time");
const $ = (id) => document.getElementById(id);
const screens = { title: $("title-screen"), select: $("select-screen"), modes: $("mode-screen"), over: $("over-screen"), help: $("help-screen"), board: $("board-screen") };
const tapToPlay = $("tap-to-play");
const helpButton = $("help-button");
// Keyboards say "press Space"; touch screens say "tap".
// How they can play: a touch screen, a keyboard (a mouse or trackpad means one is likely), or
// both, like a laptop with a touch screen or an iPad with a keyboard.
const HAS_TOUCH = matchMedia("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0;
const HAS_KEYS = matchMedia("(any-hover: hover) and (any-pointer: fine)").matches || !HAS_TOUCH;
// Say how to do something: by touch, by keyboard, or either, depending on what they have.
const howTo = (touch, keys, both) => (HAS_TOUCH && HAS_KEYS ? both : HAS_KEYS ? keys : touch);
const muteBtn = document.getElementById("mute");
const musicBtn = document.getElementById("music");
const charPick = document.getElementById("char-pick");

// ---------- Projection ----------

function project(u, v, z = 0) {
  return {
    x: ORIGIN.x + u * EU.x + v * EV.x,
    y: ORIGIN.y + u * EU.y + v * EV.y - z * PX_PER_M,
  };
}

function unprojectFloor(x, y) {
  const dx = x - ORIGIN.x;
  const dy = y - ORIGIN.y;
  const det = EU.x * EV.y - EV.x * EU.y;
  return { u: (dx * EV.y - EV.x * dy) / det, v: (EU.x * dy - dx * EU.y) / det };
}

// ---------- Storage (best score, mute) ----------

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage disabled: the game still works, it just forgets.
  }
}

// ---------- Sound buttons ----------

sound.muted = load("orson-hoops-muted", false);
sound.musicOn = load("orson-hoops-music", true);

function syncSoundButtons() {
  muteBtn.innerHTML = icon(sound.muted ? "mute" : "sound");
  muteBtn.setAttribute("aria-label", sound.muted ? "Unmute sound" : "Mute sound");
  musicBtn.classList.toggle("off", !sound.musicOn);
  musicBtn.setAttribute("aria-label", sound.musicOn ? "Turn music off" : "Turn music on");
  musicBtn.setAttribute("aria-pressed", String(sound.musicOn));
}

muteBtn.addEventListener("click", (e) => {
  sound.setMuted(!sound.muted);
  save("orson-hoops-muted", sound.muted);
  syncSoundButtons();
  e.stopPropagation();
});
musicBtn.addEventListener("click", (e) => {
  sound.unlock(); // a click counts as the go-ahead browsers need before playing sound
  sound.setMusic(!sound.musicOn);
  save("orson-hoops-music", sound.musicOn);
  syncSoundButtons();
  e.stopPropagation();
});
// Browsers only allow sound after a tap or key press: the first one anywhere starts the music.
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, () => sound.unlock(), { capture: true, once: true });
for (const btn of [muteBtn, musicBtn, helpButton, $("board-button")]) btn.addEventListener("pointerdown", (e) => e.stopPropagation());
// Clicked with a mouse or finger, the sound buttons hand focus back to the game, or Space would
// keep pressing them instead of shooting. (Keyboard users who tabbed to them keep their place.)
for (const btn of [muteBtn, musicBtn]) {
  btn.addEventListener("click", (e) => {
    if (e.detail > 0) stage.focus({ preventScroll: true });
  });
}
syncSoundButtons();

// ---------- Ball sprite (drawn in code so it can spin) ----------

// The seams turn while the light stays put, drawn fresh for each frame so the pixels stay crisp
// (rotating one picture smears its pixels). The seam pattern repeats every half turn.
const BALL_FRAMES = 12;

// look: the ball's colours (BALL_LOOKS). A rainbow ball's colour runs around it in bands.
const BALL_LOOKS = {
  [NORMAL]: { main: "#de6d2b", shade: "#b5501d", shine: "#f39a55", seam: "#5b2a12", edge: "#3a1a10" },
  [MONEY]: { main: "#f0b424", shade: "#c48412", shine: "#fff3a6", seam: "#7a4a08", edge: "#4a2c08" },
  [RAINBOW]: { rainbow: true, shine: "#ffffff", seam: "#3a2a5a", edge: "#2a1a3a" },
};

function makeBallSprite(turn, look = BALL_LOOKS[NORMAL]) {
  const size = 16;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const mid = (size - 1) / 2;
  const cos = Math.cos(turn), sin = Math.sin(turn);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - mid, y - mid);
      if (d > 7.6) continue;
      // the seams, in the ball's own turned frame
      const rx = mid + (x - mid) * cos + (y - mid) * sin;
      const ry = mid - (x - mid) * sin + (y - mid) * cos;
      let color = look.rainbow
        ? `hsl(${Math.round(((rx + ry) * 22) % 360)}, 90%, ${x + y > 19 ? 48 : 60}%)`
        : x + y > 19 ? look.shade : look.main;
      if (Math.hypot(x - 5, y - 4.5) < 2) color = look.shine;
      const seam =
        Math.abs(rx - mid) < 0.6 ||
        Math.abs(ry - mid) < 0.6 ||
        Math.abs(Math.hypot(rx + 4, ry - mid) - 9.5) < 0.6 ||
        Math.abs(Math.hypot(rx - 19, ry - mid) - 9.5) < 0.6;
      if (seam) color = look.seam;
      if (d > 6.7) color = look.edge;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// One spinning set of frames for each kind of ball.
function makeBallSprites() {
  const frames = (look) => Array.from({ length: BALL_FRAMES }, (_, i) => makeBallSprite((i / BALL_FRAMES) * Math.PI, look));
  return { [NORMAL]: frames(BALL_LOOKS[NORMAL]), [MONEY]: frames(BALL_LOOKS[MONEY]), [RAINBOW]: frames(BALL_LOOKS[RAINBOW]) };
}

// The next ball's kind: money or rainbow now and then, but only in games that score points.
function nextBallKind() {
  if (state.phase !== "playing" || !scoresPoints()) return NORMAL;
  return ballKind(state.gameToken, state.shotLog.length);
}
const BALL_BADGES = { [MONEY]: { text: "MONEY BALL x2", color: "#ffd700", call: "moneyBall" }, [RAINBOW]: { text: "RAINBOW BALL +5", color: "#ff86e6", call: "rainbowBall" } };

// ---------- Game state ----------

const state = {
  phase: "loading", // loading | title | playing | ending | over
  score: 0,
  mode: "timed",
  best: 0,
  timeLeft: GAME_SECONDS,
  elapsed: 0, // seconds since the start (sudden death has no clock to count down)
  aroundAt: 0, // around the world: the spot they're on (0 to 6)
  aroundTime: 0, // around the world: the time it took, once it's done
  stats: null, // what happened in this game, for the daily challenge (newStats)
  dailyDone: false, // finished the daily challenge in this game
  overAt: 0,
  balls: [],
  popups: [],
  shake: 0,
  shoeFire: null,
  confetti: [],
  flash: 0,
  timeScale: 1,
  endAt: 0,
  buzzerBeater: false,
  banner: null,
  streak: 0, // makes in a row
  coldStreak: 0, // misses in a row
  pressed: false,
  // For the leaderboard: each shot as [seconds in, 3-pointer, made, release timing], the game's
  // start token from the server, how it was played, and whether the tab was hidden mid-game.
  shotLog: [],
  gameToken: null,
  input: "touch",
  hiddenTab: false,
};

const player = {
  u: DEFAULT_SPOT.u,
  v: DEFAULT_SPOT.v,
  anim: "idle",
  t: 0, // time in current animation
  fade: 1,
  activeBall: null,
  moving: false,
};

let sprites, atlas, hoopFront, ballSprites, shoeRegions;

// ---------- Characters ----------

// assets/characters/index.json lists the hand-made players (tools/build_character.py). Players
// made with the builder (/players/) come from the API once approved, drawn from a base body in
// their chosen colours.
const PLAYERS_API = ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://localhost:8787/api/players" : "/api/players";
const characters = {
  list: [{ id: "orson", name: "Orson", atlas: "assets/sprites.webp", meta: "assets/sprites.json", thumb: "" }],
  loaded: new Map(),
  selected: load("orson-hoops-character", "orson"),
};

async function loadBuilt(entry) {
  const base = (await loadBases()).find((b) => b.id === entry.base);
  const loaded = await loadBase(base);
  return { meta: loaded.meta, img: recolor(loaded, entry.colours), loaded };
}

async function loadCharacter(id) {
  if (!characters.loaded.has(id)) {
    const entry = characters.list.find((c) => c.id === id) ?? characters.list[0];
    const loading = entry.base
      ? loadBuilt(entry)
      : Promise.all([fetch(entry.meta).then((r) => r.json()), loadImage(entry.atlas)]).then(([meta, img]) => ({ meta, img }));
    characters.loaded.set(id, loading);
    loading.catch(() => characters.loaded.delete(id));
  }
  return characters.loaded.get(id);
}

async function selectCharacter(id) {
  const { meta, img, loaded } = await loadCharacter(id);
  sprites = meta;
  atlas = img;
  shoeRegions = loaded?.regionsData ?? null; // builder players: which pixels are shoes
  characters.selected = id;
  save("orson-hoops-character", id);
  if (state.phase === "select") renderPicker();
}

// A player's face for the picker and the leaderboard.
// Builder players' faces, drawn once each, so redrawing a list doesn't flash the plain body.
const faces = new Map(); // base + colours -> data URL
function setFace(img, c) {
  if (!c.base) {
    img.src = c.thumb;
    return;
  }
  const key = c.base + JSON.stringify(c.colours);
  if (faces.has(key)) {
    img.src = faces.get(key);
    return;
  }
  img.src = c.thumb;
  // Show their own colours once their base body has loaded.
  loadBuilt(c)
    .then(({ loaded }) => {
      faces.set(key, thumbnail(loaded, c.colours).toDataURL());
      img.src = faces.get(key);
    })
    .catch(() => {});
}

// The player select screen: a card per player, then one to make your own.
function renderPicker() {
  charPick.replaceChildren(
    ...characters.list.map((c) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card";
      button.setAttribute("aria-pressed", String(c.id === characters.selected));
      const img = document.createElement("img");
      img.alt = "";
      setFace(img, c);
      const name = document.createElement("span");
      name.textContent = c.name;
      button.append(img, name);
      button.addEventListener("click", async () => {
        await selectCharacter(c.id);
        save("orson-hoops-chosen", true);
        stage.focus({ preventScroll: true }); // so Space plays rather than pressing this card again
        if (selectThenPlay) startGame();
        else showTitle();
      });
      if (!c.mine) return button;
      // Players saved on this device get a star and a way to remove them.
      name.insertAdjacentHTML("afterbegin", icon("star", "Made on this device"));
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "remove", innerHTML: icon("close") });
      remove.setAttribute("aria-label", `Remove ${c.name} from this device`);
      remove.addEventListener("click", async () => {
        if (!(await confirmDialog(`Remove ${c.name}?`, { yes: "Remove", detail: "They'll be gone from this device. You can make them again any time." })))
          return;
        removeMyPlayer(c.id);
        characters.list = characters.list.filter((p) => p.id !== c.id);
        characters.loaded.delete(c.id);
        if (characters.selected === c.id) selectCharacter(characters.list[0].id);
        else renderPicker();
      });
      const card = Object.assign(document.createElement("span"), { className: "mine" });
      card.append(button, remove);
      return card;
    }),
    Object.assign(document.createElement("a"), { href: "/players/", className: "card make-player", innerHTML: `${icon("plus")}<span>Make your player</span>` }),
  );
}

// Players made on this device (saved by the builder's "Play now"), then approved builder players.
async function loadBuiltPlayers() {
  const bases = await loadBases().catch(() => []);
  for (const p of myPlayers()) {
    const base = bases.find((b) => b.id === p.base);
    if (base) characters.list.push({ ...p, mine: true, thumb: "/" + base.thumb, colours: { teamName: DEFAULT_TEAM, ...p.colours } });
  }
  try {
    const res = await fetch(PLAYERS_API);
    if (!res.ok) return;
    const { players } = await res.json();
    for (const p of players) {
      const base = bases.find((b) => b.id === p.base);
      if (!base) continue;
      characters.list.push({
        id: `p${p.id}`,
        name: p.name,
        base: p.base,
        thumb: "/" + base.thumb,
        colours: { skin: p.skin, hair: p.hair, jersey: p.jersey, team: p.team, shoes: p.shoes, number: p.number ?? "", teamName: p.team_name ?? DEFAULT_TEAM },
      });
    }
  } catch {
    // Offline or the API is down: the hand-made players still work.
  }
}

function setAnim(name) {
  player.anim = name;
  player.t = 0;
  player.lastDribbleFrame = -1;
}

function spotDistance(u, v) {
  return Math.hypot(u - RIM.u, v - RIM.v);
}

function threePointRadius(u, v) {
  const deg = Math.max(0, Math.min(180, (Math.atan2(v - RIM.v, u - RIM.u) * 180) / Math.PI));
  const i = Math.min(THREE_POINT_LINE.length - 2, Math.floor(deg / 10));
  const f = deg / 10 - i;
  return THREE_POINT_LINE[i] * (1 - f) + THREE_POINT_LINE[i + 1] * f;
}

function isThreePointSpot(u, v) {
  return spotDistance(u, v) > threePointRadius(u, v);
}

// Around the world: in close on one block, out along the baseline, up to the elbow, the free throw
// line, then back down the other side, like on a real court. [angle from the hoop, metres out,
// measured against the key painted on the court]
const AROUND_LAYOUT = [
  [44, 1.7], // block
  [40, 2.9], // baseline
  [66, 3.4], // elbow
  [90, 3.45], // free throw line
  [114, 3.4], // elbow
  [140, 2.9], // baseline
  [136, 1.7], // block
];
let aroundSpots = null;
function getAroundSpots() {
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

// Picks a spot around the hoop: about a third are behind the 3-point line.
function pickSpot() {
  // Around the world: the spot they're on until they make it, then the next.
  if (state.mode === "around") return getAroundSpots()[Math.min(state.aroundAt, AROUND_SPOT_COUNT - 1)];
  const wantThree = Math.random() < THREE_POINT_SHARE;
  for (let i = 0; i < 100; i++) {
    // Keep him roughly in front of the hoop so his back-on shooting pose still faces it.
    const angle = ((40 + Math.random() * 100) * Math.PI) / 180;
    const line = threePointRadius(RIM.u + Math.cos(angle), RIM.v + Math.sin(angle));
    const d = wantThree
      ? line + LINE_CLEARANCE + Math.random() * 0.7
      : 2 + Math.random() * (line - LINE_CLEARANCE - 2);
    const u = RIM.u + Math.cos(angle) * d;
    const v = RIM.v + Math.sin(angle) * d;
    if (u < 1.8 || u > ROOM_U - 0.8 || v > ROOM_V - 0.8) continue;
    if (Math.hypot(u - player.u, v - player.v) < 0.8) continue;
    return { u, v };
  }
  return { ...DEFAULT_SPOT };
}

// Picks the mode for the next game (remembered for next time) and shows its best.
function setMode(mode) {
  state.mode = MODES.includes(mode) ? mode : "timed";
  state.best = load(bestKey(state.mode), 0);
  save("orson-hoops-mode", state.mode);
  updateHud();
}

const survival = () => state.mode === "survival";
const around = () => state.mode === "around";
const scoresPoints = () => !around(); // around the world is against the clock instead
const showBest = (best) => (around() ? `${best.toFixed(1)}s` : best);
// How far into the game we are, for the shot log.
const gameSeconds = () => (survival() || around() ? state.elapsed : GAME_SECONDS - state.timeLeft);

function startGame() {
  state.phase = "playing";
  state.score = 0;
  state.timeLeft = GAME_SECONDS;
  state.elapsed = 0;
  state.balls = [];
  state.popups = [];
  state.confetti = [];
  pixelFx.clear();
  state.shoeFire = null;
  state.flash = 0;
  state.timeScale = 1;
  state.endAt = 0;
  state.shotLog = [];
  state.hiddenTab = false;
  state.gameToken = null;
  const game = ++gamesStarted;
  startToken().then((token) => {
    if (game === gamesStarted) state.gameToken = token;
  });
  state.buzzerBeater = false;
  state.streak = 0;
  state.coldStreak = 0;
  state.aroundAt = 0;
  state.aroundTime = 0;
  state.stats = newStats();
  state.dailyDone = false; // finished the daily challenge in this game
  const start = around() ? getAroundSpots()[0] : DEFAULT_SPOT;
  player.u = start.u;
  player.v = start.v;
  player.fade = 1;
  player.activeBall = null;
  player.moving = false;
  setAnim("idle");
  showScreen(null);
  updateHud();
  sound.gameStart();
  announce("start", "#ffffff");
}

function endGame() {
  state.phase = "over";
  state.overAt = performance.now();
  checkDaily(); // things only known at the end, like the final score
  if (around()) return endAroundTheWorld();
  const isBest = state.score > state.best;
  if (isBest) {
    state.best = state.score;
    save(bestKey(state.mode), state.best);
  }
  const verdict =
    isBest && state.score > 0
      ? "newBest"
      : state.score >= 50
        ? "overGoat"
        : state.score >= 30
          ? "overHigh"
          : state.score >= 10
            ? "overMid"
            : "overLow";
  announce(verdict, "#ffe066");
  $("over-title").textContent =
    isBest && state.score > 0 ? "New high score!" : survival() ? "Missed!" : state.buzzerBeater ? "Buzzer beater!" : "Time's up!";
  $("final-score").textContent = state.score;
  $("final-unit").textContent = "points";
  const made = state.shotLog.filter((s) => s[2]).length;
  $("over-detail").textContent = survival()
    ? `${made} in a row · Best: ${state.best}`
    : (state.buzzerBeater ? "Won it at the buzzer! " : "") + `Best: ${state.best}`;
  showDaily();
  showScreen("over");
  showRound();
}

// Around the world is over once the last spot goes in: the time is what counts (lower is better).
function endAroundTheWorld() {
  const time = Math.round(state.aroundTime * 10) / 10;
  const isBest = !state.best || time < state.best;
  if (isBest) {
    state.best = time;
    save(bestKey(state.mode), time);
  }
  if (isBest) announce("newBest", "#ffe066");
  $("over-title").textContent = isBest ? "New best time!" : "Around the world!";
  $("final-score").textContent = time.toFixed(1);
  $("final-unit").textContent = "seconds";
  const shots = state.shotLog.length;
  $("over-detail").textContent = `${shots} shots for ${AROUND_SPOT_COUNT} spots · Best: ${showBest(state.best)}`;
  showDaily();
  showScreen("over");
  showRound();
}

// One screen over the court at a time (or none while playing). Help sits on top of the others.
function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  stage.dataset.phase = state.phase;
}

function showTitle() {
  state.phase = "title";
  tapToPlay.textContent = howTo("Tap to play", "Press Space to play", "Tap or press Space to play");
  setMode(state.mode);
  showScreen("title");
}

// Step two, after tapping to start: pick a game (each card shows its best), then a player.
function openModes() {
  state.phase = "modes";
  showDaily();
  for (const card of screens.modes.querySelectorAll("[data-mode]")) {
    const mode = card.dataset.mode;
    const best = load(bestKey(mode), 0);
    card.setAttribute("aria-pressed", String(mode === state.mode));
    card.querySelector("[data-best]").textContent = best ? `Your best: ${mode === "around" ? `${best.toFixed(1)}s` : best}` : "No best yet";
  }
  showScreen("modes");
  // Focus their last game, but only once Space is let go, or letting go would pick it.
  const focus = () => screens.modes.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  if (state.pressed) window.addEventListener("keyup", () => setTimeout(focus), { once: true });
  else focus();
}

// Pick a player. The first time someone plays, this comes first and then the game starts.
let selectThenPlay = false;
function openSelect(thenPlay = false) {
  selectThenPlay = thenPlay;
  state.phase = "select";
  renderPicker();
  showScreen("select");
  (charPick.querySelector('[aria-pressed="true"]') ?? charPick.querySelector("button"))?.focus({ preventScroll: true });
}

let gamesStarted = 0;
const made = () => state.shotLog.filter((s) => s[2]).length;

// ---------- Leaderboard ----------

const GAME_VERSION = new URL(import.meta.url).searchParams.get("v");

// Under the final score: where a new best this week would land (and the button to put it on),
// or their own top scores this week.
// Around the world sends its time, in tenths of a second.
function showRound() {
  const score = around() ? Math.round(state.aroundTime * 10) : state.score;
  const c = characters.list.find((p) => p.id === characters.selected);
  const look = { player: characters.selected, base: c?.base ?? null, colours: c?.mine ? c.colours : null }; // their own player, so everyone sees its face
  const shots = state.shotLog;
  showRoundResult($("over-board"), {
    mode: state.mode,
    score,
    look,
    playerName: c?.name ?? "",
    ownPlayer: !!c?.mine,
    canSend: !DEBUG && score > 0,
    faceFor: boardFace,
    payload: () =>
      state.gameToken && {
        token: state.gameToken,
        mode: state.mode,
        score,
        shots,
        ...look,
        input: state.input,
        hiddenTab: state.hiddenTab,
        version: GAME_VERSION,
        debug: DEBUG,
      },
  });
}

// Leaderboard rows show the face of who they played as.
function boardFace(row, img) {
  const c = characters.list.find((p) => p.id === row.player);
  if (c) return setFace(img, c);
  img.src = characters.list[0].thumb;
  // Players made on someone's device: their own colours, or the body's own if none were sent.
  if (row.base) setFace(img, { thumb: img.src, base: row.base, colours: row.colours ?? {} });
}

// The whole player standing, for the card a leaderboard row opens.
async function boardBody(row) {
  const c = characters.list.find((p) => p.id === row.player);
  let meta, img;
  if (c) ({ meta, img } = await loadCharacter(c.id));
  else if (row.base) {
    const base = (await loadBases()).find((b) => b.id === row.base);
    const loaded = await loadBase(base);
    ({ meta } = loaded);
    img = recolor(loaded, row.colours ?? {});
  } else ({ meta, img } = await loadCharacter(characters.list[0].id));
  const [x, y, w, h] = meta.frames.idle[0];
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  canvas.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h);
  return canvas;
}

let boardReturn = null;
// The leaderboard opens on the mode they're playing; its tabs switch mode and week or all time.
let boardMode = null;
function openBoard(range = "week", mode = boardMode ?? state.mode) {
  if (screens.board.hidden) {
    boardReturn = Object.keys(screens).find((k) => !screens[k].hidden) ?? null;
    mode = boardMode = state.mode;
  }
  boardMode = mode;
  for (const tab of screens.board.querySelectorAll("[data-range]")) tab.setAttribute("aria-selected", String(tab.dataset.range === range));
  for (const tab of screens.board.querySelectorAll("[data-board-mode]")) tab.setAttribute("aria-selected", String(tab.dataset.boardMode === mode));
  showScreen("board");
  renderBoard($("board-list"), $("board-note"), range, mode, boardFace, boardBody);
}
const boardRange = () => screens.board.querySelector('[data-range][aria-selected="true"]')?.dataset.range ?? "week";
function closeBoard() {
  showScreen(boardReturn === "board" ? "title" : boardReturn);
  stage.focus({ preventScroll: true });
}

let helpReturn = null;
function openHelp() {
  helpReturn = Object.keys(screens).find((k) => !screens[k].hidden) ?? null;
  showScreen("help");
  $("help-close").focus({ preventScroll: true });
}
function closeHelp() {
  showScreen(helpReturn);
  stage.focus({ preventScroll: true });
}

// Tapping to start: choose a game, then a player, then play.
function begin() {
  openModes();
}

function updateHud() {
  scoreEl.textContent = around() ? `spot ${Math.min(state.aroundAt + 1, AROUND_SPOT_COUNT)} of ${AROUND_SPOT_COUNT}` : state.score;
  timeEl.textContent = survival()
    ? `${made()} made, sudden death`
    : around()
      ? `${Math.floor(state.elapsed)} seconds`
      : `${Math.ceil(state.timeLeft)} seconds left`;
  scoreboardDirty = true;
}

// ---------- Input ----------

function press() {
  if (state.pressed) return;
  state.pressed = true;
  sound.unlock();

  if (!screens.help.hidden) return;
  if (state.phase === "title") begin();
  else if (state.phase === "over") {
    if (performance.now() - state.overAt < 900) return;
    startGame();
  }
  if (state.phase !== "playing" || player.moving) return;

  if (player.anim === "idle") {
    setAnim("turn");
    sound.squeak();
  } else if (player.anim === "dribble") setAnim("gather");
}

function release() {
  if (!state.pressed) return;
  state.pressed = false;
  if (player.anim === "gather") shoot(-2.5);
  else if (player.anim === "jump") shoot((player.t - JUMP_APEX) / timingWindow());
}

// Arrow keys move between the cards when choosing a game or a player: to the nearest card that
// way, so it works however the cards wrap. Enter or Space picks the one in focus.
function arrowMove(key) {
  if (document.querySelector("dialog[open]")) return false;
  const area = state.phase === "modes" && !screens.modes.hidden ? screens.modes.querySelector(".mode-cards")
    : state.phase === "select" && !screens.select.hidden ? charPick : null;
  if (!area) return false;
  const cards = [...area.querySelectorAll(".mode-card, .card")];
  const current = cards.includes(document.activeElement) ? document.activeElement : null;
  if (!current) {
    (area.querySelector('[aria-pressed="true"]') ?? cards[0])?.focus({ preventScroll: true });
    return true;
  }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  const centre = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const [cx, cy] = centre(current);
  let best = null;
  let bestScore = Infinity;
  for (const card of cards) {
    if (card === current) continue;
    const [x, y] = centre(card);
    const along = (x - cx) * dir[0] + (y - cy) * dir[1];
    if (along < 4) continue; // not that way
    const across = Math.abs((x - cx) * dir[1] + (y - cy) * dir[0]);
    const score = along + across * 3; // prefer cards in line over ones off to the side
    if (score < bestScore) [best, bestScore] = [card, score];
  }
  best?.focus({ preventScroll: true });
  best?.scrollIntoView({ block: "nearest" });
  return true;
}

// Typing in a form (like the ideas box) shouldn't make Orson shoot.
const typing = (e) => e.target instanceof Element && e.target.closest("input, textarea, select, button, dialog");

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
    if (!screens.help.hidden) closeHelp();
    else if (!screens.board.hidden) closeBoard();
    else if (state.phase === "select" || state.phase === "modes") showTitle();
    return;
  }
  if (e.key.startsWith("Arrow") && arrowMove(e.key)) {
    e.preventDefault();
    return;
  }
  if (e.code !== "Space" && e.key !== " ") return;
  if (typing(e)) return;
  e.preventDefault();
  state.input = "keyboard";
  if (!e.repeat) press();
});
window.addEventListener("keyup", (e) => {
  if (e.code !== "Space" && e.key !== " ") return;
  if (typing(e)) return;
  e.preventDefault();
  release();
});

// Taps on the screens' panels and buttons are theirs, not a shot. (The title screen lets taps through.)
for (const el of Object.values(screens).filter((el) => el !== screens.title))
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
$("mode-back").addEventListener("click", showTitle);
$("change-mode").addEventListener("click", openModes);
for (const card of screens.modes.querySelectorAll("[data-mode]"))
  card.addEventListener("click", () => {
    setMode(card.dataset.mode);
    openSelect(true); // then choose a player
  });
// Back from choosing a player: to choosing a game, if that's where they came from.
$("select-back").addEventListener("click", () => (selectThenPlay ? openModes() : showTitle()));
$("again").addEventListener("click", () => {
  if (performance.now() - state.overAt > 900) startGame();
});
$("change-player").addEventListener("click", () => openSelect());
$("got-idea").addEventListener("click", () => window.dispatchEvent(new CustomEvent("feedback:open", { detail: { app: "basketball" } })));
helpButton.addEventListener("click", () => (screens.help.hidden ? openHelp() : closeHelp()));
$("help-close").addEventListener("click", closeHelp);
$("board-button").addEventListener("click", () => (screens.board.hidden ? openBoard() : closeBoard()));
$("board-back").addEventListener("click", closeBoard);
for (const tab of screens.board.querySelectorAll("[data-range]")) tab.addEventListener("click", () => openBoard(tab.dataset.range, boardMode));
for (const tab of screens.board.querySelectorAll("[data-board-mode]")) tab.addEventListener("click", () => openBoard(boardRange(), tab.dataset.boardMode));
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.phase === "playing") state.hiddenTab = true;
});
fillIcons(stage);

// The whole game area takes presses, not just the court: on a phone there's room below the
// court for a thumb to hold down without covering the player.
const pad = document.querySelector(".game-page") ?? stage;
// Things on the page that are tapped for their own sake, not to shoot.
const OWN_TAPS = "a, button, input, select, textarea, dialog, .panel-screen";

let activePointer = null;
pad.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (!e.target.closest(OWN_TAPS)) state.input = e.pointerType === "mouse" ? "mouse" : "touch";
  if (activePointer !== null || e.target.closest(OWN_TAPS)) return;
  activePointer = e.pointerId;
  try {
    pad.setPointerCapture(e.pointerId);
  } catch {
    // Capture is a nicety; pointerup on the pad still ends the press.
  }
  e.preventDefault();
  stage.focus({ preventScroll: true }); // so Space keeps working after a click below the court
  press();
});
// Stops iOS long-press callouts, text selection and scrolling while holding to shoot.
pad.addEventListener(
  "touchstart",
  (e) => {
    if (!e.target.closest(OWN_TAPS)) e.preventDefault();
  },
  { passive: false },
);
function pointerEnd(e) {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  release();
}
pad.addEventListener("pointerup", pointerEnd);
pad.addEventListener("pointercancel", pointerEnd);
pad.addEventListener("lostpointercapture", pointerEnd);
pad.addEventListener("contextmenu", (e) => {
  if (!e.target.closest(OWN_TAPS)) e.preventDefault();
});
window.addEventListener("blur", () => {
  activePointer = null;
  release();
});

// ---------- Shooting ----------

// The fire level for the current streak, or null when not on fire.
function fireLevel() {
  let level = null;
  for (const l of FIRE_LEVELS) if (state.streak >= l.streak) level = l;
  return level;
}

function timingWindow() {
  return TIMING_WINDOW * (fireLevel()?.window ?? 1) * (1 - SUDDEN_DEATH.squeeze * pressure());
}

// Sudden death gets harder the longer the run goes. pressure() rises from 0 at `from` makes in a
// row to 1 at `full`, and with it:
//   squeeze  how much of the green part of the jump bar is gone at full pressure (0.65 = 65%)
//   rumble   how far the court shakes at full pressure, in court pixels (it starts at `rumbleFrom`)
const SUDDEN_DEATH = { from: 3, full: 30, squeeze: 0.65, rumble: 14, rumbleFrom: 10 };
function pressure(from = SUDDEN_DEATH.from) {
  if (!survival() || (state.phase !== "playing" && state.phase !== "ending")) return 0;
  return Math.max(0, Math.min(1, (state.streak - from) / (SUDDEN_DEATH.full - from)));
}

function gaussian() {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

// `timing` is 0 for a perfect release, negative for early and positive for late.
function shoot(timing) {
  if (!hints.learned) {
    hints.learned = true;
    save("orson-hoops-learned", true);
  }
  const ground = project(player.u, player.v);
  const [offX, offY] = sprites.releaseOffset;
  const dirU = RIM.u - player.u;
  const dirV = RIM.v - player.v;
  const dist = Math.hypot(dirU, dirV);
  const du = dirU / dist;
  const dv = dirV / dist;

  // Start the ball where his hands are in the release frame.
  const screenPerM = du * EU.x + dv * EV.x;
  const ahead = Math.max(0, Math.min(1, screenPerM ? offX / screenPerM : 0.5));
  const u = player.u + du * ahead;
  const v = player.v + dv * ahead;
  const z = (project(u, v).y - (ground.y + offY)) / PX_PER_M;

  // Releasing late (on the way down) flattens the shot.
  const clamped = Math.max(-2.5, Math.min(2.5, timing));
  const angle = LAUNCH_ANGLE - Math.max(0, clamped) * 0.1;

  // Ideal speed to drop through the rim at that angle, aiming a touch past the centre.
  const d = Math.hypot(RIM.u - u, RIM.v - v) + 0.05;
  const dz = RIM.z - z;
  const cos = Math.cos(angle);
  const ideal = Math.sqrt((GRAVITY * d * d) / (2 * cos * cos * (d * Math.tan(angle) - dz)));

  const speed = ideal * (1 + 0.11 * clamped + 0.012 * gaussian());
  const sideways = 0.012 * gaussian() + 0.012 * clamped * Math.sign(gaussian());
  const hu = du * cos - dv * sideways;
  const hv = dv * cos + du * sideways;

  const ball = {
    u, v, z,
    vu: hu * speed,
    vv: hv * speed,
    vz: Math.sin(angle) * speed,
    spin: 0,
    age: 0,
    scored: false,
    touchedRim: false,
    touchedBoard: false,
    decided: false,
    bounces: 0,
    three: isThreePointSpot(player.u, player.v),
    fire: fireLevel(),
    kind: nextBallKind(),
    prevZ: z,
  };
  state.balls.push(ball);
  if (ball.fire) {
    sound.fireWhoosh();
    const p = project(u, v, z);
    ball.trail = pixelFx.fireTrail(p.x, p.y, ball.fire.fx);
  }
  if (state.phase === "playing") {
    ball.log = [Math.round(gameSeconds() * 100) / 100, ball.three ? 1 : 0, 0, Math.round(clamped * 1000) / 1000, ball.kind];
    state.shotLog.push(ball.log);
  }
  player.activeBall = ball;
  setAnim("release");
}

function addPopup(text, color, x, y) {
  state.popups.push({ text, color, x, y, age: 0 });
}

function announce(category, color, { big = false } = {}) {
  const text = pickPhrase(category);
  state.banner = { text: text.toUpperCase(), color, age: 0, big, duration: big ? BUZZER_CELEBRATION : BANNER_SECONDS };
  sound.say(text);
}

// The biggest moment in the game: flash, confetti, a roar and a big gold call.
function celebrateBuzzerBeater() {
  state.buzzerBeater = true;
  state.flash = 1;
  confettiBurst(180);
  pixelFx.fireworks(COURT_PX);
  sound.buzzerBeater();
  announce("buzzer", "#ffd700", { big: true });
}

// Sudden death: a bigger call the longer the run goes.
//   streak: makes in a row   call: phrase list (phrases.js)   level: 1 a shout, 2 adds confetti, 3 adds fireworks
// Past the last one, every 10 more gets a "runLegend" call at the top level.
const RUN_CALLS = [
  { streak: 10, call: "run10", level: 1 },
  { streak: 15, call: "run15", level: 1 },
  { streak: 20, call: "run20", level: 2 },
  { streak: 25, call: "run25", level: 2 },
  { streak: 30, call: "run30", level: 3 },
  { streak: 40, call: "run40", level: 3 },
  { streak: 50, call: "run50", level: 3 },
];
function runCall(streak) {
  const top = RUN_CALLS.at(-1);
  return RUN_CALLS.find((r) => r.streak === streak) ?? (streak > top.streak && streak % 10 === 0 ? { streak, call: "runLegend", level: 3 } : null);
}
function celebrateRun(run, p, newFire = null) {
  addPopup(`${run.streak} IN A ROW`, "#ffd700", p.x, p.y - 140);
  sound.cheer(1.4 + run.level * 0.2);
  if (run.level >= 2) {
    state.flash = 0.5;
    confettiBurst(run.level >= 3 ? 140 : 70);
  }
  if (run.level >= 3) pixelFx.fireworks(COURT_PX);
  if (newFire) announce(newFire.phrase, newFire.color, { big: run.level >= 2 });
  else announce(run.call, run.level >= 3 ? "#ffd700" : "#ffe066", { big: run.level >= 2 });
}

function confettiBurst(count) {
  for (let i = 0; i < count; i++) {
    state.confetti.push({
      x: Math.random() * COURT_PX,
      y: -40 - Math.random() * 600,
      vx: (Math.random() - 0.5) * 200,
      vy: 250 + Math.random() * 350,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      size: 14 + Math.random() * 14,
      color: ["#ffd700", "#ff6b6b", "#7cf0ff", "#ffffff", "#c77dff", "#3ddc84"][i % 6],
    });
  }
}

// ---------- Physics ----------

function stepBall(b, dt) {
  b.age += dt;
  b.prevZ = b.z;
  b.vz -= GRAVITY * dt;
  const drag = 1 - 0.04 * dt;
  b.vu *= drag;
  b.vv *= drag;
  b.vz *= drag;
  b.u += b.vu * dt;
  b.v += b.vv * dt;
  b.z += b.vz * dt;
  b.spin -= dt * 9;

  collideRim(b);
  collideBoard(b);

  // Basket: the ball centre drops through the rim plane inside the ring.
  if (!b.scored && b.prevZ >= RIM.z && b.z < RIM.z && Math.hypot(b.u - RIM.u, b.v - RIM.v) < RIM_R - RIM_TUBE) {
    b.scored = true;
    scoreBasket(b);
  }
  // The net slows the ball and steers it down.
  if (b.scored && b.z > RIM.z - 0.6 && b.z < RIM.z) {
    const k = Math.exp(-7 * dt);
    b.vu = b.vu * k + (RIM.u - b.u) * 4 * dt;
    b.vv = b.vv * k + (RIM.v - b.v) * 4 * dt;
    b.vz = Math.max(b.vz, -3);
  }

  // Floor (only inside the room; past the front edges the ball drops away).
  const onCourt = b.u < ROOM_U && b.v < ROOM_V;
  if (onCourt && b.z < BALL_R) {
    b.z = BALL_R;
    if (b.vz < 0) {
      if (b.vz < -1) sound.bounce(-b.vz);
      b.squash = Math.min(1, -b.vz / 7);
      b.vz = -b.vz * 0.72;
      if (b.vz < 0.5) b.vz = 0;
      b.vu *= 0.86;
      b.vv *= 0.86;
      b.bounces++;
    }
    if (b.vz === 0) {
      const roll = Math.exp(-1.5 * dt);
      b.vu *= roll;
      b.vv *= roll;
    }
  }
  // Walls.
  if (b.v < BALL_R && b.z > 0) {
    b.v = BALL_R;
    if (b.vv < 0) b.vv = -b.vv * 0.6;
  }
  if (b.u < BALL_R && b.z > 0) {
    b.u = BALL_R;
    if (b.vu < 0) b.vu = -b.vu * 0.6;
  }
}

function collideRim(b) {
  const du = b.u - RIM.u;
  const dv = b.v - RIM.v;
  const d = Math.hypot(du, dv);
  if (d < 1e-6) return;
  // Closest point on the rim circle.
  const qu = RIM.u + (du / d) * RIM_R;
  const qv = RIM.v + (dv / d) * RIM_R;
  let nu = b.u - qu;
  let nv = b.v - qv;
  let nz = b.z - RIM.z;
  const dist = Math.hypot(nu, nv, nz);
  const min = BALL_R + RIM_TUBE;
  if (dist >= min || dist < 1e-6) return;
  nu /= dist;
  nv /= dist;
  nz /= dist;
  b.u = qu + nu * min;
  b.v = qv + nv * min;
  b.z = RIM.z + nz * min;
  const vn = b.vu * nu + b.vv * nv + b.vz * nz;
  if (vn < 0) {
    const restitution = 0.55;
    const friction = 0.9;
    const tu = b.vu - vn * nu;
    const tv = b.vv - vn * nv;
    const tz = b.vz - vn * nz;
    b.vu = tu * friction - vn * restitution * nu;
    b.vv = tv * friction - vn * restitution * nv;
    b.vz = tz * friction - vn * restitution * nz;
    if (-vn > 0.4) sound.rim(-vn);
    if (-vn > 1.5) {
      const p = project(qu, qv, RIM.z);
      const floor = project(qu, qv, 0);
      pixelFx.spark(p.x, p.y, { floorDrop: floor.y - p.y, flip: nu - nv < 0 });
      state.shake = Math.max(state.shake, Math.min(1, (-vn - 1.5) / 4));
    }
    b.touchedRim = true;
  }
}

function collideBoard(b) {
  if (b.u < BOARD.u0 - BALL_R * 0.5 || b.u > BOARD.u1 + BALL_R * 0.5) return;
  if (b.z < BOARD.z0 - BALL_R * 0.5 || b.z > BOARD.z1 + BALL_R * 0.5) return;
  if (b.v - BALL_R < BOARD.v && b.v > BOARD.v - 0.3) {
    b.v = BOARD.v + BALL_R;
    if (b.vv < 0) {
      if (b.vv < -1) sound.board(-b.vv);
      if (b.vv < -3) state.shake = Math.max(state.shake, Math.min(0.6, (-b.vv - 3) / 6));
      b.vv = -b.vv * 0.72;
      b.vu *= 0.9;
      b.vz *= 0.9;
      b.touchedBoard = true;
    }
  }
}

function scoreBasket(b) {
  if (state.phase !== "playing" && state.phase !== "ending") return;
  if (survival() && state.phase === "ending") return; // already missed: a ball still in the air doesn't count
  if (around()) return aroundBasket(b);
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
  const run = survival() && runCall(state.streak);
  if (run) {
    // A sudden death milestone that also lights a new fire (10 in a row: supernova) gets both.
    if (levelUp >= 0) sound.fireIgnite(levelUp);
    return celebrateRun(run, p, levelUp >= 0 ? fire : null);
  }
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

// Around the world: a make moves them on to the next spot; the last one finishes it.
function aroundBasket(b) {
  if (state.phase !== "playing") return;
  if (b.log) b.log[2] = 1;
  state.streak++;
  state.coldStreak = 0;
  state.aroundAt++;
  if (state.aroundAt >= AROUND_SPOT_COUNT) state.stats.aroundTime = state.elapsed;
  recordMake(b);
  updateHud();
  sound.swish();
  const p = project(RIM.u, RIM.v, RIM.z);
  const swish = !b.touchedRim && !b.touchedBoard;
  if (swish) pixelFx.swish(p.x, p.y, "cyan");
  if (state.aroundAt >= AROUND_SPOT_COUNT) {
    state.aroundTime = state.elapsed;
    state.phase = "ending";
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
    announce(state.aroundAt === AROUND_SPOT_COUNT - 1 ? "aroundLast" : swish ? "swish" : "make", "#ffffff");
  }
}

// ---------- Daily challenge ----------

// What happened in this game, for the daily challenge (daily.js).
function newStats() {
  return { makes: 0, threes: 0, threeRun: 0, bestThreeRun: 0, swishRun: 0, bestSwishRun: 0, banks: 0, fires: 0, bestStreak: 0, money: 0, rainbow: 0, score: 0, aroundTime: 0, buzzerBeater: false };
}

function recordMake(b) {
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

function recordMiss() {
  state.stats.threeRun = 0;
  state.stats.swishRun = 0;
}

// Done the daily challenge in this game? Celebrate (once a day).
function checkDaily() {
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

// The daily challenge line on the game select and game-over screens.
function showDaily() {
  const challenge = todaysChallenge();
  const days = streakDays();
  const inARow = days > 1 ? ` ${days} days in a row!` : "";
  $("mode-daily").textContent = doneToday() ? `Today's challenge done!${inARow}` : `Today's challenge: ${challenge.text}`;
  let over;
  if (state.dailyDone) over = `Daily challenge complete!${inARow}`;
  else if (doneToday()) over = `Daily challenge done for today.${inARow}`;
  else if (state.stats && countsIn(challenge, state.mode)) over = `Daily challenge: ${challenge.text} (${progress(challenge, state.stats)} of ${challenge.goal})`;
  else over = `Daily challenge: ${challenge.text}`;
  $("over-daily").textContent = over;
}

function missedShot(b) {
  if (state.phase !== "playing" && state.phase !== "ending") return;
  if (survival() && state.phase === "ending") return;
  recordMiss();
  // Sudden death: the first miss ends it, once the reaction has played.
  if (survival()) {
    sound.gameOver();
    state.phase = "ending";
    if (player.anim === "gather" || player.anim === "jump") setAnim("dribble");
  }
  const wasOnFire = fireLevel() !== null;
  state.streak = 0;
  state.coldStreak++;
  if (!b.touchedRim && !b.touchedBoard) sound.groan();
  else if (b.touchedRim) sound.ooh();
  if (wasOnFire) announce("fireOut", "#a0e7ff");
  else if (!b.touchedRim && !b.touchedBoard) announce("airball", "#c8b6ff");
  else if (state.coldStreak >= 3 && state.coldStreak % 3 === 0) announce("cold", "#a0e7ff");
  else if (Math.random() < 0.7) announce("miss", "#c8b6ff");
}

// A shot is decided once it has gone in or clearly missed.
function checkDecided(b) {
  if (b.decided) return;
  const missed = b.bounces > 0 || (b.vz < 0 && b.z < RIM.z - 0.6) || b.age > 3;
  if (b.scored || missed) {
    b.decided = true;
    if (!b.scored) missedShot(b);
  }
}

// ---------- Update ----------

function frameCount(anim) {
  return sprites.frames[anim].length;
}

function updatePlayer(dt) {
  player.t += dt;

  if (player.moving) {
    player.fade -= dt * 6;
    if (player.fade <= 0) {
      const spot = pickSpot();
      player.u = spot.u;
      player.v = spot.v;
      player.moving = false;
      player.fade = 0;
      // Already facing the hoop after the first shot: straight to dribbling (or jumping, if held).
      setAnim(state.pressed ? "gather" : "dribble");
      if (isThreePointSpot(spot.u, spot.v)) {
        const p = project(spot.u, spot.v);
        addPopup("3PT SPOT", "#ffffff", p.x, p.y - 500);
      }
      // A bonus ball coming up: say so.
      const badge = BALL_BADGES[nextBallKind()];
      if (badge) {
        announce(badge.call, badge.color);
        sound.cheer(1.2);
      }
    }
    return;
  }
  if (player.fade < 1) player.fade = Math.min(1, player.fade + dt * 6);

  switch (player.anim) {
    case "turn":
      if (player.t >= frameCount("turn") / ANIM_FPS.turn) setAnim(state.pressed ? "gather" : "dribble");
      break;
    case "gather":
      if (player.t >= frameCount("gather") / ANIM_FPS.gather) {
        setAnim("jump");
        sound.squeak();
      }
      break;
    case "dribble": {
      // Bounce sound when the ball hits the floor (the first frame of the loop).
      const frame = Math.floor(player.t * ANIM_FPS.dribble) % frameCount("dribble");
      if (frame === 0 && player.lastDribbleFrame !== 0) sound.dribble();
      player.lastDribbleFrame = frame;
      break;
    }
    case "jump":
      if (player.t >= frameCount("jump") * JUMP_FRAME_TIME) shoot(2.5);
      break;
    case "release": {
      const done = player.t >= frameCount("release") / ANIM_FPS.release;
      const ball = player.activeBall;
      if (done && (!ball || ball.decided) && state.phase === "playing") {
        player.activeBall = null;
        player.moving = true;
      }
      break;
    }
  }
}

function update(dt) {
  if (state.phase === "playing" && around()) {
    // Against the clock, counting up. The music builds as they get around.
    const before = Math.floor(state.elapsed);
    state.elapsed += dt;
    if (Math.floor(state.elapsed) !== before) updateHud();
    const fire = fireLevel();
    sound.setIntensity({ stage: state.aroundAt < 3 ? 0 : state.aroundAt < 5 ? 1 : 2, fire: fire ? FIRE_LEVELS.indexOf(fire) + 1 : 0, final: state.aroundAt === AROUND_SPOT_COUNT - 1 });
  } else if (state.phase === "playing" && survival()) {
    // No clock. The music builds with the run instead.
    state.elapsed += dt;
    const fire = fireLevel();
    sound.setIntensity({ stage: state.streak < 5 ? 0 : state.streak < 12 ? 1 : 2, fire: fire ? FIRE_LEVELS.indexOf(fire) + 1 : 0, final: false });
  } else if (state.phase === "playing") {
    state.elapsed += dt;
    const before = Math.ceil(state.timeLeft);
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    const after = Math.ceil(state.timeLeft);
    if (after !== before) {
      if (after <= 5 && after > 0) sound.tick();
      updateHud();
    }
    // The music builds as time runs down, and gets a lead line while he's on fire.
    const fire = fireLevel();
    sound.setIntensity({
      stage: state.timeLeft > 40 ? 0 : state.timeLeft > 20 ? 1 : 2,
      fire: fire ? FIRE_LEVELS.indexOf(fire) + 1 : 0,
      final: state.timeLeft <= 10,
    });
    if (state.timeLeft <= 0) {
      sound.gameOver();
      state.phase = "ending";
      for (const b of state.balls) if (!b.decided) b.atBuzzer = true;
      // A shot already in the air still counts.
      if (player.anim === "gather" || player.anim === "jump") setAnim("dribble");
    }
  } else if (state.phase === "ending") {
    // Let the last shot's reaction play out before the game-over screen.
    if (state.balls.every((b) => b.decided)) {
      const now = performance.now() / 1000;
      if (!state.endAt) state.endAt = now + (state.buzzerBeater ? BUZZER_CELEBRATION : 1.2);
      if (now >= state.endAt) endGame();
    }
  }

  updatePlayer(dt);

  for (const b of state.balls) checkDecided(b);
  state.balls = state.balls.filter((b) => {
    const keep = b.age < 5 && b.z > -4;
    if (!keep) b.trail?.stop();
    return keep;
  });

  for (const p of state.popups) p.age += dt;
  state.popups = state.popups.filter((p) => p.age < 1.2);

  if (state.banner) {
    state.banner.age += dt;
    if (state.banner.age > state.banner.duration) state.banner = null;
  }

  // Flame trail (and crackle) behind balls shot while on fire: a pixel comet pointed along the ball's flight.
  for (const b of state.balls) {
    if (!b.trail) continue;
    if (b.age > 2.5) {
      b.trail.stop();
      continue;
    }
    if (b.age < 1.5 && Math.random() < dt * 30) sound.crackle();
    const p = project(b.u, b.v, b.z);
    b.trail.move(p.x, p.y);
  }

  // Flames round the player's shoes while they're on fire (hidden while they fade to a new spot).
  const fire = state.phase === "playing" || state.phase === "ending" ? fireLevel() : null;
  if (state.shoeFire && state.shoeFire.level !== fire) {
    state.shoeFire.stop();
    state.shoeFire = null;
  }
  if (fire && !state.shoeFire) {
    state.shoeFire = pixelFx.shoeFire(shoePoints(), fire.fx.palette);
    state.shoeFire.level = fire;
  }
  if (state.shoeFire) {
    state.shoeFire.moveFeet(shoePoints());
    state.shoeFire.hidden = player.fade < 0.6;
  }
  state.shake = Math.max(0, state.shake - dt * 4);
  for (const b of state.balls) if (b.squash) b.squash = Math.max(0, b.squash - dt * 8);
}

let accumulator = 0;
function stepPhysics(dt) {
  accumulator += dt;
  while (accumulator >= PHYSICS_STEP) {
    for (const b of state.balls) stepBall(b, PHYSICS_STEP);
    accumulator -= PHYSICS_STEP;
  }
}

// ---------- Rendering ----------

function resize() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.min(COURT_PX, Math.round(rect.width * dpr));
  if (canvas.width !== size) {
    canvas.width = canvas.height = size;
  }
}

// Where the shoes are in each frame of a sprite sheet: for every frame, two [x, y] points (sprite pixels from the
// frame's corner) at the bottom middle of each shoe. Builder players have a colour map marking their shoe pixels
// (region 5), which is exact whatever colour the shoes are. Hand-made players don't, so their shoes are found by
// the lowest pixels in each column of the bottom of the frame, skipping warm colours so the ball and skin aren't
// mistaken for shoes. Cached per sheet.
const SHOES = 5;
const feetCache = new WeakMap();
function shoesIn(sheet, meta, regions) {
  if (feetCache.has(sheet)) return feetCache.get(sheet);
  const c = document.createElement("canvas");
  c.width = sheet.width;
  c.height = sheet.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(sheet, 0, 0);
  const result = {};
  for (const [anim, frames] of Object.entries(meta.frames)) {
    result[anim] = frames.map(([sx, sy, w, h]) => {
      const px = g.getImageData(sx, sy, w, h).data;
      const isShoe = regions
        ? (x, y) => regions.data[((sy + y) * regions.width + sx + x) * 4] === SHOES
        : (x, y) => {
            const i = (y * w + x) * 4;
            const [r, gg, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
            return a >= 128 && !(r - b > 40 && r >= gg); // skip warm colours: ball, skin
          };
      const bottom = new Array(w).fill(-1);
      for (let x = 0; x < w; x++) {
        for (let y = h - 1; y >= h * 0.6; y--) {
          if (!isShoe(x, y)) continue;
          bottom[x] = y;
          break;
        }
      }
      // runs of columns that reach the bottom fifth of the frame
      const runs = [];
      for (let x = 0; x < w; x++) {
        if (bottom[x] < (regions ? 0 : h * 0.8)) continue;
        const run = runs.at(-1);
        if (run && x - run.x1 <= 2) run.x1 = x;
        else runs.push({ x0: x, x1: x });
      }
      let feet = runs.filter((r) => r.x1 - r.x0 >= 3).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0)).slice(0, 2);
      if (feet.length === 1) {
        const { x0, x1 } = feet[0], m = (x0 + x1) >> 1;
        feet = [{ x0, x1: m }, { x0: m + 1, x1 }];
      }
      if (!feet.length) return [[w * 0.35, h], [w * 0.65, h]];
      return feet
        .map(({ x0, x1 }) => [(x0 + x1) / 2, Math.max(...bottom.slice(x0, x1 + 1))])
        .sort((a, b) => a[0] - b[0]);
    });
  }
  feetCache.set(sheet, result);
  return result;
}

// The player's shoes right now, in court pixels.
function shoePoints() {
  const [, , , , ox, oy] = currentFrame();
  const scale = 1 / sprites.res;
  const p = project(player.u, player.v);
  const frames = sprites.frames[player.anim];
  const i = frames.indexOf(currentFrame());
  const feet = shoesIn(atlas, sprites, shoeRegions)[player.anim][i];
  return feet.map(([x, y]) => [p.x + (ox + x) * scale, p.y + (oy + y) * scale]);
}

function currentFrame() {
  const frames = sprites.frames[player.anim];
  let i;
  if (player.anim === "jump") i = Math.floor(player.t / JUMP_FRAME_TIME);
  else if (player.anim === "idle" || player.anim === "dribble") i = Math.floor(player.t * ANIM_FPS[player.anim]) % frames.length;
  else i = Math.floor(player.t * ANIM_FPS[player.anim]);
  return frames[Math.min(i, frames.length - 1)];
}

function drawShadow(u, v, rx, ry, alpha) {
  const p = project(u, v);
  ctx.fillStyle = `rgba(45, 20, 35, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer() {
  const [sx, sy, w, h, ox, oy] = currentFrame();
  const scale = 1 / sprites.res;
  const p = project(player.u, player.v);
  ctx.globalAlpha = Math.max(0, player.fade);
  ctx.drawImage(atlas, sx, sy, w, h, p.x + ox * scale, p.y + oy * scale, w * scale, h * scale);
  ctx.globalAlpha = 1;
}

function drawBall(b) {
  const p = project(b.u, b.v, b.z);
  const size = BALL_R * PX_PER_M * 2.6;
  const fade = b.age > 4.5 ? Math.max(0, (5 - b.age) / 0.5) : 1;
  const turns = (((-b.spin / Math.PI) % 1) + 1) % 1;
  const sprite = ballSprites[b.kind ?? NORMAL][Math.floor(turns * BALL_FRAMES) % BALL_FRAMES];
  // squashed flat for a moment after a floor bounce, sitting on the floor
  const sq = (b.squash ?? 0) * 0.35;
  const w = size * (1 + sq), h = size * (1 - sq);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite, p.x - w / 2, p.y + size / 2 - h, w, h);
  ctx.restore();
}

function drawMeter() {
  if (player.anim !== "gather" && player.anim !== "jump") return;
  const p = project(player.u, player.v);
  const x = p.x + 110;
  const top = p.y - 400;
  const height = 260;
  const total = frameCount("jump") * JUMP_FRAME_TIME;
  const t = player.anim === "jump" ? player.t : 0;
  const fill = Math.min(1, t / total);

  ctx.fillStyle = "rgba(43, 22, 34, 0.85)";
  ctx.fillRect(x - 6, top - 6, 36, height + 12);
  const zoneTop = top + height * (1 - (JUMP_APEX + timingWindow() * 0.5) / total);
  const zoneH = (height * timingWindow()) / total;
  ctx.fillStyle = fireLevel()?.color ?? "#3ddc84";
  ctx.fillRect(x, zoneTop, 24, zoneH);
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 6, top + height * (1 - fill) - 4, 36, 8);
}

function drawConfetti() {
  for (const c of state.confetti) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
    ctx.restore();
  }
}

function drawBanner() {
  const b = state.banner;
  if (!b) return;
  const pop = b.age < 0.12 ? 0.6 + (b.age / 0.12) * 0.55 : b.age < 0.22 ? 1.15 - ((b.age - 0.12) / 0.1) * 0.15 : 1;
  const fade = Math.min(1, (b.duration - b.age) / 0.3);
  ctx.save();
  ctx.font = '64px "Press Start 2P", monospace';
  const width = ctx.measureText(b.text).width;
  const fit = Math.min(b.big ? 1.6 : 1, 1800 / width);
  ctx.translate(COURT_PX / 2, 120);
  ctx.scale(pop * fit, pop * fit);
  ctx.globalAlpha = fade;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#2b1622";
  ctx.strokeText(b.text, 0, 0);
  ctx.fillStyle = b.color;
  ctx.fillText(b.text, 0, 0);
  ctx.restore();
}

// The very first shot: what to do next, in a bubble over the player. Never shown again after that.
const hints = { learned: load("orson-hoops-learned", false) };
// Around the world: the seven spots on the floor, numbered, with the one they're on lit up.
function drawAroundSpots() {
  if (!around() || state.phase === "title") return;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
  getAroundSpots().forEach((spot, i) => {
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

// Above the player while the ball in his hands is a bonus ball.
function drawBallBadge() {
  const badge = BALL_BADGES[nextBallKind()];
  if (!badge || player.moving || player.fade < 0.6) return;
  const p = project(player.u, player.v);
  const pulse = 1 + 0.08 * Math.sin(performance.now() / 120);
  ctx.save();
  ctx.translate(p.x, p.y - 470);
  ctx.scale(pulse, pulse);
  ctx.font = '26px "Press Start 2P", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#2b1622";
  ctx.strokeText(badge.text, 0, 0);
  ctx.fillStyle = badge.color;
  ctx.fillText(badge.text, 0, 0);
  ctx.restore();
}

function drawHint() {
  if (hints.learned || state.phase !== "playing" || player.moving || player.fade < 1) return;
  const text =
    player.anim === "idle" ? howTo("Tap to face the hoop", "Press Space to face the hoop", "Tap or press Space to face the hoop")
    : player.anim === "turn" || player.anim === "dribble" ? howTo("Hold to jump", "Hold Space to jump", "Hold (or hold Space) to jump")
    : player.anim === "gather" || player.anim === "jump" ? "Let go at the top!"
    : "";
  if (!text) return;
  const p = project(player.u, player.v);
  ctx.save();
  ctx.font = '34px "Press Start 2P", monospace';
  const w = ctx.measureText(text).width + 56;
  const x = Math.max(w / 2 + 20, Math.min(COURT_PX - w / 2 - 20, p.x));
  const y = p.y - 520;
  const blink = 0.85 + 0.15 * Math.sin(performance.now() / 180);
  ctx.globalAlpha = blink;
  ctx.fillStyle = "rgba(43, 22, 34, 0.9)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 40, w, 80, 14);
  ctx.moveTo(p.x - 18, y + 40);
  ctx.lineTo(p.x, y + 66);
  ctx.lineTo(p.x + 18, y + 40);
  ctx.fill();
  ctx.fillStyle = "#ffe066";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 3);
  ctx.restore();
}

function drawPopups() {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '48px "Press Start 2P", monospace';
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#2b1622";
  for (const p of state.popups) {
    const y = p.y - p.age * 80;
    ctx.globalAlpha = Math.min(1, (1.2 - p.age) * 3);
    ctx.strokeText(p.text, p.x, y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, y);
  }
  ctx.globalAlpha = 1;
}

function drawDebug() {
  ctx.strokeStyle = "lime";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const p = project(RIM.u + Math.cos(a) * RIM_R, RIM.v + Math.sin(a) * RIM_R, RIM.z);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  }
  ctx.stroke();
  const corners = [
    [BOARD.u0, BOARD.z0], [BOARD.u1, BOARD.z0], [BOARD.u1, BOARD.z1], [BOARD.u0, BOARD.z1], [BOARD.u0, BOARD.z0],
  ];
  ctx.strokeStyle = "cyan";
  ctx.beginPath();
  corners.forEach(([u, z], i) => {
    const p = project(u, BOARD.v, z);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.strokeStyle = "yellow";
  ctx.beginPath();
  for (let i = 0; i <= 36; i++) {
    const a = (i / 36) * Math.PI;
    const r = threePointRadius(RIM.u + Math.cos(a), RIM.v + Math.sin(a));
    const p = project(RIM.u + Math.cos(a) * r, RIM.v + Math.sin(a) * r);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  }
  ctx.stroke();
  const room = [[0, 0], [ROOM_U, 0], [ROOM_U, ROOM_V], [0, ROOM_V], [0, 0]];
  ctx.strokeStyle = "red";
  ctx.beginPath();
  room.forEach(([u, v], i) => {
    const p = project(u, v);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  });
  ctx.stroke();
}

// ---------- Wall scoreboard ----------

const SEGMENTS = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];
const scoreboard = document.createElement("canvas");
scoreboard.width = BOARD_ART.area.w;
scoreboard.height = BOARD_ART.area.h;
let scoreboardDirty = true;

function drawDigit(g, digit, x, y, w, h, t) {
  const half = h / 2;
  const rects = {
    a: [x + t, y, w - 2 * t, t],
    b: [x + w - t, y + t, t, half - 1.5 * t],
    c: [x + w - t, y + half + t / 2, t, half - 1.5 * t],
    d: [x + t, y + h - t, w - 2 * t, t],
    e: [x, y + half + t / 2, t, half - 1.5 * t],
    f: [x, y + t, t, half - 1.5 * t],
    g: [x + t, y + half - t / 2, w - 2 * t, t],
  };
  for (const [seg, r] of Object.entries(rects)) {
    g.fillStyle = SEGMENTS[digit].includes(seg) ? BOARD_ART.lit : BOARD_ART.unlit;
    g.fillRect(...r);
  }
}

function drawPanel(g, panel, value) {
  const [cx, cy, cw, ch] = panel.cover;
  g.fillStyle = BOARD_ART.face;
  g.fillRect(cx, cy, cw, ch);
  g.fillStyle = BOARD_ART.label;
  g.fillText(panel.label, ...panel.labelAt);

  const [wx, wy, ww, wh] = panel.window;
  g.fillStyle = BOARD_ART.window;
  g.fillRect(wx, wy, ww, wh);
  const digits = String(Math.min(999, value)).padStart(2, "0").split("").map(Number);
  const gap = digits.length > 2 ? 5 : 8;
  const w = digits.length > 2 ? 20 : 28;
  const h = 50;
  const total = digits.length * w + (digits.length - 1) * gap;
  digits.forEach((d, i) => drawDigit(g, d, wx + (ww - total) / 2 + i * (w + gap), wy + (wh - h) / 2, w, h, 6));
}

function renderScoreboard() {
  const g = scoreboard.getContext("2d");
  const { origin, slope, area } = BOARD_ART;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, area.w, area.h);
  g.setTransform(1, slope, 0, 1, origin.x - area.x, origin.y - area.y);
  g.font = '16px "Press Start 2P", monospace';
  g.textAlign = "center";
  g.textBaseline = "middle";
  // Around the world: which spot they're on, out of seven.
  if (around()) drawPanel(g, { ...BOARD_ART.left, label: "SPOT" }, Math.min(state.aroundAt + 1, AROUND_SPOT_COUNT));
  else drawPanel(g, BOARD_ART.left, state.score);
  // Sudden death has no clock: the right side counts makes instead.
  if (survival()) drawPanel(g, { ...BOARD_ART.right, label: "MADE" }, made());
  else if (around()) drawPanel(g, BOARD_ART.right, Math.floor(state.elapsed));
  else drawPanel(g, BOARD_ART.right, Math.ceil(state.timeLeft));
  scoreboardDirty = false;
}

function render() {
  const k = canvas.width / COURT_PX;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, COURT_PX, COURT_PX);
  if (state.shake > 0) {
    const amp = state.shake * state.shake * 14;
    ctx.translate(Math.round((Math.random() - 0.5) * amp), Math.round((Math.random() - 0.5) * amp));
  }
  // A long sudden death run: the whole court rumbles, more the longer it goes.
  const rumble = SUDDEN_DEATH.rumble * pressure(SUDDEN_DEATH.rumbleFrom);
  if (rumble > 0) {
    const t = performance.now() / 1000;
    ctx.translate(Math.round((Math.sin(t * 7.3) + 0.5 * Math.sin(t * 17.1)) * rumble * 0.7), Math.round((Math.cos(t * 9.7) + 0.4 * Math.sin(t * 23.3)) * rumble * 0.5));
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (scoreboardDirty) renderScoreboard();
  ctx.drawImage(scoreboard, BOARD_ART.area.x, BOARD_ART.area.y);

  drawAroundSpots();

  // Floor shadows first.
  drawShadow(player.u, player.v, 70, 26, 0.35 * Math.max(0, player.fade));
  for (const b of state.balls) {
    if (b.u > ROOM_U || b.v > ROOM_V) continue;
    const lift = Math.max(0, b.z);
    drawShadow(b.u, b.v, 30 / (1 + lift * 0.15), 12 / (1 + lift * 0.15), 0.3 / (1 + lift * 0.3));
  }

  pixelFx.draw(ctx, "under"); // fire trails behind the balls, floor flames behind the player

  // Back to front by isometric depth (u + v).
  const items = [{ depth: player.u + player.v, draw: drawPlayer }];
  items.push({ depth: RIM.u + RIM.v + RIM_R * 0.7, draw: () => ctx.drawImage(hoopFront, HOOP_FRONT_AT.x, HOOP_FRONT_AT.y) });
  for (const b of state.balls) items.push({ depth: b.u + b.v, draw: () => drawBall(b) });
  items.sort((a, b) => a.depth - b.depth);
  for (const item of items) item.draw();

  drawMeter();
  drawBallBadge();
  drawHint();
  drawPopups();
  drawConfetti();
  pixelFx.draw(ctx, "over");
  drawBanner();
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${state.flash * 0.6})`;
    ctx.fillRect(0, 0, COURT_PX, COURT_PX);
  }
  if (DEBUG) drawDebug();
}

let last = performance.now();
// Slow motion while a shot released before the buzzer drops toward the hoop.
function updateSlowMo(dt) {
  const dropping = state.phase === "ending" && state.balls.some(
    (b) => b.atBuzzer && !b.decided && b.vz < 0 && b.z < RIM.z + 1.8 && Math.hypot(b.u - RIM.u, b.v - RIM.v) < 1.6,
  );
  if (dropping && state.timeScale === 1) sound.ooh();
  const target = dropping ? SLOW_MO : 1;
  state.timeScale += (target - state.timeScale) * Math.min(1, dt * 8);
  if (Math.abs(target - state.timeScale) < 0.01) state.timeScale = target;
}

function updateCelebration(dt) {
  state.flash = Math.max(0, state.flash - dt * 2.5);
  pixelFx.update(dt);
  for (const c of state.confetti) {
    c.vy += 300 * dt;
    c.vx *= 1 - dt;
    c.x += c.vx * dt + Math.sin(c.y / 60) * 40 * dt;
    c.y += c.vy * dt;
    c.rot += c.spin * dt;
  }
  state.confetti = state.confetti.filter((c) => c.y < COURT_PX + 50);
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateSlowMo(dt);
  stepPhysics(dt * state.timeScale);
  update(dt * state.timeScale);
  updateCelebration(dt);
  render();
  requestAnimationFrame(frame);
}

// ---------- Boot ----------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function boot() {
  loadVoiceClips();
  try {
    const list = await fetch("assets/characters/index.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (list?.length) characters.list = list;
    await loadBuiltPlayers();
    if (!characters.list.some((c) => c.id === characters.selected)) characters.selected = characters.list[0].id;
    const [hoopImg] = await Promise.all([
      loadImage("assets/hoop-front.webp"),
      selectCharacter(characters.selected),
      document.fonts?.load('48px "Press Start 2P"').catch(() => {}),
    ]);
    hoopFront = hoopImg;
    ballSprites = makeBallSprites();
  } catch (err) {
    tapToPlay.textContent = "Oops! The game could not load. Try refreshing the page.";
    console.error(err);
    return;
  }
  if (DEBUG) window.game = { state, player, shoot, stepBall, checkDecided, pickSpot, isThreePointSpot, project, RIM, sound, selectCharacter, pixelFx, celebrateBuzzerBeater, SUDDEN_DEATH };
  resize();
  new ResizeObserver(resize).observe(stage);
  state.mode = load("orson-hoops-mode", "timed");
  showTitle();
  if (location.hash === "#leaderboard") openBoard("week");
  updateHud();
  requestAnimationFrame((now) => {
    last = now;
    frame(now);
  });
}

boot();
