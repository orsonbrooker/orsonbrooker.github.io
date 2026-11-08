// Orson's shootaround: an isometric basketball game (time attack, sudden death, around the world,
// free play).
// This file starts it up and wires the pieces together:
//   engine/   the court and its projection, ball physics, the frame loop, input, drawing helpers
//   play/     the game in progress: the shared state, players, shooting and the update, reactions, drawing the court
//   modes/    one file per way to play, all with the same shape (modes/index.js)
//   content/  tables: fire and ball looks, the around-the-world spots, the announcer's bigger calls
//   screens/  the title, choosing a game and a player, help, the leaderboard, game over
// Scoring rules shared with the server are in shared/rules.js.

import { loadSoundClips, loadVoiceClips, sound } from "./audio.js";
import { isThreePointSpot, project, RIM } from "./engine/court.js";
import { makeBallSprites } from "./engine/draw.js";
import { listenForInput } from "./engine/input.js";
import { startLoop } from "./engine/loop.js";
import { load } from "./engine/storage.js";
import { SUDDEN_DEATH } from "./modes/index.js";
import { setUpTouchControls } from "./play/controls.js";
import { characters, faceHoop, loadImage, loadRoster } from "./play/players.js";
import { celebrateBuzzerBeater, pixelFx, timingWindow } from "./play/react.js";
import { checkDecided, shoot, startGame, step, stepBall } from "./play/round.js";
import { art, render, resize, updateHud } from "./play/scene.js";
import { DEBUG, JUMP_APEX, mode, player, setAnim, setSeed, state, steer } from "./play/state.js";
import { $, charPick, screens, setUpSoundButtons, stage, tapToPlay } from "./screens/base.js";
import { openModes, openSelect, selectBack, selectCharacter, setMode, showTitle } from "./screens/menus.js";
import { setGameVersion } from "./screens/over.js";
import { closeBoard, closeHelp, openBoard, toggleBoard, toggleHelp, wireBoardTabs } from "./screens/panels.js";
import { fillIcons } from "./ui/icons.js";

// The version sent with scores: this file's own ?v= stamp (vite.config.js fills it in when built).
setGameVersion(new URL(import.meta.url).searchParams.get("v"));

setUpSoundButtons();

// ---------- The button ----------

function press() {
  if (state.pressed) return;
  state.pressed = true;
  sound.unlock();

  if (!screens.help.hidden) return;
  // Tapping to start: choose a game, then a player, then play.
  if (state.phase === "title") openModes();
  else if (state.phase === "over") {
    if (performance.now() - state.overAt < 900) return;
    startGame();
  }
  if (state.phase !== "playing" || player.moving) return;

  if (player.anim === "idle") {
    setAnim("turn");
    sound.squeak();
  } else if (player.anim === "dribble" || player.anim === "run") {
    // Free play: if he's on the move, he stops where he is and squares up to the hoop to shoot.
    player.steered = false;
    faceHoop();
    setAnim("gather");
  }
}

function release() {
  if (!state.pressed) return;
  state.pressed = false;
  if (player.anim === "gather") shoot(-2.5);
  else if (player.anim === "jump") shoot((player.t - JUMP_APEX) / timingWindow());
}

// ---------- Free play ----------

// Touch screens get a joystick and a shoot button in free play.
const resetTouchControls = setUpTouchControls({
  stage,
  press,
  release,
  setInput: (how) => {
    state.input = how;
  },
});

// Free play only ends when they leave (Escape, or the back button): back to choosing a game.
function leaveFreePlay() {
  if (state.phase !== "playing" || !mode().freeMove) return;
  resetTouchControls();
  state.pressed = false; // let go without shooting
  for (const b of state.balls) b.trail?.stop();
  state.balls = [];
  player.steered = false;
  faceHoop();
  setAnim("idle");
  sound.setIntensity({ stage: 0, fire: 0, final: false });
  openModes();
}
$("leave-button").addEventListener("pointerdown", (e) => e.stopPropagation());
$("leave-button").addEventListener("click", leaveFreePlay);

// ---------- Buttons on the screens ----------

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
$("select-back").addEventListener("click", selectBack);
$("again").addEventListener("click", () => {
  if (performance.now() - state.overAt > 900) startGame();
});
$("change-player").addEventListener("click", () => openSelect());
$("got-idea").addEventListener("click", () => window.dispatchEvent(new CustomEvent("feedback:open", { detail: { app: "basketball" } })));
$("help-button").addEventListener("click", toggleHelp);
$("help-close").addEventListener("click", closeHelp);
$("board-button").addEventListener("click", toggleBoard);
$("board-back").addEventListener("click", closeBoard);
wireBoardTabs();
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.phase === "playing") state.hiddenTab = true;
});
fillIcons(stage);

// The whole game area takes presses, not just the court: on a phone there's room below the
// court for a thumb to hold down without covering the player.
listenForInput({
  pad: document.querySelector(".game-page") ?? stage,
  stage,
  press,
  release,
  setInput: (how) => {
    state.input = how;
  },
  escape() {
    if (!screens.help.hidden) closeHelp();
    else if (!screens.board.hidden) closeBoard();
    else if (state.phase === "select" || state.phase === "modes") showTitle();
    else leaveFreePlay();
  },
  // Free play: the arrow keys and WASD steer him.
  steer(x, y) {
    steer.keys = { x, y };
    return state.phase === "playing" && !!mode().freeMove;
  },
  // Choosing a game or a player: the arrow keys move between the cards.
  cards: () =>
    state.phase === "modes" && !screens.modes.hidden ? screens.modes.querySelector(".mode-cards")
    : state.phase === "select" && !screens.select.hidden ? charPick : null,
});

// ---------- Boot ----------

async function boot() {
  loadVoiceClips();
  loadSoundClips();
  try {
    await loadRoster();
    const [hoopImg] = await Promise.all([
      loadImage("assets/hoop-front.webp"),
      selectCharacter(characters.selected),
      document.fonts?.load('48px "Press Start 2P"').catch(() => {}),
    ]);
    art.hoopFront = hoopImg;
    art.ballSprites = makeBallSprites();
  } catch (err) {
    tapToPlay.textContent = "Oops! The game could not load. Try refreshing the page.";
    console.error(err);
    return;
  }
  if (DEBUG) {
    const pickSpot = () => mode().pickSpot();
    window.game = { state, player, shoot, stepBall, checkDecided, pickSpot, isThreePointSpot, project, RIM, sound, selectCharacter, pixelFx, celebrateBuzzerBeater, SUDDEN_DEATH, setSeed };
  }
  resize();
  new ResizeObserver(resize).observe(stage);
  state.mode = load("orson-hoops-mode", "timed");
  showTitle();
  if (location.hash === "#leaderboard") openBoard("week");
  updateHud();
  startLoop((dt) => {
    step(dt);
    render();
  });
}

boot();
