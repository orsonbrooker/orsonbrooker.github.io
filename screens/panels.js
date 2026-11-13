// The help and leaderboard panels, which open over whichever screen is showing and go back to it.

import { flagOn } from "../flags.js";
import { renderBoard, renderTeams } from "../leaderboard.js";
import { boardBody, boardFace } from "../play/players.js";
import { state } from "../play/state.js";
import { $, openScreen, screens, showScreen, stage } from "../screens/base.js";
import { MODES } from "../shared/rules.js";

// ---------- Leaderboard ----------

let boardReturn = null;
// The leaderboard opens on the mode they're playing; its tabs switch mode and week or all time, and
// (while the `teams` flag is on) between players and Top teams.
let boardMode = null;
let boardKind = "players";
export function openBoard(range = "week", mode = boardMode ?? state.mode) {
  if (screens.board.hidden) {
    boardReturn = openScreen();
    // Games without a leaderboard (HORSE) open it on Time attack.
    mode = boardMode = MODES.includes(state.mode) ? state.mode : "timed";
  }
  boardMode = mode;
  for (const tab of screens.board.querySelectorAll("[data-range]")) tab.setAttribute("aria-selected", String(tab.dataset.range === range));
  for (const tab of screens.board.querySelectorAll("[data-board-mode]")) tab.setAttribute("aria-selected", String(tab.dataset.boardMode === mode));
  for (const tab of screens.board.querySelectorAll("[data-board-kind]")) tab.setAttribute("aria-selected", String(tab.dataset.boardKind === boardKind));
  showScreen("board");
  if (boardKind === "teams") renderTeams($("board-list"), $("board-note"), range, mode, boardFace);
  else renderBoard($("board-list"), $("board-note"), range, mode, boardFace, boardBody);
}
const boardRange = () => screens.board.querySelector('[data-range][aria-selected="true"]')?.dataset.range ?? "week";
export function closeBoard() {
  showScreen(boardReturn === "board" ? "title" : boardReturn);
  stage.focus({ preventScroll: true });
}
export const toggleBoard = () => (screens.board.hidden ? openBoard() : closeBoard());
export function wireBoardTabs() {
  const kinds = screens.board.querySelector(".board-kinds");
  if (!flagOn("teams")) kinds?.remove();
  for (const tab of screens.board.querySelectorAll("[data-board-kind]"))
    tab.addEventListener("click", () => {
      boardKind = tab.dataset.boardKind;
      openBoard(boardRange(), boardMode);
    });
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
