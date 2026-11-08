// Pausing a game: the pause button (top left, only while playing), Escape, or leaving the app or tab
// stops the game and shows the Paused screen. From there: keep playing, start the same game again, or
// quit it (nothing is sent; back to the title).

import { sound } from "../audio.js";
import { startGame } from "../play/round.js";
import { state } from "../play/state.js";
import { $, screens, showScreen, stage } from "../screens/base.js";
import { showTitle } from "../screens/menus.js";

export function openPause() {
  if (state.phase !== "playing" || state.paused) return;
  state.paused = true; // game.js stops stepping the game
  state.pressed = false; // a hold in progress is let go of without shooting
  showScreen("pause");
  $("pause-resume").focus({ preventScroll: true });
}

export function resumeGame() {
  if (!state.paused) return;
  state.paused = false;
  showScreen(null);
  stage.focus({ preventScroll: true });
}

function restartGame() {
  stage.focus({ preventScroll: true });
  startGame(); // clears the pause
}

function quitGame() {
  state.paused = false;
  state.balls = [];
  sound.quitGame();
  showTitle();
  stage.focus({ preventScroll: true });
}

export const pauseOpen = () => !screens.pause.hidden;

export function wirePause() {
  $("pause-button").addEventListener("click", openPause);
  $("pause-close").addEventListener("click", resumeGame);
  $("pause-resume").addEventListener("click", resumeGame);
  $("pause-restart").addEventListener("click", restartGame);
  $("pause-quit").addEventListener("click", quitGame);
  // Switching apps or tabs mid-game pauses it, so they come back to where they were.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) openPause();
  });
}
