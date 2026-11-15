// The page around the court: the screens that lay over it (one at a time), the words for how to play
// on this device, and the sound and music buttons.

import { sound } from "../audio.js";
import { load, save } from "../engine/storage.js";
import { state } from "../play/state.js";
import { icon } from "../ui/icons.js";
import { focusStart } from "../ui/keys.js";

export const $ = (id) => document.getElementById(id);
export const stage = $("stage");
// The whole page around the court: it takes presses too, and carries the phase for the CSS.
export const page = $("game-page");
export const screens = { pause: $("pause-screen"), menu: $("menu-screen"), title: $("title-screen"), select: $("select-screen"), modes: $("mode-screen"), turn: $("turn-screen"), over: $("over-screen"), help: $("help-screen"), board: $("board-screen"), shop: $("shop-screen") };
export const tapToPlay = $("tap-to-play");
export const charPick = $("char-pick");

// Keyboards say "press Space"; touch screens say "tap".
// How they can play: a touch screen, a keyboard (a mouse or trackpad means one is likely), or
// both, like a laptop with a touch screen or an iPad with a keyboard.
const HAS_TOUCH = matchMedia("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0;
const HAS_KEYS = matchMedia("(any-hover: hover) and (any-pointer: fine)").matches || !HAS_TOUCH;
// Say how to do something: by touch, by keyboard, or either, depending on what they have.
export const howTo = (touch, keys, both) => (HAS_TOUCH && HAS_KEYS ? both : HAS_KEYS ? keys : touch);

// One screen over the court at a time (or none while playing). Help sits on top of the others.
//
// The keyboard (ui/keys.js): a sheet opening puts focus on the control it starts on (its data-keys-default, the
// main orange button), unless the code opening it chose one; going back to the game or the title puts it back
// where it was (backToGame). On the title, the arrow keys move between the corner buttons. While Space is still
// held (it pressed whatever opened the sheet), focus waits for it to be let go, or letting go would press it.
let opener = null; // what had focus before the first sheet opened over the game or the title
export function showScreen(name) {
  const was = openScreen();
  const sheet = !!name && name !== "title";
  if (sheet && (!was || was === "title")) opener = document.activeElement?.matches(":focus-visible") ? document.activeElement : null;
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  page.dataset.phase = state.phase;
  // A screen covers the corner buttons: keep the keyboard out of them too.
  for (const corner of page.querySelectorAll(".corner")) {
    corner.inert = sheet;
    // the corner buttons are a screen of their own on the title (not in a game: there the arrows are his)
    if (name === "title") corner.dataset.keys = "row";
    else delete corner.dataset.keys;
  }
  if (sheet) focusMain(screens[name]);
}

function focusMain(sheet) {
  const go = () => {
    if (sheet.hidden || sheet.contains(document.activeElement)) return;
    focusStart(sheet); // only for the keyboard: with touch nothing looks chosen
  };
  if (state.pressed) window.addEventListener("keyup", () => setTimeout(go), { once: true });
  else go();
}

/** Back to the game or the title from a sheet: focus goes back to what had it (a button they'd reached with the
 * keyboard), or to the game, so Space plays. */
export function backToGame() {
  const now = openScreen();
  if (now && now !== "title") return; // back to another sheet (help opened from pause): showScreen focused it
  const back = opener;
  opener = null;
  if (back?.isConnected && !back.closest("[inert], [hidden]") && back.getClientRects().length) back.focus({ preventScroll: true });
  else stage.focus({ preventScroll: true });
}

// The screen showing now, if any.
export const openScreen = () => Object.keys(screens).find((k) => !screens[k].hidden) ?? null;

// ---------- Sound buttons ----------

export function setUpSoundButtons() {
  const muteBtn = $("mute");
  const musicBtn = $("music");
  // The same two switches in the menu and on the Paused screen.
  const menuSounds = document.querySelectorAll('[data-menu="sound"]');
  const menuMusics = document.querySelectorAll('[data-menu="music"]');
  sound.muted = load("orson-hoops-muted", false);
  sound.musicOn = load("orson-hoops-music", true);

  function syncSoundButtons() {
    muteBtn.innerHTML = icon(sound.muted ? "mute" : "sound");
    muteBtn.setAttribute("aria-label", sound.muted ? "Unmute sound" : "Mute sound");
    musicBtn.classList.toggle("off", !sound.musicOn);
    musicBtn.setAttribute("aria-label", sound.musicOn ? "Turn music off" : "Turn music on");
    musicBtn.setAttribute("aria-pressed", String(sound.musicOn));
    for (const menuSound of menuSounds) {
      menuSound.setAttribute("aria-pressed", String(!sound.muted));
      menuSound.querySelector("[data-icon]").innerHTML = icon(sound.muted ? "mute" : "sound");
      menuSound.lastElementChild.textContent = sound.muted ? "Sound off" : "Sound on";
    }
    for (const menuMusic of menuMusics) {
      menuMusic.setAttribute("aria-pressed", String(sound.musicOn));
      menuMusic.lastElementChild.textContent = sound.musicOn ? "Music on" : "Music off";
    }
  }

  for (const b of menuSounds) b.addEventListener("click", () => muteBtn.click());
  for (const b of menuMusics) b.addEventListener("click", () => musicBtn.click());
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
  for (const btn of document.querySelectorAll(".corner button")) btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  // Clicked with a mouse or finger, the sound buttons hand focus back to the game, or Space would
  // keep pressing them instead of shooting. (Keyboard users who tabbed to them keep their place.)
  for (const btn of [muteBtn, musicBtn]) {
    btn.addEventListener("click", (e) => {
      if (e.detail > 0) stage.focus({ preventScroll: true });
    });
  }
  syncSoundButtons();
}
