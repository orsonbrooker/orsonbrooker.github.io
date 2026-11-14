// The way into a game: the title screen, then choose a game (each card shows its best), then choose a
// player (and, the first time as Orson with the teams flag on, a team: screens/team.js), then it starts.
// Once they've chosen a player, choosing a game starts it straight away as that player; the Choose a
// game screen shows who they play as and their team, to change either. HORSE always picks its players.

import { attributesFor, skillWords } from "../content/attributes.js";
import { IN_APP } from "../api.js";
import { load, save } from "../engine/storage.js";
import { modeShown } from "../modes/index.js";
import { characters, setFace, useCharacter } from "../play/players.js";
import { startGame } from "../play/round.js";
import { updateHud } from "../play/scene.js";
import { mode, modes, setPhase, state } from "../play/state.js";
import { removeMyPlayer } from "../players/recolor.js";
import { $, charPick, howTo, screens, showScreen, stage, tapToPlay } from "../screens/base.js";
import { showDaily } from "../screens/over.js";
import { chooseTeam, needsTeam } from "../screens/team.js";
import { flagOn } from "../flags.js";
import { myTeam } from "../players/community.js";
import { confirmDialog } from "../ui/confirm.js";
import { icon } from "../ui/icons.js";

// Modes that aren't out yet (modeShown, modes/index.js): their card, leaderboard tab and help go.
for (const el of document.querySelectorAll("[data-mode], [data-board-mode], [data-help-mode]"))
  if (!modeShown(el.dataset.mode ?? el.dataset.boardMode ?? el.dataset.helpMode)) el.remove();

// Picks the mode for the next game (remembered for next time) and shows its best.
export function setMode(id) {
  state.mode = modes[id] && modeShown(id) ? id : "timed";
  state.best = mode().bestKey ? load(mode().bestKey, 0) : 0; // (saved progress may change it: progress.js)
  save("orson-hoops-mode", state.mode);
  stage.dataset.gameMode = state.mode; // free play shows its own buttons (styles.css)
  updateHud();
}

// After a pass and play game (or a replay of one), back to the player this device chose.
function restoreChosenPlayer() {
  const chosen = load("orson-hoops-character", null);
  if (chosen && chosen !== characters.selected && characters.list.some((c) => c.id === chosen)) selectCharacter(chosen);
}

export function showTitle() {
  setPhase("title");
  tapToPlay.textContent = howTo("Tap to play", "Press Space to play", "Tap or press Space to play");
  setMode(state.mode);
  restoreChosenPlayer();
  showScreen("title");
}

// Whether they've chosen a player before (then a game starts as soon as it's chosen).
const choseBefore = () => load("orson-hoops-chosen", false) === true;

// Step two, after tapping to start: pick a game (each card shows its best), then a player.
export function openModes() {
  setPhase("modes");
  restoreChosenPlayer();
  showDaily();
  showWho();
  for (const card of screens.modes.querySelectorAll("[data-mode]")) {
    const m = modes[card.dataset.mode] ?? modes.timed;
    card.setAttribute("aria-pressed", String(card.dataset.mode === state.mode));
    const label = card.querySelector("[data-best]");
    if (!label) continue; // free play: just for fun, no best
    const best = m.bestKey ? load(m.bestKey, 0) : 0;
    label.textContent = m.passAndPlay ? `${m.passAndPlay.min} to ${m.passAndPlay.max} players` : best ? `Your best: ${m.formatBest(best)}` : "No best yet";
  }
  showScreen("modes");
  // Focus their last game, but only once Space is let go, or letting go would pick it.
  const focus = () => screens.modes.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  if (state.pressed) window.addEventListener("keyup", () => setTimeout(focus), { once: true });
  else focus();
}

// Pick a player. `thenPlay`: true starts the game once they've picked, "modes" goes back to Choose a
// game, and otherwise back to the title.
// A pass and play game (HORSE) picks several instead, in turn order, and starts with the Start button.
let selectThenPlay = false;
let team = null; // pass and play: { min, max, chosen: [ids in turn order] }
export function openSelect(thenPlay = false) {
  selectThenPlay = thenPlay;
  setPhase("select");
  const pass = mode().passAndPlay;
  team = pass ? { ...pass, chosen: load("orson-hoops-team", []).filter((id) => characters.list.some((c) => c.id === id)).slice(0, pass.max) } : null;
  $("select-title").textContent = team ? "Who's playing?" : "Choose your player";
  $("team-note").hidden = $("team-go-row").hidden = !team;
  showMyTeam();
  charPick.classList.toggle("team", !!team);
  renderPicker();
  showScreen("select");
  (charPick.querySelector('[aria-pressed="true"]') ?? charPick.querySelector("button"))?.focus({ preventScroll: true });
}

// A game was chosen: straight in as their player once they've chosen one (asking for a team first if
// it's needed), else choose a player first. HORSE always picks who's playing.
export async function pickMode(id) {
  setMode(id);
  if (!choseBefore() || mode().passAndPlay) return openSelect(true);
  const c = characters.list.find((p) => p.id === characters.selected);
  if (needsTeam(c, mode()) && !(await chooseTeam())) return;
  stage.focus({ preventScroll: true }); // so Space plays rather than pressing the card again
  startGame();
}

// Under Choose a game, once they've chosen a player: who they play as and their team, to change.
function showWho() {
  const row = $("mode-who");
  row.hidden = !choseBefore();
  if (row.hidden) return;
  const c = characters.list.find((p) => p.id === characters.selected) ?? characters.list[0];
  const face = Object.assign(document.createElement("img"), { alt: "", width: 32, height: 32 });
  setFace(face, c);
  const who = $("mode-player");
  who.replaceChildren(face, Object.assign(document.createElement("span"), { textContent: c.name })); // a kid's player's name: text only
  who.setAttribute("aria-label", `Playing as ${c.name}. Change player`);
  const t = myTeam();
  const teamButton = $("mode-team");
  teamButton.hidden = !flagOn("teams");
  teamButton.replaceChildren();
  teamButton.insertAdjacentHTML("afterbegin", icon("players"));
  teamButton.append(Object.assign(document.createElement("span"), { textContent: t ? t.name : "Choose your team" })); // may be a kid's: text only
}

/** Change player from Choose a game, then back to it. */
export const changePlayer = () => openSelect("modes");

/** Change team from Choose a game. */
export async function changeTeamFromModes() {
  await chooseTeam();
  showWho();
}

// Back from choosing a player: to choosing a game, if that's where they came from.
export const selectBack = () => (selectThenPlay ? openModes() : showTitle());

// Plays as this player from now on, and shows it if the picker is open.
export async function selectCharacter(id) {
  await useCharacter(id);
  if (state.phase === "select") renderPicker();
}

/** The picker again if it's open (the list of players changed). */
export function refreshPicker() {
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
      // What they're good at, only for players given attributes (content/attributes.js).
      const skills = skillWords(attributesFor(c.id));
      for (const words of skills) button.append(Object.assign(document.createElement("small"), { className: "skill", textContent: words }));
      if (team?.chosen.includes(c.id)) {
        // Their place in the turn order.
        const order = Object.assign(document.createElement("b"), { className: "order", textContent: String(team.chosen.indexOf(c.id) + 1) });
        order.setAttribute("aria-label", `Player ${team.chosen.indexOf(c.id) + 1}`);
        button.append(order);
      }
      button.addEventListener("click", async () => {
        if (team) return toggleTeam(c.id);
        // The first game as Orson (or anyone without a team of their own): which team it counts for.
        if (selectThenPlay === true && needsTeam(c, mode())) await chooseTeam();
        await selectCharacter(c.id);
        save("orson-hoops-chosen", true);
        stage.focus({ preventScroll: true }); // so Space plays rather than pressing this card again
        if (selectThenPlay === true) startGame();
        else if (selectThenPlay === "modes") openModes();
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
      // and a way to change them in the builder (a page of the website, not in the iOS app)
      if (!IN_APP) {
        const edit = Object.assign(document.createElement("a"), { className: "edit", href: `/players/?edit=${encodeURIComponent(c.id)}`, innerHTML: icon("edit") });
        edit.setAttribute("aria-label", `Change ${c.name}`);
        card.append(edit);
      }
      return card;
    }),
    // The builder is a page of the website, not in the iOS app (which is just the game).
    ...(IN_APP ? [] : [Object.assign(document.createElement("a"), { href: "/players/", className: "card make-player", innerHTML: `${icon("plus")}<span>Make your player</span>` })]),
  );
  if (team) showTeam();
}

// The device's team (Top teams), under Choose your player: tap to change it. Not for pass and play.
function showMyTeam() {
  const button = $("my-team");
  button.hidden = !flagOn("teams") || !!team;
  if (button.hidden) return;
  const t = myTeam();
  button.replaceChildren();
  button.insertAdjacentHTML("afterbegin", icon("players"));
  button.append(Object.assign(document.createElement("span"), { textContent: t ? `Team: ${t.name}` : "Choose your team" })); // may be a kid's: text only
}

export async function changeMyTeam() {
  await chooseTeam();
  showMyTeam();
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
