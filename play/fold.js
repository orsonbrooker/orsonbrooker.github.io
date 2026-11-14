// The court as a box of folding panels (docs/art/isometric.md "Courts are made of panels"): at the start of a
// game the two walls rise from lying flat behind the floor, carrying what hangs on them, and the props on the
// floor stand up; in Free play the walls only come half way up, and carry the joystick and shoot button.
//
// The panels and props are the court's own pictures (content/courts.js `panels`: a panels.json that
// tools/pixelart/iso_export.py writes). While a wall isn't upright, play/scene.js hides the court picture and
// draws them here instead.
//
// A panel turning about its hinge, seen through the court's camera (orthographic), is the same picture with
// an affine transform: along the hinge nothing moves, and the wall's "up" (one metre up: Z on screen) turns
// towards lying flat (one metre out from the hinge along the floor). So each frame a wall is one drawImage.

import { COURT_PX, EU, EV, PX_PER_M, court, project, unprojectFloor } from "../engine/court.js";
import { loadImage } from "../engine/download.js";

const RISE_SECONDS = 1.1; // the walls coming up at the start of a game
const PROP_DELAY = 0.35; // the floor's props start standing up this far into it
export const HALF_WAY = 45; // degrees back from upright: Free play's walls
const CALM = matchMedia("(prefers-reduced-motion: reduce)");

let set = null; // the court's panels, once loaded: { src, info, images: Map(src -> img) }
let loading = null;
const fold = { from: 0, to: 0, start: 0, seconds: 0 }; // wall angle, degrees back from upright

/** Loads the court's panels (content/courts.js `panels`), if it has them. */
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
      const free = info.free ? [info.free.floor, info.free.walls.hoop, info.free.walls.side] : [];
      const all = [info.floor, info.contestFloor, info.walls.hoop, info.walls.side, info.poleHoop, ...free, ...info.props].filter(Boolean);
      const images = new Map(await Promise.all(all.map(async (p) => [p.image, await loadImage(p.image)])));
      if (loading?.src === src) set = { src, info, images };
    })
    .catch(() => {
      if (loading?.src === src) loading = null; // tried again next time (riseTo)
    });
  loading = { src, done };
  return done;
}

const angleNow = (now = performance.now()) => {
  const t = fold.seconds > 0 ? Math.min(1, (now - fold.start) / 1000 / fold.seconds) : 1;
  // ease out, with a little settle at the end
  const e = 1 - Math.pow(1 - t, 3);
  return fold.from + (fold.to - fold.from) * e;
};

/** Starts a game's walls: from lying flat up to `to` degrees back (0 upright, HALF_WAY for Free play). */
export function riseTo(to) {
  if (!hasPanels()) loadPanels(court); // not in yet (or it failed): this game starts with the walls up, the next won't
  if (!hasPanels() || CALM.matches) {
    Object.assign(fold, { from: to, to, start: 0, seconds: 0 });
    return;
  }
  Object.assign(fold, { from: 90, to, start: performance.now(), seconds: RISE_SECONDS });
}

/** Puts the walls straight to `to` degrees (0: upright, the court picture as it is). */
export function setWalls(to = 0) {
  Object.assign(fold, { from: to, to, start: 0, seconds: 0 });
}

/** The walls are still moving: the clock waits and no shot can start. */
export const rising = () => fold.seconds > 0 && performance.now() - fold.start < fold.seconds * 1000;

/** The court has to be drawn from its panels (a wall isn't upright, or is moving). */
export const folded = () => hasPanels() && (rising() || angleNow() > 0.01);

/** Whether the hoop on its post stands in for the wall's hoop (the walls rest folded back: Free play). */
const onPost = () => fold.to > 0;

// ---------- transforms ----------

// The affine map that turns a panel `deg` degrees from upright about its hinge: `along` is one metre along the
// hinge on screen, `up` one metre up the panel when upright, `flat` one metre along the floor away from the
// hinge, where the panel lies once it's down. Returns [a, b, c, d, e, f] for ctx.transform about `at`.
function turnAbout(at, along, up, flat, deg) {
  const r = (deg * Math.PI) / 180;
  const up2 = { x: up.x * Math.cos(r) + flat.x * Math.sin(r), y: up.y * Math.cos(r) + flat.y * Math.sin(r) };
  // A = [along up2] [along up]^-1
  const det = along.x * up.y - up.x * along.y;
  const inv = [up.y / det, -up.x / det, -along.y / det, along.x / det]; // [[i00, i01], [i10, i11]]
  const a = along.x * inv[0] + up2.x * inv[2];
  const c = along.x * inv[1] + up2.x * inv[3];
  const b = along.y * inv[0] + up2.y * inv[2];
  const d = along.y * inv[1] + up2.y * inv[3];
  return [a, b, c, d, at.x - (a * at.x + c * at.y), at.y - (b * at.x + d * at.y)];
}

const UP = () => ({ x: 0, y: -PX_PER_M });
const neg = (p) => ({ x: -p.x, y: -p.y });

/** The transform for something on a wall ("wall-hoop" or "wall-side") at `deg` degrees back. */
export function wallTransform(on, deg = angleNow()) {
  const o = project(0, 0);
  return on === "wall-hoop" ? turnAbout(o, EU, UP(), neg(EV), deg) : turnAbout(o, EV, UP(), neg(EU), deg);
}

// A floor prop lies flat about its hinge (two court pixels on the floor), away from its foot.
function propTransform(p, deg) {
  const [h0, h1] = p.hinge.map(([x, y]) => unprojectFloor(x, y));
  const len = Math.hypot(h1.u - h0.u, h1.v - h0.v) || 1;
  const du = (h1.u - h0.u) / len, dv = (h1.v - h0.v) / len;
  let nu = -dv, nv = du; // across the hinge, along the floor
  if ((p.foot[0] - h0.u) * nu + (p.foot[1] - h0.v) * nv > 0) [nu, nv] = [-nu, -nv]; // away from the prop
  const along = { x: du * EU.x + dv * EV.x, y: du * EU.y + dv * EV.y };
  const flat = { x: nu * EU.x + nv * EV.x, y: nu * EU.y + nv * EV.y };
  return turnAbout(project(h0.u, h0.v), along, UP(), flat, deg);
}

function drawPart(ctx, part, m) {
  const img = set.images.get(part.image);
  if (!img) return;
  ctx.save();
  if (m) ctx.transform(...m);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, part.at[0], part.at[1]);
  ctx.restore();
}

/**
 * Draws the court from its panels, under everything else on the canvas. `contest`: the 3-point contest's floor.
 * `onWall(on)`: the scene draws something of its own (the scoreboard) on that wall, folded with it.
 */
// The walls at rest (Free play's half-folded walls stay put all game) are drawn once into a picture the size of the
// canvas and reused, until the angle, the court, the floor or the canvas changes.
let still = null; // { key, canvas }

export function drawCourt(ctx, opts = {}) {
  const deg = angleNow();
  if (rising()) return drawParts(ctx, opts, deg);
  const k = ctx.canvas.width / COURT_PX;
  const key = `${set.src}|${!!opts.contest}|${deg.toFixed(2)}|${ctx.canvas.width}`;
  if (still?.key !== key) {
    const canvas = still?.canvas ?? document.createElement("canvas");
    canvas.width = canvas.height = ctx.canvas.width;
    const g = canvas.getContext("2d");
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, COURT_PX, COURT_PX);
    drawParts(g, { ...opts, onWall: () => {} }, deg);
    still = { key, canvas };
  }
  ctx.drawImage(still.canvas, 0, 0, COURT_PX, COURT_PX);
  // what the scene hangs on a wall (the scoreboard) changes, so it's drawn fresh
  for (const on of ["wall-hoop", "wall-side"]) {
    ctx.save();
    ctx.transform(...wallTransform(on, deg));
    opts.onWall?.(on);
    ctx.restore();
  }
}

function drawParts(ctx, { contest = false, onWall = () => {} } = {}, deg) {
  const { info } = set;
  const now = performance.now();
  // the floor's props stand up a little after the walls start, and finish with them
  const t = fold.seconds > 0 ? Math.min(1, (now - fold.start) / 1000 / fold.seconds) : 1;
  const pt = Math.max(0, Math.min(1, (t - PROP_DELAY / fold.seconds) / (1 - PROP_DELAY / fold.seconds)));
  const propDeg = fold.from === 90 && fold.seconds > 0 ? 90 * Math.pow(1 - pt, 3) : 0;
  // in the order the bake lays them out (panels.json): the floor, the walls with what hangs on them, the floor's props
  // Free play's own floor and walls (the post hoop's shadow and glass) while the hoop's on its post
  const own = onPost() && info.free ? info.free : info;
  drawPart(ctx, contest && info.contestFloor ? info.contestFloor : own.floor);
  for (const on of ["wall-hoop", "wall-side"]) {
    const m = wallTransform(on, deg);
    drawPart(ctx, own.walls[on === "wall-hoop" ? "hoop" : "side"], m);
    for (const p of info.props) if (p.on === on && !(onPost() && p.id === "hoop")) drawPart(ctx, p, m);
    ctx.save();
    ctx.transform(...m);
    onWall(on);
    ctx.restore();
  }
  if (onPost() && info.poleHoop) drawPart(ctx, info.poleHoop);
  for (const p of info.props) if (p.on === "floor" && !(contest && p.id.startsWith("rack-"))) drawPart(ctx, p, propDeg > 0.01 ? propTransform(p, propDeg) : null);
}

/** Where a point on a wall (along it and up it, metres) is on screen now, and the wall's directions there. */
export function onWallNow(on, along, up, deg = angleNow()) {
  const m = wallTransform(on, deg);
  const p = on === "wall-hoop" ? project(along, 0, up) : project(0, along, up);
  const at = { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
  const dir = on === "wall-hoop" ? EU : EV;
  const u = UP();
  return {
    at,
    along: { x: m[0] * dir.x + m[2] * dir.y, y: m[1] * dir.x + m[3] * dir.y },
    up: { x: m[0] * u.x + m[2] * u.y, y: m[1] * u.x + m[3] * u.y },
  };
}

export const wallsAngle = () => angleNow();
export const hasPanels = () => !!set && set.src === court.panels;
