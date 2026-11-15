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
// The joystick's base, like an arcade stick's: a black disc, lit along its top left, and a metal collar round
// the hole the stick comes out of.
const base = () =>
  pixelCircle(32, (d, x, y) => {
    if (d > 15.6) return null;
    if (d > 14.5) return INK;
    if (d > 8.4) return x + y < -5 && d > 11 ? "#5f5d77" : "#403751";
    if (d > 7.4) return INK;
    if (d > 4.4) return x + y < -2 ? "#c4bfc8" : "#877e8f";
    return INK;
  });
// The knob: a shiny yellow ball, a white glint on its top left.
const knob = () =>
  pixelCircle(14, (d, x, y) => {
    if (d > 6.6) return null;
    if (d > 5.6) return INK;
    if (Math.hypot(x + 2, y + 2) < 1.3) return "#f9f5f0";
    if (x + y < -3 && d > 2.5) return "#fff3a6";
    if (x + y > 5) return "#c48412";
    return x + y > 2 ? "#f0b424" : "#f8d76c";
  });
// The shoot button: a basketball sitting in a black base.
const ball = () =>
  pixelCircle(28, (d, x, y) => {
    if (d > 13.6) return null;
    if (d > 12.7) return INK;
    if (d > 10.8) return x + y < -6 ? "#5f5d77" : "#403751";
    if (d > 9.9) return INK;
    const k = 12.2 / 9.9; // the seams as drawn on a ball 12.2 across
    const [bx, by] = [x * k, y * k];
    const seam = Math.abs(bx) < 0.7 || Math.abs(by) < 0.7 || Math.abs(Math.hypot(bx + 15, by) - 10.5) < 0.7 || Math.abs(Math.hypot(bx - 15, by) - 10.5) < 0.7;
    if (seam) return INK;
    if (Math.hypot(x + 4, y + 4) < 1.6) return "#fff3a6";
    if (x + y < -6 && d > 5) return "#f39a55";
    return x + y > 7 ? "#b5501d" : "#de6d2b";
  });

// Builds the controls into `stage`. press() and release() are the game's button (game.js);
// setInput("touch") marks how they're playing.
export function setUpTouchControls({ stage, press, release, setInput }) {
  const stick = Object.assign(document.createElement("div"), { className: "touch-controls touch-stick" });
  stick.setAttribute("aria-hidden", "true"); // keyboards steer with the arrow keys
  // the knob, on a stick (which only shows when the joystick lies on a wall and stands up off it: play/scene.js)
  const knobEl = Object.assign(document.createElement("div"), { className: "touch-knob" });
  const shaft = pixelCircle(8, (d, x) => (d > 3.6 ? null : d > 2.6 ? INK : x < -0.5 ? "#c4bfc8" : "#877e8f"));
  shaft.className = "knob-shaft";
  const top = knob();
  top.className = "knob-top";
  knobEl.append(shaft, top);
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
  // It can be turned to lie on a wall (Free play on a court with folding walls, play/scene.js placeControls): the
  // finger is followed on screen, and the knob's move is turned back into the joystick's own frame so it stays
  // under the finger, within the ring as drawn.
  function aim(e) {
    const r = stick.getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(stick).transform === "none" ? undefined : getComputedStyle(stick).transform);
    const reach = stick.offsetWidth * STICK_REACH;
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const det = m.a * m.d - m.b * m.c || 1;
    let lx = (m.d * dx - m.c * dy) / det; // in the joystick's own frame
    let ly = (-m.b * dx + m.a * dy) / det;
    const local = Math.hypot(lx, ly);
    if (local > reach) {
      lx *= reach / local;
      ly *= reach / local;
      dx = m.a * lx + m.c * ly;
      dy = m.b * lx + m.d * ly;
    }
    const dist = Math.hypot(dx, dy);
    knobEl.style.transform = `translate(calc(-50% + ${lx}px), calc(-50% + ${ly}px))`;
    stick.dataset.knob = `${lx.toFixed(1)},${ly.toFixed(1)}`; // for the stick drawn on a wall (play/scene.js)
    const amount = Math.min(1, Math.hypot(lx, ly) / reach);
    const speed = amount < DEAD_ZONE ? 0 : (amount - DEAD_ZONE) / (1 - DEAD_ZONE);
    steer.stick = dist ? { x: (dx / Math.hypot(dx, dy)) * speed, y: (dy / Math.hypot(dx, dy)) * speed } : { x: 0, y: 0 };
  }
  function letGo() {
    knobEl.style.transform = "";
    delete stick.dataset.knob;
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
