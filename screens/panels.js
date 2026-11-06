// The help and leaderboard panels, which open over whichever screen is showing and go back to it.

import { renderBoard } from "../leaderboard.js";
import { boardBody, boardFace } from "../play/players.js";
import { state } from "../play/state.js";
import { $, openScreen, screens, showScreen, stage } from "../screens/base.js";

// ---------- Leaderboard ----------

let boardReturn = null;
// The leaderboard opens on the mode they're playing; its tabs switch mode and week or all time.
let boardMode = null;
export function openBoard(range = "week", mode = boardMode ?? state.mode) {
  if (screens.board.hidden) {
    boardReturn = openScreen();
    mode = boardMode = state.mode;
  }
  boardMode = mode;
  for (const tab of screens.board.querySelectorAll("[data-range]")) tab.setAttribute("aria-selected", String(tab.dataset.range === range));
  for (const tab of screens.board.querySelectorAll("[data-board-mode]")) tab.setAttribute("aria-selected", String(tab.dataset.boardMode === mode));
  showScreen("board");
  renderBoard($("board-list"), $("board-note"), range, mode, boardFace, boardBody);
}
const boardRange = () => screens.board.querySelector('[data-range][aria-selected="true"]')?.dataset.range ?? "week";
export function closeBoard() {
  showScreen(boardReturn === "board" ? "title" : boardReturn);
  stage.focus({ preventScroll: true });
}
export const toggleBoard = () => (screens.board.hidden ? openBoard() : closeBoard());
export function wireBoardTabs() {
  for (const tab of screens.board.querySelectorAll("[data-range]")) tab.addEventListener("click", () => openBoard(tab.dataset.range, boardMode));
  for (const tab of screens.board.querySelectorAll("[data-board-mode]")) tab.addEventListener("click", () => openBoard(boardRange(), tab.dataset.boardMode));
}

// ---------- Help ----------

let helpReturn = null;
function openHelp() {
  helpReturn = openScreen();
  showScreen("help");
  $("help-close").focus({ preventScroll: true });
}
export function closeHelp() {
  showScreen(helpReturn);
  stage.focus({ preventScroll: true });
}
export const toggleHelp = () => (screens.help.hidden ? openHelp() : closeHelp());
