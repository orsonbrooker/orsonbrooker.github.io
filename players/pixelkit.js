// Pixel-art sheets made from video (tools/pixelart/): recolouring by palette slot, and printing a
// player's number and team name on the jersey the way the builder's players get theirs. Used by the
// game and the art test (?artlab).

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

// Five tones from one colour (outline, dark, shadow, mid, light), the same as ramp() in tools/art3d/pixelize.py.
export function ramp(colour) {
  const [r, g, b] = hex(colour).map((c) => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  const tone = (dh, lk, sk, lift = 0) => {
    const l2 = Math.min(1, l * lk + (1 - l) * lift), s2 = Math.min(1, s * sk), h2 = (((h + dh / 360) % 1) + 1) % 1;
    const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2, p = 2 * l2 - q;
    const ch = (t) => {
      t = ((t % 1) + 1) % 1;
      const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
      return Math.round(v * 255);
    };
    return [ch(h2 + 1 / 3), ch(h2), ch(h2 - 1 / 3)];
  };
  return [tone(-16, 0.42, 0.95, 0.04), tone(-11, 0.62, 1, 0.04), tone(-6, 0.8, 1), tone(0, 1, 1), tone(6, 1, 0.95, 0.3)];
}


// A layer in new colours: every pixel is looked up by its default colour to find its palette slot,
// then given that slot's new colour. No masks, no shading maths. With `kit` ({ number, team }), the
// canvas also gets `printLayers`: the number (and the team name on the front) for each frame, drawn
// like the builder's players (players/recolor.js), in the game's pixel font sized to fit, but on a
// layer FINE times finer than the art (`kit.fine`, for a smaller sheet's twin), drawn over the frame.
// Load the font first.
const slotsCache = new WeakMap(); // image -> { meta, slots }
export function paletteSwap(img, meta, colours, kit) {
  const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const slotOf = new Map(meta.rgb.map(([r, gg, b], i) => [(r << 16) | (gg << 8) | b, i]));
  const pal = meta.rgb.map((rgb) => rgb.slice());
  for (const [part, colour] of Object.entries(colours)) {
    if (!meta.palette[part]) continue;
    ramp(colour).forEach((rgb, t) => (pal[meta.palette[part][t]] = rgb));
  }
  const d = data.data;
  // each pixel's slot, worked out once for an image (the builder repaints the same twin at every change)
  let slots = slotsCache.get(img)?.meta === meta ? slotsCache.get(img).slots : null;
  if (!slots) {
    slots = new Int16Array(c.width * c.height).fill(-1);
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const slot = slotOf.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      if (slot !== undefined) slots[i / 4] = slot;
    }
    slotsCache.set(img, { meta, slots });
  }
  for (let p = 0; p < slots.length; p++) {
    const slot = slots[p];
    if (slot < 0) continue;
    const rgb = pal[slot];
    d[p * 4] = rgb[0];
    d[p * 4 + 1] = rgb[1];
    d[p * 4 + 2] = rgb[2];
  }
  g.putImageData(data, 0, 0);
  if (kit && meta.palette.jersey && meta.palette.team) {
    if (meta.faces) c.printLayers = faceLayers(meta, slots, c.width, pal, kit);
    else if (meta.prints) c.printLayers = printLayers(meta, slots, c.width, pal, kit);
  }
  return c;
}

const FINE = 4; // print layer pixels per art pixel (the builder's sheets are about this fine)
const FONT = '"Press Start 2P", monospace';

function printLayers(meta, slots, sheetW, pal, kit) {
  const jerseyTone = new Map(meta.palette.jersey.map((s, t) => [s, t]));
  const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
  // The team colour, or dark/light ink if it wouldn't show up on the jersey (as recolor.js does).
  let ink = meta.palette.team.map((s) => pal[s]);
  const jMid = pal[meta.palette.jersey[3]];
  if (Math.abs(lum(ink[3]) - lum(jMid)) < 60) ink = ramp(lum(jMid) > 128 ? "#26222a" : "#f2f2ef");
  const number = String(kit.number ?? "").replace(/\D/g, "").slice(0, 2);
  const team = String(kit.team ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 10);

  const frames = new Map();
  for (const list of Object.values(meta.frames)) for (const f of list) frames.set(`${f[0]},${f[1]}`, f);
  const out = new Map();
  const isTeam = (ax, ay) => meta.palette.team.includes(slots[ay * sheetW + ax]);
  const mainJersey = (fx, fy, fw, fh) => biggestPatch(slots, sheetW, jerseyTone, fx, fy, fw, fh);
  const need = new Map(); // frame -> the biggest size that sits on the jersey
  const sizeFor = new Map(); // frame -> the size used: the commonest fit across its move
  for (const pass of ["measure", "draw"]) {
    if (pass === "draw") {
      for (const list of Object.values(meta.frames)) {
        const ks = list.map((f) => need.get(`${f[0]},${f[1]}`)).filter((v) => v !== undefined).sort((a, b) => a - b);
        if (!ks.length) continue;
        const k = ks[Math.floor(ks.length * 0.3)]; // most frames fit; the odd squeezed one still sits mostly on
        for (const f of list) if (need.has(`${f[0]},${f[1]}`)) sizeFor.set(`${f[0]},${f[1]}`, Math.min(sizeFor.get(`${f[0]},${f[1]}`) ?? 1, k));
      }
    }
  for (const [key, [x, y, w, h, rows, angle = 0]] of Object.entries(meta.prints)) {
    const f = frames.get(key);
    if (!f || w < 3) continue; // seen edge-on
    const [fx, fy, fw, fh] = f;
    const stamp = Object.assign(document.createElement("canvas"), { width: fw * FINE, height: fh * FINE });
    const sg = stamp.getContext("2d", { willReadFrequently: true });
    // The print's middle and tilt (from the jersey's shape in this frame), in fine pixels.
    const cx = (x - fx + w / 2) * FINE;
    const cy = (y - fy + h / 2) * FINE;
    const lines = []; // [text, size] top to bottom
    if (rows === 2) {
      // The front: the name across the chest, as big as fits, then the number under it.
      if (team) lines.push([team, Math.max(4, Math.floor(Math.min(5 * FINE, (w * FINE * 0.92) / team.length)))]);
      if (number) lines.push([number, Math.floor(Math.min(6 * FINE, (w * FINE * 0.8) / number.length))]);
    } else if (number) lines.push([number, Math.floor(Math.min(h * FINE, 7 * FINE))]);
    if (!lines.length) continue;
    // Draws the text (white on clear) rotated with his body, `k` times its size, and says what
    // share of it would land off his jersey (on the background or his shorts).
    const draw = (k) => {
      sg.clearRect(0, 0, stamp.width, stamp.height);
      sg.save();
      sg.translate(cx, cy);
      sg.rotate((angle * Math.PI) / 180);
      sg.fillStyle = "#fff";
      sg.textAlign = "center";
      sg.textBaseline = "top";
      const gap = Math.max(2, FINE / 2) * k;
      const total = lines.reduce((s, [, size]) => s + size * k, 0) + gap * (lines.length - 1);
      let ty = -total / 2;
      for (const [text, size] of lines) {
        sg.font = `${Math.max(4, Math.round(size * k))}px ${FONT}`;
        const room = w * FINE * 0.95;
        const natural = sg.measureText(text).width;
        sg.save();
        sg.translate(0, ty);
        if (natural > room) sg.scale(room / natural, 1); // turned away: narrower
        sg.fillText(text, 0, 0);
        sg.restore();
        ty += size * k + gap;
      }
      sg.restore();
      const d = sg.getImageData(0, 0, stamp.width, stamp.height).data;
      let all = 0, off = 0;
      for (let qy = 0; qy < stamp.height; qy += 2)
        for (let qx = 0; qx < stamp.width; qx += 2) {
          if (d[(qy * stamp.width + qx) * 4 + 3] < 128) continue;
          all++;
          const ax = fx + Math.floor(qx / FINE), ay = fy + Math.floor(qy / FINE);
          if (slots[ay * sheetW + ax] < 0 || isTeam(ax, ay)) off++;
        }
      return all ? off / all : 0;
    };
    // Never half off his jersey: the size that sits on it in most of this move's frames (one size
    // per move, so it doesn't pulse), from the sizes each frame would need (worked out first).
    if (pass === "measure") {
      need.set(key, [1, 0.85, 0.72, 0.6].find((s) => draw(s) <= 0.04) ?? 0.6);
      continue;
    }
    draw(sizeFor.get(key) ?? 1);
    // Only on the main part of his jersey (an arm across it can split off a thin strip), and not at
    // all when most of the text would be hidden: a fragment looks worse than no number.
    const main = mainJersey(fx, fy, fw, fh);
    const px = sg.getImageData(0, 0, stamp.width, stamp.height);
    const p = px.data;
    let total = 0, shown = 0;
    for (let qy = 0; qy < stamp.height; qy++)
      for (let qx = 0; qx < stamp.width; qx++) {
        if (p[(qy * stamp.width + qx) * 4 + 3] < 128) continue;
        total++;
        if (main[Math.floor(qy / FINE) * fw + Math.floor(qx / FINE)]) shown++;
      }
    if (!total || shown / total < 0.5) continue;
    let any = false;
    for (let qy = 0; qy < stamp.height; qy++)
      for (let qx = 0; qx < stamp.width; qx++) {
        const i = (qy * stamp.width + qx) * 4;
        if (p[i + 3] < 128) {
          p[i + 3] = 0;
          continue;
        }
        const t = jerseyTone.get(slots[(fy + Math.floor(qy / FINE)) * sheetW + fx + Math.floor(qx / FINE)]);
        if (t === undefined || !main[Math.floor(qy / FINE) * fw + Math.floor(qx / FINE)]) {
          p[i + 3] = 0; // arms and the ball stay in front
          continue;
        }
        // one shade darker than the jersey under it, so it follows the folds
        [p[i], p[i + 1], p[i + 2]] = ink[Math.max(1, Math.min(3, t - 1))];
        p[i + 3] = 255;
        any = true;
      }
    if (!any) continue;
    sg.putImageData(px, 0, 0);
    out.set(key, stamp);
  }
  }
  return out;
}

// The jersey in a frame without its stray bits (an eye, a speck): 1 for each pixel of a connected
// patch of at least `min` pixels, frame-relative. An arm across his back can split the jersey in
// two, and the number belongs on both pieces.
// (kept for each slots array, which paletteSwap keeps for each image: it doesn't change with the colours)
const patchCache = new WeakMap(); // slots -> Map(frame and min -> patches)
function jerseyPatches(slots, sheetW, jerseyTone, fx, fy, fw, fh, min) {
  let known = patchCache.get(slots);
  if (!known) patchCache.set(slots, (known = new Map()));
  const key = `${sheetW},${[...jerseyTone.keys()]},${fx},${fy},${fw},${fh},${min}`;
  if (!known.has(key)) known.set(key, findPatches(slots, sheetW, jerseyTone, fx, fy, fw, fh, min));
  return known.get(key);
}
function findPatches(slots, sheetW, jerseyTone, fx, fy, fw, fh, min) {
  const lab = new Int32Array(fw * fh).fill(-1);
  const sizes = [];
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      if (lab[y * fw + x] >= 0 || !jerseyTone.has(slots[(fy + y) * sheetW + fx + x])) continue;
      const k = sizes.length;
      const stack = [y * fw + x];
      lab[y * fw + x] = k;
      let n = 0;
      while (stack.length) {
        const at = stack.pop();
        n++;
        const cx = at % fw, cy = (at - cx) / fw;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= fw || ny >= fh || lab[ny * fw + nx] >= 0) continue;
          if (!jerseyTone.has(slots[(fy + ny) * sheetW + fx + nx])) continue;
          lab[ny * fw + nx] = k;
          stack.push(ny * fw + nx);
        }
      }
      sizes.push(n);
    }
  return Uint8Array.from(lab, (v) => (v >= 0 && sizes[v] >= min ? 1 : 0));
}

// The biggest connected patch of jersey in a frame (his shirt, not a sliver behind an arm, a sock or
// an eye): 1 for each of its pixels, frame-relative.
function biggestPatch(slots, sheetW, jerseyTone, fx, fy, fw, fh) {
  const lab = new Int32Array(fw * fh).fill(-1);
  let best = -1, bestN = 0, k = 0;
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      if (lab[y * fw + x] >= 0 || !jerseyTone.has(slots[(fy + y) * sheetW + fx + x])) continue;
      const stack = [y * fw + x];
      lab[y * fw + x] = k;
      let n = 0;
      while (stack.length) {
        const at = stack.pop();
        n++;
        const cx = at % fw, cy = (at - cx) / fw;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= fw || ny >= fh || lab[ny * fw + nx] >= 0) continue;
          if (!jerseyTone.has(slots[(fy + ny) * sheetW + fx + nx])) continue;
          lab[ny * fw + nx] = k;
          stack.push(ny * fw + nx);
        }
      }
      if (n > bestN) [best, bestN] = [k, n];
      k++;
    }
  return Uint8Array.from(lab, (v) => (v === best ? 1 : 0));
}

// The team colour, or dark/light ink if it wouldn't show up on the jersey (as recolor.js does).
function inkFor(meta, pal) {
  const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
  const ink = meta.palette.team.map((s) => pal[s]);
  const jMid = pal[meta.palette.jersey[3]];
  return Math.abs(lum(ink[3]) - lum(jMid)) < 60 ? ramp(lum(jMid) > 128 ? "#26222a" : "#f2f2ef") : ink;
}

// The perspective transform taking four points (from) to four others (to): a function (x, y) -> [x, y].
function homography(from, to) {
  // Solve for h in  x' = (h0 x + h1 y + h2) / (h6 x + h7 y + 1),  y' = (h3 x + h4 y + h5) / (...)
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c || !A[c][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return (x, y) => {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };
}

// The number (and the name, on the front) warped onto each frame's face: an invisible four-cornered
// patch the sheet's builder laid on his jersey and smoothed across each move (tools/pixelart/,
// "faces"). The text is set flat on a card in the game's pixel font, then every fine pixel inside
// the face looks up its spot on the card through the face's perspective. Ink lands only on the
// main patch of jersey, one shade darker than the jersey under it.
function faceLayers(meta, slots, sheetW, pal, kit) {
  const fine = kit.fine ?? FINE;
  const jerseyTone = new Map(meta.palette.jersey.map((s, t) => [s, t]));
  const ink = inkFor(meta, pal);
  const number = String(kit.number ?? "").replace(/\D/g, "").slice(0, 2);
  const team = String(kit.team ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 10);
  const frames = new Map();
  for (const list of Object.values(meta.frames)) for (const f of list) frames.set(`${f[0]},${f[1]}`, f);
  // The card's shape: a typical face seen square-on (among the widest), so the text keeps its
  // proportions there and narrows naturally as he turns.
  const aspect = (rows) => {
    const list = Object.values(meta.faces)
      .filter((f) => f[0] === rows)
      .map((f) => Math.hypot(f[3] - f[1], f[4] - f[2]) / Math.max(1, Math.hypot(f[7] - f[1], f[8] - f[2])))
      .sort((a, b) => a - b);
    return list.length ? list[Math.floor(list.length * 0.75)] : 1;
  };
  const cards = {};
  for (const rows of [1, 2]) {
    const ch = 96, cw = Math.round(ch * aspect(rows));
    const card = Object.assign(document.createElement("canvas"), { width: cw, height: ch });
    const g = card.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const put = (text, cy, maxH) => {
      if (!text) return;
      g.font = `${maxH}px ${FONT}`;
      const natural = g.measureText(text).width;
      const size = Math.max(6, Math.floor(maxH * Math.min(1, (cw * 0.96) / natural)));
      g.font = `${size}px ${FONT}`;
      g.fillText(text, cw / 2, cy);
    };
    if (rows === 2) {
      put(team, ch * 0.2, ch * 0.32);
      put(number, ch * 0.68, ch * 0.6);
    } else put(number, ch / 2, ch * 0.95);
    cards[rows] = { w: cw, h: ch, data: g.getImageData(0, 0, cw, ch).data };
  }
  const out = new Map();
  for (const [key, [rows, ...corners]] of Object.entries(meta.faces)) {
    const f = frames.get(key);
    if (!f) continue;
    const [fx, fy, fw, fh] = f;
    const card = cards[rows];
    const quad = [0, 1, 2, 3].map((i) => [(corners[2 * i] - fx) * fine, (corners[2 * i + 1] - fy) * fine]);
    const toCard = homography(quad, [[0, 0], [card.w, 0], [card.w, card.h], [0, card.h]]);
    const main = jerseyPatches(slots, sheetW, jerseyTone, fx, fy, fw, fh, 15);
    const layer = Object.assign(document.createElement("canvas"), { width: fw * fine, height: fh * fine });
    // kept on the CPU: gear reads it back into its frames (players/gear.js)
    const lg = layer.getContext("2d", { willReadFrequently: true });
    const img = lg.createImageData(layer.width, layer.height);
    const p = img.data;
    const xs = quad.map((q) => q[0]), ys = quad.map((q) => q[1]);
    let any = false;
    for (let qy = Math.max(0, Math.floor(Math.min(...ys))); qy < Math.min(layer.height, Math.ceil(Math.max(...ys))); qy++)
      for (let qx = Math.max(0, Math.floor(Math.min(...xs))); qx < Math.min(layer.width, Math.ceil(Math.max(...xs))); qx++) {
        const [u, v] = toCard(qx + 0.5, qy + 0.5);
        if (u < 0 || v < 0 || u >= card.w || v >= card.h) continue;
        if (card.data[(Math.floor(v) * card.w + Math.floor(u)) * 4 + 3] < 128) continue;
        const ax = Math.floor(qx / fine), ay = Math.floor(qy / fine);
        if (!main[ay * fw + ax]) continue; // arms and the ball stay in front
        const t = jerseyTone.get(slots[(fy + ay) * sheetW + fx + ax]);
        const i = (qy * layer.width + qx) * 4;
        [p[i], p[i + 1], p[i + 2]] = ink[Math.max(1, Math.min(3, t - 1))];
        p[i + 3] = 255;
        any = true;
      }
    if (!any) continue;
    lg.putImageData(img, 0, 0);
    out.set(key, layer);
  }
  return out;
}
