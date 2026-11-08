// Input: one button. Space, a tap or a mouse press anywhere on the game area presses it, letting go
// releases it. Escape backs out of a screen, and the arrow keys move between cards. In free play the
// arrow keys and WASD steer the player instead. (The on-screen joystick and shoot button for touch
// screens are in play/controls.js.)

// Typing in a form (like the ideas box) shouldn't make Orson shoot.
const typing = (e) => e.target instanceof Element && e.target.closest("input, textarea, select, button, dialog");
// Things on the page that are tapped for their own sake, not to shoot.
const OWN_TAPS = "a, button, input, select, textarea, dialog, .panel-screen";
// Free play: the keys that steer the player, as a direction on screen.
const STEER_KEYS = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

// Arrow keys move between the cards in `area` (choosing a game or a player): to the nearest card
// that way, so it works however the cards wrap. Enter or Space picks the one in focus.
function arrowMove(key, area) {
  if (document.querySelector("dialog[open]")) return false;
  if (!area) return false;
  const cards = [...area.querySelectorAll(".mode-card, .card")];
  const current = cards.includes(document.activeElement) ? document.activeElement : null;
  if (!current) {
    (area.querySelector('[aria-pressed="true"]') ?? cards[0])?.focus({ preventScroll: true });
    return true;
  }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  const centre = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const [cx, cy] = centre(current);
  let best = null;
  let bestScore = Infinity;
  for (const card of cards) {
    if (card === current) continue;
    const [x, y] = centre(card);
    const along = (x - cx) * dir[0] + (y - cy) * dir[1];
    if (along < 4) continue; // not that way
    const across = Math.abs((x - cx) * dir[1] + (y - cy) * dir[0]);
    const score = along + across * 3; // prefer cards in line over ones off to the side
    if (score < bestScore) [best, bestScore] = [card, score];
  }
  best?.focus({ preventScroll: true });
  best?.scrollIntoView({ block: "nearest" });
  return true;
}

// Listens for the button and the keys:
//   pad       the element that takes presses (the whole game area, so a thumb can hold below the court)
//   stage     gets focus back after a press, so Space keeps working
//   press(), release()
//   setInput(how)  how they're playing: "keyboard", "mouse" or "touch"
//   escape()       Escape pressed with no dialog open
//   cards()        the element whose cards the arrow keys move between right now, or null
//   steer(x, y)    the steering keys held now, as a direction on screen (x right, y down, length 0
//                  or 1); returns whether steering is on (free play), so the arrow keys don't scroll
export function listenForInput({ pad, stage, press, release, setInput, escape, cards, steer }) {
  const held = new Set();
  function steerKeys() {
    let x = 0;
    let y = 0;
    for (const code of held) {
      x += STEER_KEYS[code][0];
      y += STEER_KEYS[code][1];
    }
    const len = Math.hypot(x, y) || 1;
    return steer(x / len, y / len);
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
      escape();
      return;
    }
    if (e.key.startsWith("Arrow") && arrowMove(e.key, cards())) {
      e.preventDefault();
      return;
    }
    if (STEER_KEYS[e.code] && !typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      held.add(e.code);
      if (steerKeys()) {
        e.preventDefault();
        setInput("keyboard");
      }
      return;
    }
    if (e.code !== "Space" && e.key !== " ") return;
    if (typing(e)) return;
    e.preventDefault();
    setInput("keyboard");
    if (!e.repeat) press();
  });
  window.addEventListener("keyup", (e) => {
    if (held.delete(e.code)) {
      steerKeys();
      return;
    }
    if (e.code !== "Space" && e.key !== " ") return;
    if (typing(e)) return;
    e.preventDefault();
    release();
  });

  let activePointer = null;
  pad.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!e.target.closest(OWN_TAPS)) setInput(e.pointerType === "mouse" ? "mouse" : "touch");
    if (activePointer !== null || e.target.closest(OWN_TAPS)) return;
    activePointer = e.pointerId;
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety; pointerup on the pad still ends the press.
    }
    e.preventDefault();
    stage.focus({ preventScroll: true }); // so Space keeps working after a click below the court
    press();
  });
  // Stops iOS long-press callouts, text selection and scrolling while holding to shoot.
  pad.addEventListener(
    "touchstart",
    (e) => {
      if (!e.target.closest(OWN_TAPS)) e.preventDefault();
    },
    { passive: false },
  );
  function pointerEnd(e) {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    release();
  }
  pad.addEventListener("pointerup", pointerEnd);
  pad.addEventListener("pointercancel", pointerEnd);
  pad.addEventListener("lostpointercapture", pointerEnd);
  pad.addEventListener("contextmenu", (e) => {
    if (!e.target.closest(OWN_TAPS)) e.preventDefault();
  });
  window.addEventListener("blur", () => {
    activePointer = null;
    release();
    held.clear();
    steerKeys();
  });
}
