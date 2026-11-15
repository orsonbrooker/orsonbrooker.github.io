// HORSE's letter board, on the gym's side wall below the windows (content/courts.js `horseBoard`): each player's
// name and five tiles, H O R S E, the ones they've got lit red. Like the wall scoreboard and the LED screens it
// repaints the court's own art pixels (engine/ledboard.js wallFace), so it's part of the wall: a dark board in a
// frame, letters as solid pixels (the LED screens' 5x7 letters), the shooter's name yellow, a player who's out dim.

import { GLYPHS, wallFace } from "./ledboard.js";

const rgb = (hex) => [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));
const C = {
  edge: rgb("#2b1622"),
  frame: rgb("#403751"),
  frameLit: rgb("#5f5d77"),
  back: rgb("#180826"),
  name: rgb("#e9ccbb"),
  shooter: rgb("#ffe066"),
  out: rgb("#5f5d77"),
  tile: rgb("#403751"),
  tileLetter: rgb("#959cb7"),
  lit: rgb("#d0553c"),
  litLetter: rgb("#f9f5f0"),
};
const ROW = 9; // a tile's height, and the space a row takes before its gap
const GAP = 2;
const TILE = 7; // a tile's width (a 5-wide letter and a pixel each side)
const NAME = 12; // letters of a name shown: all of one (names are up to 12)

/**
 * The board for `court` (with `horseBoard`), k court pixels per art pixel. Returns { canvas, x, y, scale,
 * draw(players, shooter, word) }: `players` [{ name, letters, out }], `shooter` the index whose turn it is (or -1);
 * draw the canvas at (x, y), `scale` times bigger, with smoothing off. It repaints only when something changed.
 */
export function createLetterBoard(court, k = 5) {
  const { fw, fh, ax, ay, w, h, cell } = wallFace(court, court.horseBoard, k);
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = canvas.getContext("2d");
  const img = g.createImageData(w, h);
  const face = new Array(fw * fh);
  let shown = null;

  const put = (r, c, col) => {
    if (r >= 0 && r < fw && c >= 0 && c < fh) face[c * fw + r] = col;
  };
  // a 5x7 letter with its top left at (r, c); returns how wide it was
  const letter = (ch, r, c, col) => {
    const glyph = GLYPHS[ch];
    if (!glyph) return 0;
    glyph.forEach((row, j) => [...row].forEach((bit, i) => bit === "1" && put(r + i, c + j, col)));
    return glyph[0].length;
  };

  return {
    canvas,
    x: ax * k,
    y: ay * k,
    scale: k,
    draw(players, shooter, word) {
      const key = JSON.stringify([players, shooter, word]);
      if (key === shown) return;
      shown = key;
      // the board: a dark edge, a frame lit along its top, and the dark face
      for (let c = 0; c < fh; c++)
        for (let r = 0; r < fw; r++)
          face[c * fw + r] = r === 0 || c === 0 || r === fw - 1 || c === fh - 1 ? C.edge : r < 3 || c < 3 || r >= fw - 3 || c >= fh - 3 ? (c < 3 ? C.frameLit : C.frame) : C.back;
      // the rows, centred up and down, the tiles lined up on the right
      const rows = players.length;
      const tilesW = word.length * (TILE + 1) - 1;
      const right = fw - 4 - tilesW;
      let top = Math.floor((fh - (rows * (ROW + GAP) - GAP)) / 2);
      players.forEach((p, i) => {
        const nameCol = p.out ? C.out : i === shooter ? C.shooter : C.name;
        let r = 4;
        for (const ch of (p.name ?? "").toUpperCase().slice(0, NAME)) {
          const used = letter(ch, r, top + 1, nameCol);
          r += (used || 3) + 1;
          if (r > right - 2) break;
        }
        [...word].forEach((ch, n) => {
          const lit = n < p.letters;
          const r0 = right + n * (TILE + 1);
          for (let c = 0; c < ROW; c++) for (let x = 0; x < TILE; x++) put(r0 + x, top + c, lit ? C.lit : C.tile);
          letter(ch, r0 + 1, top + 1, lit ? C.litLetter : p.out ? C.tile : C.tileLetter);
        });
        top += ROW + GAP;
      });
      for (let i = 0; i < w * h; i++) {
        if (cell[i] < 0) continue;
        img.data.set([...face[cell[i]], 255], i * 4);
      }
      g.putImageData(img, 0, 0);
    },
  };
}
