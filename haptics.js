// A little buzz in the hand: a tap for a basket, a thump for catching fire. Does nothing when the
// sound is off (audio.js only calls it then), or on a computer.
//   - In the iOS app (ios/): Capacitor's Haptics plugin.
//   - Android browsers: the Vibration API.
//   - iPhone Safari (iOS 18 and later), which has no Vibration API: flipping an <input switch> plays the
//     system's little tick, and clicking a hidden label for one does that without showing anything.
//     The same trick as haptics.lochie.me (web-haptics), without the library.

const plugin = () => globalThis.Capacitor?.Plugins?.Haptics;
const TOUCH = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const VIBRATE = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

let label = null;
function tick() {
  if (!label) {
    label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.append(input);
    document.body.append(label); // outside the game area, so the game never sees the click
  }
  label.click();
}

export function buzz(kind) {
  const fire = kind === "fire";
  const haptics = plugin();
  if (haptics) {
    haptics.impact({ style: fire ? "HEAVY" : "LIGHT" }).catch(() => {});
    return;
  }
  if (!TOUCH) return;
  if (VIBRATE) {
    navigator.vibrate(fire ? [35, 50, 35] : 15);
    return;
  }
  tick();
  if (fire) setTimeout(tick, 90); // two ticks for fire
}
