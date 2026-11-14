// The wall scoreboard on a pixel-art court (content/courts.js `scoreboard`): the game repaints the face's own
// art pixels, so the labels and digit segments are pixel art on the court's grid, lit like the art preview
// (tools/pixelart/iso_bake.py scoreface paints the same face, unlit, into the court picture).
//
// The face is a grid of face pixels on the hoop wall: r counts along the wall in reading order (1/24 m each),
// c counts up (one art pixel each). Every art pixel of the court picture that shows the face is worked out
// once: which face pixel it is. Drawing then colours those art pixels and lays them over the court, each one
// `k` court pixels square.

// 3x5 letters for the labels the modes use (M and N are wider).
const FONT = {
  A: ["010", "101", "111", "101", "101"],
  C: ["111", "100", "100", "100", "111"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  K: ["101", "101", "110", "101", "101"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  N: ["1001", "1101", "1011", "1001", "1001"],
  O: ["111", "101", "101", "101", "111"],
  P: ["110", "101", "110", "100", "100"],
  R: ["110", "101", "110", "101", "101"],
  S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"],
};
const DIGIT_SEGS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"];

function labelWidth(text) {
  return [...text].reduce((w, ch) => w + (FONT[ch] ? FONT[ch][0].length : 3) + 1, -1);
}

/**
 * A pixel scoreboard for `court` (an entry in content/courts.js with `scoreboard`). k: court pixels per art
 * pixel. Returns { canvas, x, y, scale, draw([leftLabel, left], [rightLabel, right]) }: draw the canvas at
 * (x, y) on the court, `scale` times bigger, with smoothing off.
 */
export function createPixelScoreboard(court, k = 5) {
  const { foot, face } = court.scoreboard;
  const { origin: o, eu, ev, pxPerM } = court;
  const along = Math.abs(eu.x) / k; // face pixels per metre along the wall (art pixels across per metre)
  const up = pxPerM / k; // art pixels per metre up
  const u1 = foot[0] + face.start[0]; // the face's reading starts at its largest u (the hoop wall reads towards -u)
  const z0 = foot[1] + face.start[1];
  const [fw, fh] = face.size;
  // the art pixels that can show the face: its corners on the court, in art pixels
  const corner = (u, z) => [(o.x + u * eu.x + face.out * ev.x) / k, (o.y + u * eu.y + face.out * ev.y - z * pxPerM) / k];
  const pts = [corner(u1, z0), corner(u1 - fw / along, z0), corner(u1, z0 + fh / up), corner(u1 - fw / along, z0 + fh / up)];
  const ax = Math.floor(Math.min(...pts.map((p) => p[0]))) - 1;
  const ay = Math.floor(Math.min(...pts.map((p) => p[1]))) - 1;
  const w = Math.ceil(Math.max(...pts.map((p) => p[0]))) + 1 - ax;
  const h = Math.ceil(Math.max(...pts.map((p) => p[1]))) + 1 - ay;
  // which face pixel each art pixel shows (at its middle, as the bake samples), or -1
  const cell = new Int32Array(w * h).fill(-1);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = (ax + i + 0.5) * k;
      const y = (ay + j + 0.5) * k;
      const u = (x - o.x - face.out * ev.x) / eu.x;
      const z = (o.y + u * eu.y + face.out * ev.y - y) / pxPerM;
      const r = Math.floor((u1 - u) * along);
      const c = Math.floor((z - z0) * up);
      if (r >= 0 && r < fw && c >= 0 && c < fh) cell[j * w + i] = c * fw + r;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  const rgb = (hex) => [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));
  const colours = Object.fromEntries(Object.entries(face.colours).map(([name, hex]) => [name, rgb(hex)]));
  const FACE = 0, WINDOW = 1, UNLIT = 2, LIT = 3, LABEL = 4;
  const paint = [colours.face, colours.window, colours.unlit, colours.lit, colours.label];

  return {
    canvas,
    x: ax * k,
    y: ay * k,
    scale: k,
    draw(...sides) {
      // the face in face pixels, then onto the art pixels that show it
      const grid = new Uint8Array(fw * fh).fill(FACE);
      const set = (r, c, what) => {
        if (r >= 0 && r < fw && c >= 0 && c < fh) grid[c * fw + r] = what;
      };
      face.windows.forEach((win, n) => {
        const [label, value] = sides[n] || ["", 0];
        const [r0, c0, r1, c1] = win.window;
        for (let c = c0; c < c1; c++) for (let r = r0; r < r1; r++) set(r, c, WINDOW);
        const digits = win.cells.length;
        const shown = String(Math.max(0, Math.min(10 ** digits - 1, Math.floor(value))))
          .padStart(Math.min(2, digits), "0")
          .padStart(digits, " ");
        win.cells.forEach(([rx, cy], d) => {
          const on = shown[d] === " " ? "" : DIGIT_SEGS[Number(shown[d])];
          for (const [seg, [q0, d0, q1, d1]] of Object.entries(face.segments)) {
            for (let c = cy + d0; c < cy + d1; c++) for (let r = rx + q0; r < rx + q1; r++) set(r, c, on.includes(seg) ? LIT : UNLIT);
          }
        });
        // the label, centred over its window
        let lx = r0 + Math.floor((r1 - r0 - labelWidth(label)) / 2);
        const ly = c1 + face.labelGap;
        for (const ch of label) {
          const glyph = FONT[ch];
          if (!glyph) {
            lx += 4;
            continue;
          }
          glyph.forEach((row, j) => [...row].forEach((bit, i) => bit === "1" && set(lx + i, ly + 4 - j, LABEL)));
          lx += glyph[0].length + 1;
        }
      });
      const img = g.createImageData(w, h);
      for (let p = 0; p < w * h; p++) {
        if (cell[p] < 0) continue;
        const [r, gg, b] = paint[grid[cell[p]]];
        img.data.set([r, gg, b, 255], p * 4);
      }
      g.putImageData(img, 0, 0);
    },
  };
}
