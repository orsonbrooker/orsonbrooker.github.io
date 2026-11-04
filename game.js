// Orson's shootaround: a 60 second isometric basketball game.
//
// The ball is simulated in 3D court space (metres) and projected onto the
// isometric court art. Screen units are "court pixels": the 2048px court image.

import { loadVoiceClips, sound } from "./audio.js?v=b614856c";
import { createFxLayer } from "./fx.js?v=1b9ca74d";
import { pickPhrase } from "./phrases.js?v=e5110e70";
import { confirmDialog } from "./ui/confirm.js?v=a65ef360";
import { fillIcons, icon } from "./ui/icons.js?v=c284e3ca";
import { DEFAULT_TEAM, loadBase, loadBases, myPlayers, recolor, removeMyPlayer, thumbnail } from "./players/recolor.js?v=72f03939";

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
const PHYSICS_STEP = 1 / 240;
const LAUNCH_ANGLE = (52 * Math.PI) / 180;

// Jump timing (seconds since leaving the ground). Releasing at the apex is a perfect shot.
const JUMP_FRAME_TIME = 0.085;
const JUMP_APEX = 0.29;
const TIMING_WINDOW = 0.13;

// Like NBA Jam: two makes in a row heats him up, three puts him on fire until he misses,
// and keeping it going turns the flames purple. Add a level here to go even further.
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
const screens = { title: $("title-screen"), select: $("select-screen"), over: $("over-screen"), help: $("help-screen") };
const tapToPlay = $("tap-to-play");
const playerChip = $("player-chip");
const helpButton = $("help-button");
// Keyboards say "press Space"; touch screens say "tap".
const HAS_KEYS = matchMedia("(hover: hover) and (pointer: fine)").matches;
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
for (const btn of [muteBtn, musicBtn, helpButton]) btn.addEventListener("pointerdown", (e) => e.stopPropagation());
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

function makeBallSprite(turn) {
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
      let color = x + y > 19 ? "#b5501d" : "#de6d2b";
      if (Math.hypot(x - 5, y - 4.5) < 2) color = "#f39a55";
      // the seams, in the ball's own turned frame
      const rx = mid + (x - mid) * cos + (y - mid) * sin;
      const ry = mid - (x - mid) * sin + (y - mid) * cos;
      const seam =
        Math.abs(rx - mid) < 0.6 ||
        Math.abs(ry - mid) < 0.6 ||
        Math.abs(Math.hypot(rx + 4, ry - mid) - 9.5) < 0.6 ||
        Math.abs(Math.hypot(rx - 19, ry - mid) - 9.5) < 0.6;
      if (seam) color = "#5b2a12";
      if (d > 6.7) color = "#3a1a10";
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function makeBallSprites() {
  return Array.from({ length: BALL_FRAMES }, (_, i) => makeBallSprite((i / BALL_FRAMES) * Math.PI));
}

// ---------- Game state ----------

const state = {
  phase: "loading", // loading | title | playing | ending | over
  score: 0,
  best: load("orson-hoops-best", 0),
  timeLeft: GAME_SECONDS,
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

let sprites, atlas, hoopFront, ballSprites;

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
// Anyone who picked a player before the select screen existed already has one saved.
const pickedBefore = load("orson-hoops-character", null) !== null;

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
  const { meta, img } = await loadCharacter(id);
  sprites = meta;
  atlas = img;
  characters.selected = id;
  save("orson-hoops-character", id);
  renderChip();
  if (state.phase === "select") renderPicker();
}

// A player's face for the picker and the title screen's chip.
function setFace(img, c) {
  img.src = c.thumb;
  if (c.base) {
    // Builder players: show their own colours once their base body has loaded.
    loadBuilt(c)
      .then(({ loaded }) => (img.src = thumbnail(loaded, c.colours).toDataURL()))
      .catch(() => {});
  }
}

function renderChip() {
  const c = characters.list.find((p) => p.id === characters.selected);
  if (!c) return;
  setFace($("chip-face"), c);
  $("chip-name").textContent = c.name;
  playerChip.hidden = false;
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

// Picks a spot around the hoop: about a third are behind the 3-point line.
function pickSpot() {
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

function startGame() {
  state.phase = "playing";
  state.score = 0;
  state.timeLeft = GAME_SECONDS;
  state.balls = [];
  state.popups = [];
  state.confetti = [];
  pixelFx.clear();
  state.shoeFire = null;
  state.flash = 0;
  state.timeScale = 1;
  state.endAt = 0;
  state.buzzerBeater = false;
  state.streak = 0;
  state.coldStreak = 0;
  player.u = DEFAULT_SPOT.u;
  player.v = DEFAULT_SPOT.v;
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
  const isBest = state.score > state.best;
  if (isBest) {
    state.best = state.score;
    save("orson-hoops-best", state.best);
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
  $("over-title").textContent = isBest && state.score > 0 ? "New high score!" : state.buzzerBeater ? "Buzzer beater!" : "Time's up!";
  $("final-score").textContent = state.score;
  $("over-detail").textContent = (state.buzzerBeater ? "Won it at the buzzer! " : "") + `Best: ${state.best}`;
  showScreen("over");
}

// One screen over the court at a time (or none while playing). Help sits on top of the others.
function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  stage.dataset.phase = state.phase;
}

function showTitle() {
  state.phase = "title";
  tapToPlay.textContent = HAS_KEYS ? "Press Space to play" : "Tap to play";
  $("title-best").textContent = state.best ? `Best: ${state.best}` : "";
  renderChip();
  showScreen("title");
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

function begin() {
  if (pickedBefore || load("orson-hoops-chosen", false)) startGame();
  else openSelect(true);
}

function updateHud() {
  scoreEl.textContent = state.score;
  timeEl.textContent = Math.ceil(state.timeLeft);
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

// Typing in a form (like the ideas box) shouldn't make Orson shoot.
const typing = (e) => e.target instanceof Element && e.target.closest("input, textarea, select, button, dialog");

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
    if (!screens.help.hidden) closeHelp();
    else if (state.phase === "select") showTitle();
    return;
  }
  if (e.code !== "Space" && e.key !== " ") return;
  if (typing(e)) return;
  e.preventDefault();
  if (!e.repeat) press();
});
window.addEventListener("keyup", (e) => {
  if (e.code !== "Space" && e.key !== " ") return;
  if (typing(e)) return;
  e.preventDefault();
  release();
});

// Taps on the screens' panels and buttons are theirs, not a shot. (The title screen lets taps through.)
for (const el of [...Object.values(screens).filter((el) => el !== screens.title), playerChip])
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
playerChip.addEventListener("click", () => openSelect());
$("select-back").addEventListener("click", showTitle);
$("again").addEventListener("click", () => {
  if (performance.now() - state.overAt > 900) startGame();
});
$("change-player").addEventListener("click", () => openSelect());
$("got-idea").addEventListener("click", () => window.dispatchEvent(new CustomEvent("feedback:open", { detail: { app: "basketball" } })));
helpButton.addEventListener("click", () => (screens.help.hidden ? openHelp() : closeHelp()));
$("help-close").addEventListener("click", closeHelp);
fillIcons(stage);

// The whole game area takes presses, not just the court: on a phone there's room below the
// court for a thumb to hold down without covering the player.
const pad = document.querySelector(".game-page") ?? stage;
// Things on the page that are tapped for their own sake, not to shoot.
const OWN_TAPS = "a, button, input, select, textarea, dialog, .panel-screen";

let activePointer = null;
pad.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
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
  return TIMING_WINDOW * (fireLevel()?.window ?? 1);
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
    prevZ: z,
  };
  state.balls.push(ball);
  if (ball.fire) {
    sound.fireWhoosh();
    const p = project(u, v, z);
    ball.trail = pixelFx.fireTrail(p.x, p.y, ball.fire.fx);
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
  for (let i = 0; i < 180; i++) {
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
  pixelFx.fireworks(COURT_PX);
  sound.buzzerBeater();
  announce("buzzer", "#ffd700", { big: true });
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
  const points = (b.three ? 3 : 2) + (b.fire?.bonus ?? 0);
  state.score += points;
  state.streak++;
  state.coldStreak = 0;
  updateHud();
  sound.swish();
  const p = project(RIM.u, RIM.v, RIM.z);
  addPopup(`+${points}`, b.fire?.color ?? "#ffe066", p.x, p.y - 60);

  const swish = !b.touchedRim && !b.touchedBoard;
  if (swish) pixelFx.swish(p.x, p.y, b.fire ? "gold" : "cyan");
  const levelUp = FIRE_LEVELS.findIndex((l) => l.streak === state.streak);
  const fire = fireLevel();
  if (state.phase === "ending") {
    celebrateBuzzerBeater();
    return;
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

function missedShot(b) {
  if (state.phase !== "playing" && state.phase !== "ending") return;
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
  if (state.phase === "playing") {
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
// frame's corner) at the bottom middle of each shoe. Found by looking at the lowest pixels in each column of the
// bottom of the frame, skipping warm colours so the ball and skin aren't mistaken for shoes. Cached per sheet.
const feetCache = new WeakMap();
function shoesIn(sheet, meta) {
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
      const bottom = new Array(w).fill(-1);
      for (let x = 0; x < w; x++) {
        for (let y = h - 1; y >= h * 0.6; y--) {
          const i = (y * w + x) * 4;
          const [r, gg, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
          if (a < 128) continue;
          if (r - b > 40 && r >= gg) continue; // warm: ball, skin
          bottom[x] = y;
          break;
        }
      }
      // runs of columns that reach the bottom fifth of the frame
      const runs = [];
      for (let x = 0; x < w; x++) {
        if (bottom[x] < h * 0.8) continue;
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
  const feet = shoesIn(atlas, sprites)[player.anim][i];
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
  const sprite = ballSprites[Math.floor(turns * BALL_FRAMES) % BALL_FRAMES];
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
function drawHint() {
  if (hints.learned || state.phase !== "playing" || player.moving || player.fade < 1) return;
  const text =
    player.anim === "idle" ? (HAS_KEYS ? "Press Space to face the hoop" : "Tap to face the hoop")
    : player.anim === "turn" || player.anim === "dribble" ? (HAS_KEYS ? "Hold Space to jump" : "Hold to jump")
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
  drawPanel(g, BOARD_ART.left, state.score);
  drawPanel(g, BOARD_ART.right, Math.ceil(state.timeLeft));
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (scoreboardDirty) renderScoreboard();
  ctx.drawImage(scoreboard, BOARD_ART.area.x, BOARD_ART.area.y);

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
  if (DEBUG) window.game = { state, player, shoot, stepBall, checkDecided, pickSpot, isThreePointSpot, project, RIM, sound, selectCharacter, pixelFx, celebrateBuzzerBeater };
  resize();
  new ResizeObserver(resize).observe(stage);
  showTitle();
  updateHud();
  requestAnimationFrame((now) => {
    last = now;
    frame(now);
  });
}

boot();
