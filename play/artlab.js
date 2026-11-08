// Art test (only with ?artlab in the URL): draws a pixel-art test body beside the player, copying his
// animation, so the new art can be compared with the current art on the real court.
//   ?artlab or ?artlab=spiky  the current Spiky body converted to true pixel art (tools/pixelart/)
//   ?artlab=rookie            the 3D-rendered test body (tools/art3d/)
//
// Two copies: the body's own colours (with its hair layer, if it has one), and one recoloured by
// palette swap (wearing the cap layer, if it has one). Both are drawn at a whole number of screen pixels per art pixel, on whole screen pixels,
// so the pixels stay square and sharp at any canvas size.

import { paletteSwap } from "../players/pixelkit.js";
import { ANIM_FPS, JUMP_FRAME_TIME, player } from "./state.js";

const PARAM = new URLSearchParams(location.search).get("artlab");
const ON = PARAM !== null;
const ROOT = `assets/characters/lab/${/^[a-z0-9]+$/.test(PARAM ?? "") ? PARAM : "spiky"}/`;
const ART_PX = 4; // court pixels per art pixel
let lab = null;

async function load() {
  const meta = await fetch(ROOT + "sprites.json").then((r) => r.json());
  const files = { body: "sprites.png", ...meta.layers };
  const imgs = {};
  await Promise.all(
    Object.keys(files).map(
      (k) =>
        new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve((imgs[k] = i));
          i.onerror = reject;
          i.src = ROOT + files[k];
        }),
    ),
  );
  const swapped = { skin: "#8d5a37", hair: "#26222a", jersey: "#d63a3a", team: "#f2cf3d", shoes: "#f2f2ef", cap: "#3fa65c", capteam: "#f2f2ef" };
  lab = {
    meta,
    looks: [
      { body: meta.prints ? paletteSwap(imgs.body, meta, {}, { number: 28, team: "Kings" }) : imgs.body, layers: imgs.hair ? [imgs.hair] : [] },
      {
        body: paletteSwap(imgs.body, meta, swapped, { number: 7, team: "Hawks" }),
        layers: imgs.cap ? [paletteSwap(imgs.cap, meta, swapped)] : [],
      },
    ],
  };
}
if (ON) load().catch((e) => console.warn("artlab:", e));

// The same frame choice as currentFrame() in players.js, from the test body's frames.
function frame() {
  const frames = lab.meta.frames[player.anim] ?? lab.meta.frames.idle;
  let i;
  const own = lab.meta.fps?.[player.anim]; // a timeline made by code: more frames in the same time
  if (own) i = Math.floor(player.t * own) % (player.anim === "idle" || player.anim === "dribble" ? frames.length : Infinity);
  else if (player.anim === "jump") i = Math.floor(player.t / JUMP_FRAME_TIME);
  else if (player.anim === "idle" || player.anim === "dribble") i = Math.floor(player.t * ANIM_FPS[player.anim]) % frames.length;
  else i = Math.floor(player.t * (ANIM_FPS[player.anim] ?? 10));
  return frames[Math.min(i, frames.length - 1)];
}

// Draws the test bodies standing to the player's right, feet on the same line as his (p, court pixels).
export function drawArtLab(ctx, p) {
  if (!ON || !lab) return;
  const [sx, sy, w, h, ox, oy] = frame();
  const m = ctx.getTransform();
  // Whole screen pixels per art pixel: 4 at full size, fewer on smaller canvases, never blurry.
  const n = Math.max(1, Math.round(ART_PX * m.a));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = Math.max(0, player.fade);
  lab.looks.forEach((look, k) => {
    const fx = Math.round(m.a * (p.x + 230 + k * 210) + m.e);
    const fy = Math.round(m.d * p.y + m.f);
    const print = look.body.printLayers?.get(`${sx},${sy}`); // number and team name, finer than the art
    for (const img of [look.body, ...look.layers, ...(print ? [print] : [])]) {
      const k = img === print ? img.width / w : 1;
      ctx.drawImage(img, img === print ? 0 : sx, img === print ? 0 : sy, w * k, h * k, fx + ox * n, fy + oy * n, w * n, h * n);
    }
  });
  // A slow turnaround through the body's angles, if it has them: the drawn ones, then the same ones
  // mirrored for the other side (8 directions from 5 drawings).
  const spin = lab.meta.frames.spin;
  if (spin) {
    const order = [...spin.map((f) => [f, 1]), ...spin.slice(1, -1).reverse().map((f) => [f, -1])];
    const [[x, y, w2, h2, ox2, oy2], dir] = order[Math.floor(performance.now() / 600) % order.length];
    const fx = Math.round(m.a * (p.x + 230 + lab.looks.length * 210) + m.e);
    const fy = Math.round(m.d * p.y + m.f);
    ctx.translate(fx, fy);
    ctx.scale(dir, 1);
    for (const img of [lab.looks[0].body, ...lab.looks[0].layers]) ctx.drawImage(img, x, y, w2, h2, ox2 * n, oy2 * n, w2 * n, h2 * n);
  }
  ctx.restore();
}
