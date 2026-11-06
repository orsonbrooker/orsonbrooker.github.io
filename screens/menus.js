// The way into a game: the title screen, then choose a game (each card shows its best), then choose a
// player. The first time someone plays, choosing a player comes first and then the game starts.

import { load, save } from "../engine/storage.js";
import { characters, setFace, useCharacter } from "../play/players.js";
import { startGame } from "../play/round.js";
import { updateHud } from "../play/scene.js";
import { mode, modes, state } from "../play/state.js";
import { removeMyPlayer } from "../players/recolor.js";
import { $, charPick, howTo, screens, showScreen, stage, tapToPlay } from "../screens/base.js";
import { showDaily } from "../screens/over.js";
import { confirmDialog } from "../ui/confirm.js";
import { icon } from "../ui/icons.js";

// Picks the mode for the next game (remembered for next time) and shows its best.
export function setMode(id) {
  state.mode = modes[id] ? id : "timed";
  state.best = mode().bestKey ? load(mode().bestKey, 0) : 0;
  save("orson-hoops-mode", state.mode);
  updateHud();
}

// After a pass and play game (or a replay of one), back to the player this device chose.
function restoreChosenPlayer() {
  const chosen = load("orson-hoops-character", null);
  if (chosen && chosen !== characters.selected && characters.list.some((c) => c.id === chosen)) selectCharacter(chosen);
}

export function showTitle() {
  state.phase = "title";
  tapToPlay.textContent = howTo("Tap to play", "Press Space to play", "Tap or press Space to play");
  setMode(state.mode);
  restoreChosenPlayer();
  showScreen("title");
}

// Step two, after tapping to start: pick a game (each card shows its best), then a player.
export function openModes() {
  state.phase = "modes";
  restoreChosenPlayer();
  showDaily();
  for (const card of screens.modes.querySelectorAll("[data-mode]")) {
    const m = modes[card.dataset.mode] ?? modes.timed;
    const best = m.bestKey ? load(m.bestKey, 0) : 0;
    card.setAttribute("aria-pressed", String(card.dataset.mode === state.mode));
    card.querySelector("[data-best]").textContent =
      m.passAndPlay ? `${m.passAndPlay.min} to ${m.passAndPlay.max} players` : best ? `Your best: ${m.formatBest(best)}` : "No best yet";
  }
  showScreen("modes");
  // Focus their last game, but only once Space is let go, or letting go would pick it.
  const focus = () => screens.modes.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  if (state.pressed) window.addEventListener("keyup", () => setTimeout(focus), { once: true });
  else focus();
}

// Pick a player. `thenPlay`: start the game once they've picked (otherwise back to the title).
// A pass and play game (HORSE) picks several instead, in turn order, and starts with the Start button.
let selectThenPlay = false;
let team = null; // pass and play: { min, max, chosen: [ids in turn order] }
export function openSelect(thenPlay = false) {
  selectThenPlay = thenPlay;
  state.phase = "select";
  const pass = mode().passAndPlay;
  team = pass ? { ...pass, chosen: load("orson-hoops-team", []).filter((id) => characters.list.some((c) => c.id === id)).slice(0, pass.max) } : null;
  $("select-title").textContent = team ? "Who's playing?" : "Choose your player";
  $("team-note").hidden = $("team-go-row").hidden = !team;
  charPick.classList.toggle("team", !!team);
  renderPicker();
  showScreen("select");
  (charPick.querySelector('[aria-pressed="true"]') ?? charPick.querySelector("button"))?.focus({ preventScroll: true });
}

// Back from choosing a player: to choosing a game, if that's where they came from.
export const selectBack = () => (selectThenPlay ? openModes() : showTitle());

// Plays as this player from now on, and shows it if the picker is open.
export async function selectCharacter(id) {
  await useCharacter(id);
  if (state.phase === "select") renderPicker();
}

// The player select screen: a card per player, then one to make your own.
function renderPicker() {
  charPick.replaceChildren(
    ...characters.list.map((c) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card";
      button.setAttribute("aria-pressed", String(team ? team.chosen.includes(c.id) : c.id === characters.selected));
      const img = document.createElement("img");
      img.alt = "";
      setFace(img, c);
      const name = document.createElement("span");
      name.textContent = c.name;
      button.append(img, name);
      if (team?.chosen.includes(c.id)) {
        // Their place in the turn order.
        const order = Object.assign(document.createElement("b"), { className: "order", textContent: String(team.chosen.indexOf(c.id) + 1) });
        order.setAttribute("aria-label", `Player ${team.chosen.indexOf(c.id) + 1}`);
        button.append(order);
      }
      button.addEventListener("click", async () => {
        if (team) return toggleTeam(c.id);
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
        if (team) team.chosen = team.chosen.filter((id) => id !== c.id);
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
  if (team) showTeam();
}

// ---------- Pass and play: picking who's playing ----------

// Tapping a player adds them to the end of the turn order, or takes them out.
function toggleTeam(id) {
  const at = team.chosen.indexOf(id);
  if (at >= 0) team.chosen.splice(at, 1);
  else if (team.chosen.length < team.max) team.chosen.push(id);
  const focused = document.activeElement;
  const index = [...charPick.querySelectorAll(".card")].indexOf(focused);
  renderPicker();
  charPick.querySelectorAll(".card")[index]?.focus({ preventScroll: true });
}

function showTeam() {
  const n = team.chosen.length;
  $("team-note").textContent =
    n >= team.max ? `${n} players. Pass the device around!`
    : n >= team.min ? `${n} players. Add up to ${team.max}, or start!`
    : `Tap ${team.min} to ${team.max} players, in the order they'll shoot.`;
  $("team-go").disabled = n < team.min;
}

// Start: these players, in this order.
export function startTeam() {
  if (!team || team.chosen.length < team.min) return;
  save("orson-hoops-team", team.chosen);
  mode().setPlayers(team.chosen.map((id) => characters.list.find((c) => c.id === id)));
  stage.focus({ preventScroll: true });
  startGame();
}
