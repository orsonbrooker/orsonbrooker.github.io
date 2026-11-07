// Orson's shootaround: an isometric basketball game (time attack, sudden death, around the world, HORSE).
// This file starts it up and wires the pieces together:
//   engine/   the court and its projection, ball physics, the frame loop, input, drawing helpers
//   play/     the game in progress: the shared state, players, shooting and the update, reactions, drawing the court
//   modes/    one file per way to play, all with the same shape (modes/index.js)
//   content/  tables: the courts, player attributes, fire and ball looks, the around-the-world spots, the announcer's bigger calls
//   screens/  the title, choosing a game and a player, help, the leaderboard, game over
// Scoring rules shared with the server are in shared/rules.js.

import { loadVoiceClips, sound } from "./audio.js";
import { isThreePointSpot, project, RIM } from "./engine/court.js";
import { makeBallSprites } from "./engine/draw.js";
import { listenForInput } from "./engine/input.js";
import { startLoop } from "./engine/loop.js";
import { load } from "./engine/storage.js";
import { SUDDEN_DEATH } from "./modes/index.js";
import { COURTS, court, useCourt } from "./play/court.js";
import { characters, loadImage, loadRoster } from "./play/players.js";
import { celebrateBuzzerBeater, pixelFx, timingWindow, zoneCenter } from "./play/react.js";
import { bestShot, checkReplays, endReplay, startReplay } from "./play/replay.js";
import { checkDecided, shoot, startGame, step, stepBall } from "./play/round.js";
import { art, render, resize, updateHud } from "./play/scene.js";
import { DEBUG, mode, player, setAnim, setSeed, state } from "./play/state.js";
import { $, charPick, screens, setUpSoundButtons, stage, tapToPlay } from "./screens/base.js";
import { openModes, openSelect, selectBack, selectCharacter, setMode, showTitle, startTeam } from "./screens/menus.js";
import { setGameVersion } from "./screens/over.js";
import { closeBoard, closeHelp, openBoard, toggleBoard, toggleHelp, wireBoardTabs } from "./screens/panels.js";
import { closeShop, wireShop } from "./screens/shop.js";
import { ballLook, onProgress, refreshProgress } from "./progress.js";
import { confirmDialog } from "./ui/confirm.js";
import { fillIcons } from "./ui/icons.js";

// The version sent with scores: this file's own ?v= stamp (vite.config.js fills it in when built).
setGameVersion(new URL(import.meta.url).searchParams.get("v"));

setUpSoundButtons();

// ---------- The button ----------

function press() {
  if (state.pressed) return;
  state.pressed = true;
  sound.unlock();

  if (!screens.help.hidden || !screens.shop.hidden) return;
  // A tap during a replay skips it.
  if (state.phase === "replay") return endReplay();
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
  } else if (player.anim === "dribble") setAnim("gather");
}

function release() {
  if (!state.pressed) return;
  state.pressed = false;
  if (state.phase === "replay") return; // the replay moves the player itself
  if (player.anim === "gather") shoot(-2.5);
  else if (player.anim === "jump") shoot((player.t - zoneCenter()) / timingWindow());
}

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
$("replay").addEventListener("click", startReplay);
$("team-go").addEventListener("click", startTeam);
$("turn-quit").addEventListener("click", async () => {
  if (await confirmDialog("Stop this game?", { yes: "Stop", no: "Keep playing", detail: "Nobody wins this one." })) showTitle();
});
$("got-idea").addEventListener("click", () => window.dispatchEvent(new CustomEvent("feedback:open", { detail: { app: "basketball" } })));
$("help-button").addEventListener("click", toggleHelp);
$("help-close").addEventListener("click", closeHelp);
$("board-button").addEventListener("click", toggleBoard);
$("board-back").addEventListener("click", closeBoard);
wireBoardTabs();
wireShop();
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
    else if (!screens.shop.hidden) closeShop();
    else if (!screens.board.hidden) closeBoard();
    else if (state.phase === "replay") endReplay();
    else if (state.phase === "select" || state.phase === "modes") showTitle();
  },
  // Choosing a game or a player: the arrow keys move between the cards.
  cards: () =>
    state.phase === "modes" && !screens.modes.hidden ? screens.modes.querySelector(".mode-cards")
    : state.phase === "select" && !screens.select.hidden ? charPick
    : state.phase === "turn" && !screens.turn.hidden ? $("spot-map") // HORSE: the spots on the turn screen
    : null,
});

// ---------- Boot ----------

async function boot() {
  loadVoiceClips();
  try {
    await loadRoster();
    await Promise.all([
      useCourt(), // the default court: its measurements, physics and art
      selectCharacter(characters.selected),
      document.fonts?.load('48px "Press Start 2P"').catch(() => {}),
    ]);
    art.ballSprites = makeBallSprites(ballLook()); // their ball style from the shop
  } catch (err) {
    tapToPlay.textContent = "Oops! The game could not load. Try refreshing the page.";
    console.error(err);
    return;
  }
  if (DEBUG) {
    const pickSpot = () => mode().pickSpot();
    window.game = { state, player, shoot, stepBall, checkDecided, pickSpot, isThreePointSpot, project, get RIM() { return RIM; }, sound, selectCharacter, pixelFx, celebrateBuzzerBeater, SUDDEN_DEATH, setSeed, setCourt: useCourt, courts: COURTS, get court() { return court; }, bestShot, checkReplays, zoneCenter };
  }
  resize();
  new ResizeObserver(resize).observe(stage);
  state.mode = load("orson-hoops-mode", "timed");
  // A new ball style (bought here or on another device) shows from the next shot.
  onProgress(() => (art.ballSprites = makeBallSprites(ballLook())));
  refreshProgress();
  showTitle();
  if (location.hash === "#leaderboard") openBoard("week");
  updateHud();
  startLoop((dt) => {
    step(dt);
    render();
  });
}

boot();
