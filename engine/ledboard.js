// The long LED screen along the top of the hoop wall on a pixel-art court (content/courts.js `led`): the
// announcer's calls light up on it (play/scene.js), so they sit in the gym instead of over the art. Like the wall
// scoreboard (engine/pixelboard.js) it repaints the court's own art pixels: the screen is a grid of face pixels on
// the wall (r along it in reading order, one art pixel across each; c up it, one art pixel each), and every art
// pixel of the court that shows it is worked out once.
//
// Each letter is 5x7 LEDs, each LED 2x2 face pixels with a dark gap, so it reads as a real LED sign. A call too
// long for the screen scrolls across it once (with reduced motion, it shows a few words at a time instead). The
// gym's front left wall has one too, flashing "Tap to play" on the title (play/scene.js).

export const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "!": ["1", "1", "1", "1", "1", "0", "1"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  ".": ["0", "0", "0", "0", "0", "0", "1"],
  ",": ["00", "00", "00", "00", "00", "01", "10"],
  "'": ["1", "1", "0", "0", "0", "0", "0"],
  "-": ["000", "000", "000", "111", "000", "000", "000"],
  ":": ["0", "0", "1", "0", "1", "0", "0"],
  " ": ["000", "000", "000", "000", "000", "000", "000"],
};
const PITCH = 3; // face pixels per LED: 2 lit and a gap
const CALM = matchMedia("(prefers-reduced-motion: reduce)");
const SPEED = 55; // LEDs a second, scrolling
const PAGE = 1.3; // seconds a page shows, with reduced motion
const FLASH_ON = 0.8, FLASH_OFF = 0.35; // a flashing sign: seconds on, then off

// LED columns for `text`: one array of 7 bits per column, a blank column between letters
function columns(text) {
  const cols = [];
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let i = 0; i < g[0].length; i++) cols.push(g.map((row) => row[i] === "1"));
    cols.push(Array(7).fill(false));
  }
  cols.pop();
  return cols;
}

const rgb = (hex) => [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));

/**
 * An LED screen on a wall of `court`, as `spec` says: { plane: "hoop", u: [far, near] (metres along the hoop wall,
 * reading left to right on screen towards smaller u), z: [bottom, top] metres up, out: metres off the wall } or
 * { plane: "side", at: u of a wall facing +u (the box's front left wall from outside), v: [start, end] (reading
 * towards larger v), z }. k: court pixels per art pixel. Returns { canvas, x, y, scale, draw(message, t) }:
 * `message` is { text, color, big, flash } or { bar: fraction or null, color } (a loading bar) or null, `t` seconds since it came up; draw the canvas at (x, y),
 * `scale` times bigger, smoothing off. draw() returns whether the message has finished showing. A `flash` message
 * never finishes: it flashes on and off, a page of words at a time when it's too long to fit.
 */
/**
 * A flat face on a wall of `court` (`spec` as for createLedBoard), as art pixels: `fw` x `fh` face pixels (r along it
 * in reading order, c down from its top), the art pixels that can show it (`w` x `h` from art pixel `ax`, `ay`), and
 * `cell`: which face pixel each of those shows (c * fw + r), or -1. Also used by engine/letterboard.js.
 */
export function wallFace(court, spec, k = 5) {
  const { origin: o, eu, ev, pxPerM } = court;
  const [z0, z1] = spec.z;
  const side = spec.plane === "side";
  const len = side ? spec.v[1] - spec.v[0] : spec.u[0] - spec.u[1]; // metres long
  const along = (side ? ev.x : Math.abs(eu.x)) / k; // face pixels a metre along it
  const up = pxPerM / k;
  const fw = Math.round(len * along);
  const fh = Math.round((z1 - z0) * up);
  // where (s metres along it from its start, z up) is on the court, and back
  const uv = (s) => (side ? [spec.at, spec.v[0] + s] : [spec.u[0] - s, spec.out]);
  const corner = (s, z) => {
    const [u, v] = uv(s);
    return [(o.x + u * eu.x + v * ev.x) / k, (o.y + u * eu.y + v * ev.y - z * pxPerM) / k];
  };
  const pts = [corner(0, z0), corner(len, z0), corner(0, z1), corner(len, z1)];
  const ax = Math.floor(Math.min(...pts.map((p) => p[0]))) - 1;
  const ay = Math.floor(Math.min(...pts.map((p) => p[1]))) - 1;
  const w = Math.ceil(Math.max(...pts.map((p) => p[0]))) + 1 - ax;
  const h = Math.ceil(Math.max(...pts.map((p) => p[1]))) + 1 - ay;
  // which face pixel each art pixel shows (at its middle)
  const cell = new Int32Array(w * h).fill(-1);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = (ax + i + 0.5) * k, y = (ay + j + 0.5) * k;
      let u, v, sAlong;
      if (side) {
        u = spec.at;
        v = (x - o.x - u * eu.x) / ev.x;
        sAlong = v - spec.v[0];
      } else {
        v = spec.out;
        u = (x - o.x - v * ev.x) / eu.x;
        sAlong = spec.u[0] - u;
      }
      const z = (o.y + u * eu.y + v * ev.y - y) / pxPerM;
      const r = Math.floor(sAlong * along);
      const c = Math.floor((z1 - z) * up); // c counts down from the top: rows of text read top to bottom
      if (r >= 0 && r < fw && c >= 0 && c < fh) cell[j * w + i] = c * fw + r;
    }
  return { fw, fh, ax, ay, w, h, cell };
}

export function createLedBoard(court, spec, k = 5) {
  const { fw, fh, ax, ay, w, h, cell } = wallFace(court, spec, k);
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = canvas.getContext("2d");
  const img = g.createImageData(w, h);
  const FRAME = rgb("#403751"), EDGE = rgb("#2b1622"), BACK = rgb("#180826"), OFF = rgb("#2e1a33");
  const BORDER = 2; // face pixels of frame round the LEDs
  const ledsAcross = Math.floor((fw - 2 * BORDER + 1) / PITCH);
  const ledsUp = Math.floor((fh - 2 * BORDER + 1) / PITCH);
  const left = Math.floor((fw - (ledsAcross * PITCH - 1)) / 2);
  const top = Math.floor((fh - (ledsUp * PITCH - 1)) / 2);
  const row0 = Math.floor((ledsUp - 7) / 2); // the text's top row of LEDs
  // Made once and reused every frame (nothing allocated while a call shows): which LEDs are lit now, and which
  // were when the picture was last painted.
  const litNow = new Uint8Array(ledsAcross * 7);
  const litShown = new Uint8Array(ledsAcross * 7);
  let painted = false;
  let shownOn = null; // the colour last painted lit, or null: nothing lit
  let cache = null; // { text, cols, pages: [columns of each page] }

  // a loading bar in LEDs: a frame round it, filling from the left (`fraction` 0..1), or a block sliding along
  // when how much is left isn't known (null; still, with reduced motion)
  function barLights(fraction, t) {
    const lit = litNow.fill(0);
    const x0 = 2, x1 = ledsAcross - 3;
    for (let x = x0; x <= x1; x++) lit[x] = lit[6 * ledsAcross + x] = 1;
    for (let y = 0; y < 7; y++) lit[y * ledsAcross + x0] = lit[y * ledsAcross + x1] = 1;
    const inside = x1 - x0 - 3;
    let from = 0, to = 0;
    if (typeof fraction === "number") to = Math.round(Math.max(0, Math.min(1, fraction)) * inside);
    else {
      const block = Math.max(3, Math.round(inside / 4));
      from = CALM.matches ? 0 : Math.floor(t * 20) % (inside + block) - block;
      to = from + block;
    }
    for (let x = Math.max(0, from); x < Math.min(inside, to); x++) for (let y = 2; y <= 4; y++) lit[y * ledsAcross + x0 + 2 + x] = 1;
    return lit;
  }

  function put(cols, x0) {
    for (let n = 0; n < cols.length; n++) {
      const x = x0 + n;
      if (x < 0 || x >= ledsAcross) continue;
      for (let y = 0; y < 7; y++) if (cols[n][y]) litNow[y * ledsAcross + x] = 1;
    }
  }

  function lights(message, t) {
    // which LEDs are lit (litNow, ledsAcross x 7), or null; and whether it's done
    if (!message) return [null, true];
    if ("bar" in message) return [barLights(message.bar, t), false];
    if (cache?.text !== message.text) {
      const pages = [];
      if (columns(message.text).length > ledsAcross) {
        // with reduced motion: as many words as fit, a page at a time
        let line = "";
        for (const word of message.text.split(" ")) {
          const next = line ? `${line} ${word}` : word;
          if (line && columns(next).length > ledsAcross) {
            pages.push(line);
            line = word;
          } else line = next;
        }
        if (line) pages.push(line);
      }
      cache = { text: message.text, cols: columns(message.text), pages: pages.map(columns) };
    }
    litNow.fill(0);
    const { cols, pages } = cache;
    if (message.flash) {
      // on a while, then off a moment: the whole thing, or a page of it at a time
      const beat = t % (FLASH_ON + FLASH_OFF);
      if (beat > FLASH_ON && !CALM.matches) return [null, false];
      const page = pages.length ? pages[Math.floor(t / (FLASH_ON + FLASH_OFF)) % pages.length] : cols;
      put(page, Math.floor((ledsAcross - page.length) / 2));
      return [litNow, false];
    }
    if (cols.length <= ledsAcross) {
      put(cols, Math.floor((ledsAcross - cols.length) / 2));
      return [litNow, t > message.duration];
    }
    if (CALM.matches) {
      const n = Math.floor(t / PAGE);
      if (n >= pages.length) return [null, true];
      put(pages[n], Math.floor((ledsAcross - pages[n].length) / 2));
      return [litNow, false];
    }
    // scrolls in from the right and right off the left
    const x = ledsAcross - Math.floor(t * SPEED);
    if (x + cols.length < 0) return [null, true];
    put(cols, x);
    return [litNow, false];
  }

  // the colour of face pixel (r, c), with `on` lit LEDs (and `shine` their top left corners) from litShown
  function faceColour(r, c, on, shine) {
    if (r === 0 || c === 0 || r === fw - 1 || c === fh - 1) return EDGE;
    if (r < BORDER || c < BORDER || r >= fw - BORDER || c >= fh - BORDER) return FRAME;
    const lx = r - left, ly = c - top;
    const ix = Math.floor(lx / PITCH), iy = Math.floor(ly / PITCH);
    if (lx < 0 || ly < 0 || lx % PITCH === PITCH - 1 || ly % PITCH === PITCH - 1 || ix >= ledsAcross || iy >= ledsUp) return BACK;
    const ty = iy - row0;
    const isOn = on && ty >= 0 && ty < 7 && litShown[ty * ledsAcross + ix];
    // lit LEDs in full colour, the top left of each catching the light
    return isOn ? (lx % PITCH === 0 && ly % PITCH === 0 ? shine : on) : OFF;
  }

  const sameAsShown = (lit) => {
    for (let i = 0; i < lit.length; i++) if (lit[i] !== litShown[i]) return false;
    return true;
  };
  const colours = new Map(); // a call's colour -> [its rgb, its shine]
  const colourOf = (hex) => {
    if (!colours.has(hex)) {
      const on = rgb(hex);
      colours.set(hex, [on, on.map((v) => Math.round((v + 255) / 2))]);
    }
    return colours.get(hex);
  };

  return {
    canvas,
    x: ax * k,
    y: ay * k,
    scale: k,
    version: 0, // goes up each time the picture changes
    draw(message, t) {
      const [lit, done] = lights(message, t);
      // a big call (a buzzer beater) blinks, unless motion is reduced
      const blink = message?.big && !CALM.matches && Math.floor(t * 4) % 2 === 1;
      const [on, shine] = lit && !blink ? colourOf(message.color) : [null, null];
      if (painted && on === shownOn && (!on || sameAsShown(lit))) return done;
      painted = true;
      shownOn = on;
      if (on) litShown.set(lit);
      const data = img.data;
      for (let p = 0; p < w * h; p++) {
        const f = cell[p];
        if (f < 0) continue;
        const col = faceColour(f % fw, Math.floor(f / fw), on, shine);
        data[p * 4] = col[0];
        data[p * 4 + 1] = col[1];
        data[p * 4 + 2] = col[2];
        data[p * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this.version++;
      return done;
    },
  };
}
