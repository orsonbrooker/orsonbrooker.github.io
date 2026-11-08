// Orson on the home page: his idle animation from the game's sprite sheet, drawn on a canvas.

import { API } from "../api.js";

const canvas = document.getElementById("orson");
const ctx = canvas.getContext("2d");

const [meta, img] = await Promise.all([
  fetch("/assets/sprites.json").then((r) => r.json()),
  new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = "/assets/sprites.webp";
  }),
]);

// Frames are [x, y, w, h, offsetX, offsetY], with offsets from the point between his feet.
const frames = meta.frames.idle;
const left = Math.min(...frames.map((f) => f[4]));
const top = Math.min(...frames.map((f) => f[5]));
const right = Math.max(...frames.map((f) => f[4] + f[2]));
const bottom = Math.max(...frames.map((f) => f[5] + f[3])); // shoes reach a little below the floor point
canvas.width = right - left;
canvas.height = bottom - top;

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
let frame = 0;
function draw() {
  const [x, y, w, h, ox, oy] = frames[frame];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, x, y, w, h, ox - left, oy - top, w, h);
  frame = (frame + 1) % frames.length;
}
draw();
if (!still) setInterval(draw, 260);

// The leaderboard tile shows who's on top this week.
fetch(`${API}/scores?range=week`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
  .then(({ scores }) => {
    const top = scores[0];
    // Nicknames are typed by visitors: set as text, never HTML.
    document.getElementById("top-score").textContent = top ? `#1 this week: ${top.nickname} with ${top.score}` : "Be first on it this week!";
  })
  .catch(() => {});
