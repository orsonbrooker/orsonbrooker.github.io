// The court opens out of a closed box at the start of a game (docs/art/isometric.md "The closed box"): the gym
// stands shut with a START button on its roof; pressed (or a tap or Space anywhere), the roof splits in two down
// the middle and each half folds back over its back wall and drops behind it, then the two front walls fold down
// outwards until they lie flat on the ground, where they stay for the game. In Free play the joystick and shoot
// button sit on them (play/scene.js).
//
// The box is the court's own pictures (content/courts.js `panels`: a panels.json that tools/pixelart/iso_export.py
// writes from art/iso/gym-box). The court picture stays as it is underneath; the box is drawn over everything, on
// its own canvas the size of the screen, so the walls can lie flat beyond the court's square.
//
// A flat panel turning about its hinge, seen through the court's camera (orthographic), is the same picture under
// an affine transform: along the hinge nothing moves, and the panel's other direction turns. So each panel is one
// drawImage. Past the angle where the camera sees a panel's other side, that side is drawn instead: the front
// walls' insides are plain wall pictures (the side and hoop walls with nothing on them) moved to the front, the
// roof's underside is a plain ceiling. The walls' thickness (their far edge and front end) is drawn as flat faces.

import { EU, EV, PX_PER_M, ROOM_U, ROOM_V, court, project } from "../engine/court.js";
import { loadImage } from "../engine/download.js";

// The motion is worked out as heavy panels on hinges, once, as angles every 1/240 s: each roof half is pushed up
// just hard enough to get over, hangs a moment near upright, then tips and falls behind its wall; each front wall
// tips, falls faster and faster, and bounces on the ground before it settles flat.
const STEP = 1 / 240;
const RAD = Math.PI / 180;
function swing(accel, angle, speed, stop) {
  const out = [];
  for (let t = 0; t < 4; t += STEP) {
    speed += accel(angle) * STEP;
    angle += speed * STEP;
    const next = stop(angle, speed);
    if (next === null) break;
    [angle, speed] = next;
    out.push(angle / RAD);
  }
  return out;
}
const ROOF_PULL = 12; // gravity on a roof half (rad/s^2)
const ROOF = swing((a) => -ROOF_PULL * Math.cos(a), 0, Math.sqrt(2 * ROOF_PULL) * 1.08, (a, s) => (a >= 270 * RAD ? null : [a, s]));
const WALL_START = 0.6; // the front walls start to tip as the roof halves stand up
const WALL_PULL = 14;
const WALL_BOUNCE = 0.38; // of its speed it keeps, bouncing off the ground
const WALL = swing((a) => WALL_PULL * Math.sin(Math.max(a, 0.02)), 0, 0.6, (a, s) => {
  if (a < 90 * RAD) return [a, s];
  return s < 0.6 ? null : [90 * RAD, -s * WALL_BOUNCE];
});
const ROOF_THICK = 0.3; // metres
const CALM = matchMedia("(prefers-reduced-motion: reduce)");
// the camera looks down 30 degrees from the front corner: a front wall leaning out further than this shows its
// inside, a roof half lifted further than this its underside
const CAMERA = [Math.cos(Math.PI / 6) / Math.SQRT2, Math.cos(Math.PI / 6) / Math.SQRT2, Math.sin(Math.PI / 6)];
const WALL_FLIP = (Math.atan(CAMERA[0] / CAMERA[2]) * 180) / Math.PI;
const ROOF_FLIP = (Math.atan(CAMERA[2] / CAMERA[0]) * 180) / Math.PI;
const LIGHT = (() => {
  const l = [0.55, 0.2, 0.81]; // art/iso/gym's light
  const n = Math.hypot(...l);
  return l.map((x) => x / n);
})();
const EDGE = ["#532837", "#6e3b3c", "#8b4541", "#a0574b"]; // the walls' cut edges, dark to light (iso_bake "slab")
const EDGE_LINE = "#1e0418";
const CEILING = "#403751";
const LINE = 5; // one art pixel, in court pixels

let set = null; // the court's box, once loaded: { src, box, images: Map(src -> img), wallHeight, thick }
let loading = null;
// `start`: when it began opening (Infinity: shut, waiting for START; -Infinity: open). `onOpen`: called as it opens
const box = { start: -Infinity, onOpen: null };

/** Loads the court's box (content/courts.js `panels`), if it has one. */
export function loadPanels(def) {
  if (!def.panels) {
    set = null;
    return Promise.resolve();
  }
  if (set?.src === def.panels || loading?.src === def.panels) return loading?.done ?? Promise.resolve();
  const src = def.panels;
  const done = fetch(src)
    .then((r) => r.json())
    .then(async (info) => {
      const parts = [...Object.values(info.box), info.street].filter(Boolean);
      const images = new Map(await Promise.all(parts.map(async (p) => [p.image, await loadImage(p.image)])));
      if (loading?.src === src) set = { src, box: info.box, street: info.street, slab: info.slab ?? 0, images, wallHeight: info.wallHeight, thick: info.wallThick };
    })
    .catch(() => {
      if (loading?.src === src) loading = null; // tried again next time (shutBox)
    });
  loading = { src, done };
  return done;
}

export const hasPanels = () => !!set && set.src === court.panels;
const since = () => (performance.now() - box.start) / 1000;
const TOTAL = WALL_START + WALL.length * STEP;

/** Starts a game shut, waiting for START; `onOpen` runs as it opens (straight away if the court has no box). */
export function shutBox(onOpen) {
  if (!hasPanels()) loadPanels(court); // not in yet (or it failed): this game starts open, the next won't
  if (!hasPanels()) {
    box.start = -Infinity;
    onOpen?.();
    return;
  }
  box.start = Infinity;
  box.onOpen = onOpen;
}

/** Shut, with nothing waiting on it (the title and the menus). */
export function showShut() {
  if (box.start === Infinity) return;
  box.start = Infinity;
  box.onOpen = null;
}

/** START: opens it. */
export function openBox() {
  if (box.start !== Infinity) return;
  box.start = CALM.matches ? -Infinity : performance.now();
  const go = box.onOpen;
  box.onOpen = null;
  go?.();
}

/** Takes it away (out of a game). */
export function setOpen() {
  box.start = -Infinity;
  box.onOpen = null;
}

/** Shut, waiting for START. */
export const waiting = () => box.start === Infinity;
/** Shut or still opening: the clock waits and no shot can start. */
export const opening = () => waiting() || since() < TOTAL;
/** Whether any of the box is there: shut, opening, or its walls lying on the ground. */
export const boxShowing = () => hasPanels() && box.start !== -Infinity;

// how far each roof half has turned up and over (degrees) and the front walls out (degrees), now
function now() {
  if (box.start === Infinity) return { roof: 0, wall: 0 };
  const t = box.start === -Infinity ? Infinity : since();
  const at = (curve, s, end) => (s < 0 ? 0 : s / STEP >= curve.length ? end : curve[Math.floor(s / STEP)]);
  return { roof: at(ROOF, t, 270), wall: at(WALL, t - WALL_START, 90) };
}

// ---------- transforms ----------

// The affine map that turns a panel `deg` degrees about its hinge: `along` is one metre along the hinge on
// screen, `rest` one metre across the panel (away from the hinge) as it is in its picture, `to` one metre in the
// direction it turns towards. Returns [a, b, c, d, e, f] for ctx.transform, about the hinge point `at`.
function turnAbout(at, along, rest, to, deg) {
  const r = (deg * Math.PI) / 180;
  const now = { x: rest.x * Math.cos(r) + to.x * Math.sin(r), y: rest.y * Math.cos(r) + to.y * Math.sin(r) };
  // A = [along now] [along rest]^-1
  const det = along.x * rest.y - rest.x * along.y;
  const inv = [rest.y / det, -rest.x / det, -along.y / det, along.x / det]; // [[i00, i01], [i10, i11]]
  const a = along.x * inv[0] + now.x * inv[2];
  const c = along.x * inv[1] + now.x * inv[3];
  const b = along.y * inv[0] + now.y * inv[2];
  const d = along.y * inv[1] + now.y * inv[3];
  return [a, b, c, d, at.x - (a * at.x + c * at.y), at.y - (b * at.x + d * at.y)];
}

const UP = () => ({ x: 0, y: -PX_PER_M });
const moved = ([a, b, c, d, e, f], dx, dy) => [a, b, c, d, e + dx, f + dy]; // then moved on screen
const after = ([a, b, c, d, e, f], sx, sy) => [a, b, c, d, a * sx + c * sy + e, b * sx + d * sy + f]; // moved first

// A front wall ("left": along the floor's far u edge, falling out towards +u; "right": the far v edge, towards +v)
// is a slab `thick` thick behind its inside face, turning about the inside face's foot. A point on it, `a` metres
// along (from the back), `t` out through its thickness, `h` up its face, at `deg` out from upright, in game metres.
function wallPoint(side, a, t, h, deg) {
  const r = (deg * Math.PI) / 180;
  const out = t * Math.cos(r) + h * Math.sin(r);
  const z = h * Math.cos(r) - t * Math.sin(r);
  return side === "left" ? project(ROOM_U + out, a, z) : project(a, ROOM_V + out, z);
}

function wallFrame(side) {
  return side === "left" ? { foot: project(ROOM_U, 0), along: EV, out: EU } : { foot: project(0, ROOM_V), along: EU, out: EV };
}

// the inside face (a plain wall picture standing at the back, moved to the front)
function insideTransform(side, deg) {
  const { foot, along, out } = wallFrame(side);
  const m = turnAbout(foot, along, UP(), out, deg);
  const room = side === "left" ? ROOM_U : ROOM_V;
  return after(m, room * out.x, room * out.y);
}

// the outside face (baked standing where it is, `thick` out from the inside face)
function outsideTransform(side, deg) {
  const { along, out } = wallFrame(side);
  const T = set.thick;
  const footOut = side === "left" ? project(ROOM_U + T, 0) : project(0, ROOM_V + T);
  const m = turnAbout(footOut, along, UP(), out, deg);
  // its foot swings down and in as the wall turns about the inside face's foot
  const to = wallPoint(side, 0, T, 0, deg);
  return moved(m, to.x - footOut.x, to.y - footOut.y);
}

// ---------- drawing ----------

function drawPart(ctx, part, m, clip) {
  const img = set.images.get(part.image);
  if (!img) return;
  ctx.save();
  if (m) ctx.transform(...m);
  if (clip) clip(ctx);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, part.at[0], part.at[1]);
  ctx.restore();
}

function face(ctx, pts, colour) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.lineWidth = LINE;
  ctx.lineJoin = "round";
  ctx.strokeStyle = EDGE_LINE;
  ctx.stroke();
}

// a face's colour from which way it points (game axes), lit like the art
const shade = (n) => EDGE[Math.max(0, Math.min(EDGE.length - 1, Math.round((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2] + 0.2) * 3)))];
const seen = (n) => n[0] * CAMERA[0] + n[1] * CAMERA[1] + n[2] * CAMERA[2] > 0.01;

function drawWall(ctx, side, deg) {
  const T = set.thick, H = set.wallHeight;
  const len = (side === "left" ? ROOM_V : ROOM_U) + (side === "left" ? T : 0); // the left wall covers the corner
  const r = (deg * Math.PI) / 180;
  const swap = (n) => (side === "left" ? n : [n[1], n[0], n[2]]);
  // its far edge (the top, when standing) and its front end, where they face the camera
  const top = swap([Math.sin(r), 0, Math.cos(r)]);
  if (seen(top)) face(ctx, [wallPoint(side, 0, 0, H, deg), wallPoint(side, len, 0, H, deg), wallPoint(side, len, T, H, deg), wallPoint(side, 0, T, H, deg)], shade(top));
  const end = swap([0, 1, 0]);
  face(ctx, [wallPoint(side, len, 0, 0, deg), wallPoint(side, len, T, 0, deg), wallPoint(side, len, T, H, deg), wallPoint(side, len, 0, H, deg)], shade(end));
  const b = set.box;
  const key = side === "left" ? "Left" : "Right";
  if (deg < WALL_FLIP) drawPart(ctx, b[`out${key}`], outsideTransform(side, deg));
  else {
    // the left wall runs on past the room to cover the corner, beyond its inside picture: brick there too
    if (side === "left") {
      const pts = [wallPoint(side, ROOM_V - 0.05, 0, 0, deg), wallPoint(side, len, 0, 0, deg), wallPoint(side, len, 0, H, deg), wallPoint(side, ROOM_V - 0.05, 0, H, deg)];
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.fillStyle = CORNER_BRICK;
      ctx.fill();
    }
    drawPart(ctx, b[`in${key}`], insideTransform(side, deg));
  }
}
const CORNER_BRICK = "#8b4541"; // the bake's brick, mid tone (tools/pixelart/iso_bake.py)

// a roof half's transform at `deg` turned up and over, about the top of its back wall
function roofTransform(half, deg) {
  const T = set.thick, H = set.wallHeight;
  return half === "hoop" ? turnAbout(project(0, -T, H), EU, EV, UP(), deg) : turnAbout(project(-T, 0, H), EV, EU, UP(), deg);
}

// One roof half ("hoop": over the hoop wall's side of the split, hinged on that wall's top; "side": the other),
// `deg` turned up and over towards the back: a slab ROOF_THICK thick under its top. The split runs from the back
// corner to the front corner, which is straight up and down the screen through the back corner.
function drawRoofHalf(ctx, half, deg) {
  const T = set.thick, H = set.wallHeight;
  const U2 = ROOM_U + T, V2 = ROOM_V + T;
  const hoop = half === "hoop";
  const r = deg * RAD, c = Math.cos(r), s = Math.sin(r);
  // a point of the slab (game metres, as it lies shut) turned with it, on screen; and a direction turned with it.
  // Across is v for the hoop half (hinged along u at v = -T), u for the side half
  const turn = (u, v, z) => {
    const d = (hoop ? v : u) + T, h = z - H;
    const d2 = d * c - h * s, h2 = d * s + h * c;
    return hoop ? project(u, d2 - T, H + h2) : project(d2 - T, v, H + h2);
  };
  const dir = ([nu, nv, nz]) => {
    const d = hoop ? nv : nu;
    const d2 = d * c - nz * s, z2 = d * s + nz * c;
    return hoop ? [nu, d2, z2] : [d2, nv, z2];
  };
  const corners = hoop ? [[-T, -T], [U2, -T], [U2, V2]] : [[-T, -T], [-T, V2], [U2, V2]];
  const top = corners.map(([u, v]) => turn(u, v, H));
  const bottom = corners.map(([u, v]) => turn(u, v, H - ROOF_THICK));
  // its edges, outward: the hinge side, the outside edge, the split
  const edges = hoop ? [[0, 1, [0, -1, 0]], [1, 2, [1, 0, 0]], [2, 0, [-Math.SQRT1_2, Math.SQRT1_2, 0]]] : [[0, 1, [-1, 0, 0]], [1, 2, [0, 1, 0]], [2, 0, [Math.SQRT1_2, -Math.SQRT1_2, 0]]];
  ctx.save();
  if (deg > 90) {
    // over the back: what's dropped below its wall's top is hidden behind the wall
    const a = project(-T, -T, H), b = hoop ? project(U2, -T, H) : project(-T, V2, H);
    const dx = (b.x - a.x) * 50, dy = (b.y - a.y) * 50;
    ctx.beginPath();
    ctx.moveTo(a.x - dx, a.y - dy);
    ctx.lineTo(b.x + dx, b.y + dy);
    ctx.lineTo(b.x + dx, -1e5);
    ctx.lineTo(a.x - dx, -1e5);
    ctx.clip();
  }
  if (deg > 0.5) {
    for (const [i, j, n] of edges) {
      const nn = dir(n);
      if (seen(nn)) face(ctx, [top[i], top[j], bottom[j], bottom[i]], shade(nn));
    }
  }
  if (seen(dir([0, 0, 1]))) {
    const splitX = project(0, 0).x;
    drawPart(ctx, set.box.lid, roofTransform(half, deg), (g) => {
      g.beginPath();
      g.rect(hoop ? -1e4 : splitX, -1e4, 1e4 + (hoop ? splitX : 0), 2e4);
      g.clip();
    });
  } else face(ctx, bottom, CEILING); // its underside: the gym's ceiling
  ctx.restore();
}

/** Draws the street round the court (court pixels), behind it, while the box shows; false if it has none. */
export function drawStreet(ctx) {
  const st = boxShowing() && set.street;
  const img = st && set.images.get(st.image);
  if (!img) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, st.at[0], st.at[1], img.width * st.scale, img.height * st.scale);
  return true;
}

/** Draws what there is of the box, in court pixels (ctx already set up for them). */
export function drawBox(ctx) {
  if (!boxShowing()) return;
  const { roof, wall } = now();
  // the gym stands on the street, level with its floor: the street covers the sides of the floor slab (drawn in
  // the court picture, under this canvas)
  if (set.street && set.slab) {
    const S = set.slab + 6 / PX_PER_M; // and the outline under it
    ctx.save();
    ctx.beginPath();
    for (const q of [[project(ROOM_U, 0), project(ROOM_U, ROOM_V), project(ROOM_U, ROOM_V, -S), project(ROOM_U, 0, -S)],
      [project(0, ROOM_V), project(ROOM_U, ROOM_V), project(ROOM_U, ROOM_V, -S), project(0, ROOM_V, -S)]]) {
      q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x - 6, p.y)));
      ctx.closePath();
    }
    ctx.clip();
    drawStreet(ctx);
    ctx.restore();
  }
  drawWall(ctx, "right", wall);
  drawWall(ctx, "left", wall);
  if (roof < 270) for (const half of ["hoop", "side"]) drawRoofHalf(ctx, half, roof);
}

/** A key that changes whenever the box looks different (so its canvas is only redrawn then). */
export const boxKey = () => {
  const { roof, wall } = now();
  return `${set?.src}|${box.start === -Infinity ? "open" : `${roof.toFixed(2)}|${wall.toFixed(2)}`}`;
};

/**
 * Where a point is on screen now (court pixels), on the roof (`side` "roof": metres along u and v) or on a front
 * wall's inside ("left" or "right": metres along it from the back, metres up its face), and the surface's two
 * directions there, one metre each: `along` (u on the roof; towards the front corner on a wall) and `out` (v on
 * the roof; away from the wall's foot).
 */
export function onBox(side, along, out) {
  if (side === "roof") {
    // on the roof's side half (v > u), turning with it; `up`: whether its top still faces the camera
    const deg = now().roof;
    const m = roofTransform("side", deg);
    const lin = (q) => ({ x: m[0] * q.x + m[2] * q.y, y: m[1] * q.x + m[3] * q.y });
    const p = project(along, out, set.wallHeight);
    const at = lin(p);
    return { at: { x: at.x + m[4], y: at.y + m[5] }, along: lin(EU), out: lin(EV), up: deg < ROOF_FLIP };
  }
  const deg = now().wall;
  const at = wallPoint(side, along, 0, out, deg);
  const o = wallPoint(side, along, 0, out + 1, deg);
  const a = wallPoint(side, along + 1, 0, out, deg);
  return { at, along: { x: a.x - at.x, y: a.y - at.y }, out: { x: o.x - at.x, y: o.y - at.y } };
}
