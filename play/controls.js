// Free play on a touch screen: a joystick in the bottom-left corner to move the player and a round
// shoot button in the bottom-right that works like holding and letting go of Space. They're drawn
// as chunky pixel circles, shown only on touch screens while free play is on (styles.css), and keep
// their touches to themselves so they don't also press the game's tap-anywhere button.

import { steer } from "../play/state.js";

const STICK_REACH = 0.36; // how far the knob goes from the centre, as a share of the joystick's width
const DEAD_ZONE = 0.15; // a nudge this small (share of the reach) doesn't move him

// A pixel-art circle, `size` art pixels across, scaled up crisply by CSS (image-rendering: pixelated).
// `paint(d, x, y)` gives each pixel's colour from its distance to the centre (in art pixels), or null.
function pixelCircle(size, paint) {
  const c = Object.assign(document.createElement("canvas"), { width: size, height: size });
  const g = c.getContext("2d");
  const mid = (size - 1) / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const colour = paint(Math.hypot(x - mid, y - mid), x - mid, y - mid);
      if (!colour) continue;
      g.fillStyle = colour;
      g.fillRect(x, y, 1, 1);
    }
  return c;
}

const INK = "#2b1622";
// The joystick's base: a dark see-through disc with a light rim and a notch at each side.
const base = () =>
  pixelCircle(32, (d, x, y) => {
    if (d > 15.6) return null;
    if (d > 14.2) return INK;
    if (d > 13) return "rgba(255, 255, 255, 0.55)";
    const notch = (Math.abs(x) < 1 && Math.abs(y) > 9.5) || (Math.abs(y) < 1 && Math.abs(x) > 9.5);
    return notch ? "rgba(255, 255, 255, 0.45)" : "rgba(43, 22, 34, 0.45)";
  });
// The knob: a yellow nub with an outline and a highlight.
const knob = () =>
  pixelCircle(14, (d, x, y) => {
    if (d > 6.6) return null;
    if (d > 5.4) return INK;
    if (x + y < -4 && d > 3) return "#fff3b0";
    return x + y > 4 ? "#e0b830" : "#ffe066";
  });
// The shoot button: a basketball, with its seams.
const ball = () =>
  pixelCircle(28, (d, x, y) => {
    if (d > 13.6) return null;
    if (d > 12.2) return INK;
    const seam = Math.abs(x) < 0.6 || Math.abs(y) < 0.6 || Math.abs(Math.hypot(x + 15, y) - 10.5) < 0.6 || Math.abs(Math.hypot(x - 15, y) - 10.5) < 0.6;
    if (seam) return INK;
    if (x + y < -9 && d > 7) return "#ffb070";
    return x + y > 9 ? "#c0561c" : "#e8792b";
  });

// Builds the controls into `stage`. press() and release() are the game's button (game.js);
// setInput("touch") marks how they're playing.
export function setUpTouchControls({ stage, press, release, setInput }) {
  const stick = Object.assign(document.createElement("div"), { className: "touch-controls touch-stick" });
  stick.setAttribute("aria-hidden", "true"); // keyboards steer with the arrow keys
  const knobEl = knob();
  knobEl.className = "touch-knob";
  stick.append(base(), knobEl);

  const shoot = Object.assign(document.createElement("button"), { type: "button", className: "touch-controls touch-shoot" });
  shoot.setAttribute("aria-label", "Shoot: hold to jump, let go to shoot");
  const label = Object.assign(document.createElement("span"), { textContent: "SHOOT" });
  shoot.append(ball(), label);
  stage.append(stick, shoot);

  // Each control follows one finger, from pressing it to letting go, and keeps that touch from the
  // game area underneath (engine/input.js would take it as a press of the button).
  function hold(el, { down, move = () => {}, up }) {
    let finger = null;
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (finger !== null) return;
      finger = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a nicety; pointerup on the control still ends it.
      }
      setInput("touch");
      down(e);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId === finger) move(e);
    });
    const end = (e) => {
      if (e.pointerId !== finger) return;
      finger = null;
      up();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
    // No long-press menus, text selection or scrolling while a thumb holds it.
    el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // The joystick: the further from its centre, the faster he goes, up to full jog speed.
  function aim(e) {
    const r = stick.getBoundingClientRect();
    const reach = r.width * STICK_REACH;
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > reach) {
      dx *= reach / dist;
      dy *= reach / dist;
    }
    knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const amount = Math.min(1, dist / reach);
    const speed = amount < DEAD_ZONE ? 0 : (amount - DEAD_ZONE) / (1 - DEAD_ZONE);
    steer.stick = dist ? { x: (dx / Math.hypot(dx, dy)) * speed, y: (dy / Math.hypot(dx, dy)) * speed } : { x: 0, y: 0 };
  }
  function letGo() {
    knobEl.style.transform = "";
    steer.stick = { x: 0, y: 0 };
  }
  hold(stick, { down: aim, move: aim, up: letGo });
  hold(shoot, {
    down() {
      shoot.classList.add("down");
      press();
    },
    up() {
      shoot.classList.remove("down");
      release();
    },
  });

  // Leaving free play lets go of both.
  return function reset() {
    letGo();
    shoot.classList.remove("down");
  };
}
