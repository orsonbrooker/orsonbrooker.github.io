// The page around the court: the screens that lay over it (one at a time), the words for how to play
// on this device, and the sound and music buttons.

import { sound } from "../audio.js";
import { load, save } from "../engine/storage.js";
import { state } from "../play/state.js";
import { icon } from "../ui/icons.js";

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
export function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  page.dataset.phase = state.phase;
  // A screen covers the corner buttons: keep the keyboard out of them too.
  const covered = !!name && name !== "title";
  for (const corner of page.querySelectorAll(".corner")) corner.inert = covered;
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
