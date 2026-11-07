// The page around the court: the screens that lay over it (one at a time), the words for how to play
// on this device, and the sound and music buttons.

import { sound } from "../audio.js";
import { load, save } from "../engine/storage.js";
import { state } from "../play/state.js";
import { icon } from "../ui/icons.js";

export const $ = (id) => document.getElementById(id);
export const stage = $("stage");
export const screens = { title: $("title-screen"), select: $("select-screen"), modes: $("mode-screen"), turn: $("turn-screen"), over: $("over-screen"), help: $("help-screen"), board: $("board-screen"), shop: $("shop-screen") };
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
  stage.dataset.phase = state.phase;
}

// The screen showing now, if any.
export const openScreen = () => Object.keys(screens).find((k) => !screens[k].hidden) ?? null;

// ---------- Sound buttons ----------

export function setUpSoundButtons() {
  const muteBtn = $("mute");
  const musicBtn = $("music");
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
  for (const btn of [muteBtn, musicBtn, $("help-button"), $("board-button"), $("shop-button")]) btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  // Clicked with a mouse or finger, the sound buttons hand focus back to the game, or Space would
  // keep pressing them instead of shooting. (Keyboard users who tabbed to them keep their place.)
  for (const btn of [muteBtn, musicBtn]) {
    btn.addEventListener("click", (e) => {
      if (e.detail > 0) stage.focus({ preventScroll: true });
    });
  }
  syncSoundButtons();
}
