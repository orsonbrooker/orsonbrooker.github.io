// The player builder: pick a body and colours, watch them dribble and shoot, send it to Orson.
// Players wait for approval in /admin before they show up in the game's player picker.
// Open with ?base=curly&skin=c98c5f&hair=26222a&jersey=d63a3a&team=2b2b2f&shoes=f2f2ef&number=7&teamName=KINGS&name=Ace
// to preload a look.
// A kid made from their own videos (Curly, Buns) moves as in the game, all the way round, and their size
// (height and build) can be set; &height=1&bulk=-0.5 starts at a size. &gear=beanie,stripes tries gear on
// them (content/gear.json), saved with the player for the game.

import { API } from "../api.js";
import { markField, say } from "../ui/form.js";
import { makeBallSprites } from "../engine/draw.js";
import { paletteSwap } from "../players/pixelkit.js";
import { gearParam, loadGear, wearGear } from "../players/gear.js";
import { stretchSheet } from "../players/stretch.js";
import { NORMAL } from "../shared/rules.js";
import { DEFAULT_TEAM, loadBase, loadBases, myPlayers, PALETTES, PARTS, recolor, saveMyPlayer, thumbnail } from "../players/recolor.js";


// Preview loop: [animation, frames per second, times to repeat].
// The preview's loop: standing, then a dribble and a shot facing each way the sheet has (a hand-drawn
// body has the front only; a kid from video turns all the way round), so every side can be checked.
const SIDES = ["", "-fr", "-r", "-br", "-b", "-bl", "-l", "-fl"];
function showSteps(frames) {
  const steps = [["idle", 3, 2]];
  for (const side of SIDES) {
    if (!frames[`release${side}`]) continue;
    steps.push(
      [`dribble${side}`, 14, 2],
      [`gather${side}`, 24, 1],
      [`jump${side}`, 1 / 0.085, 1],
      [`release${side}`, 16, 1],
      [`release${side}`, 1, 0.8, "hold"],
      [`recover${side}`, 14, 1],
    );
  }
  return steps
    .filter(([anim]) => frames[anim])
    .map(([anim, fps, repeats, how]) => {
      const list = how === "hold" ? [frames[anim].at(-1)] : frames[anim];
      return { anim, list, fps, length: (list.length / fps) * repeats };
    });
}

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const form = document.getElementById("form");
const nameInput = document.getElementById("name");
const numberInput = document.getElementById("number");
const teamInput = document.getElementById("team-name");
const message = document.getElementById("message");
const send = document.getElementById("send");
const previewName = document.getElementById("preview-name");
const previewFace = document.getElementById("preview-face");
const sizeBox = document.getElementById("size");
const heightInput = document.getElementById("height");
const bulkInput = document.getElementById("bulk");

const params = new URLSearchParams(location.search);
let bases = [];
let current; // the loaded base
// what the preview draws: { meta, img, prints }, the body's sheet in their colours (and size)
let sheet;
let ballSprites = null; // the held ball, made when first needed
const colours = {};
const picked = new Set(); // parts the player has chosen a colour for, kept when they switch bodies
const build = { height: 0, bulk: 0 };
const gear = gearParam(params.get("gear")); // { slot: item } (a test link, until the builder can pick gear)
let worn = []; // the gear's layers for the current body


function button(props, ...children) {
  const b = Object.assign(document.createElement("button"), { type: "button", ...props });
  b.append(...children);
  return b;
}

function press(group, chosen) {
  for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === chosen));
}

// A video kid's pixel-art twin, whose jersey faces print the number and team name (as in the game).
const twins = new Map();
function loadTwin({ atlas, meta }) {
  if (!twins.has(meta)) {
    const img = new Promise((resolve, reject) => Object.assign(new Image(), { onload() { resolve(this); }, onerror: reject, src: "/" + atlas }));
    const p = Promise.all([fetch("/" + meta).then((r) => r.json()), img]).then(([pm, pimg]) => ({ pm, pimg }));
    p.catch(() => twins.delete(meta));
    twins.set(meta, p);
  }
  return twins.get(meta);
}

async function chooseBase(base, keepColours) {
  current = await loadBase(base);
  if (base.video && current.meta.printsFrom) current.twin ??= await loadTwin(current.meta.printsFrom).catch(() => null);
  // A new body brings its own colours for anything the player hasn't picked yet; their picks stay.
  if (!keepColours) for (const part of PARTS) if (!picked.has(part)) colours[part] = base.colours[part];
  for (const part of PARTS) markSwatch(part);
  sizeBox.hidden = !current.video;
  worn = current.video ? await loadGear(base.id, gear).catch(() => []) : [];
  repaint();
}

function markSwatch(part) {
  const group = document.querySelector(`[data-part="${part}"]`);
  for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.colour === colours[part]));
}

// A video kid's number and team name for each of their frames, from the twin's jersey faces.
function twinPrints() {
  if (!current.twin) return null;
  const parts = Object.fromEntries(PARTS.map((p) => [p, colours[p]]));
  const kit = { number: colours.number ?? "", team: colours.teamName ?? DEFAULT_TEAM };
  const layers = paletteSwap(current.twin.pimg, current.twin.pm, parts, kit).printLayers ?? new Map();
  const prints = new Map();
  for (const [key, pixelKey] of Object.entries(current.meta.printsFrom.frames)) if (layers.has(pixelKey)) prints.set(key, layers.get(pixelKey));
  return prints;
}

let repaintQueued = false;
function repaint() {
  if (repaintQueued) return;
  repaintQueued = true;
  requestAnimationFrame(() => {
    repaintQueued = false;
    if (current.video) {
      // their gear on, then their height and build
      const dressed = wearGear({ meta: current.meta, img: recolor(current, colours), prints: twinPrints(), regions: current.regionsData }, worn, colours);
      sheet = stretchSheet(dressed, dressed.regions, build);
    } else sheet = { meta: current.meta, img: recolor(current, colours), prints: null };
    previewFace.src = thumbnail(current, colours, 48).toDataURL(); // the body's card picture, in their colours
  });
}

// ---------- Choices ----------

async function setup() {
  bases = await loadBases();
  const basesBox = document.getElementById("bases");
  for (const base of bases) {
    const img = Object.assign(document.createElement("img"), { src: "/" + base.thumb, alt: "" });
    const b = button({ ariaLabel: base.name }, img, base.name);
    b.addEventListener("click", () => {
      press(basesBox, b);
      chooseBase(base, false);
    });
    basesBox.append(b);
  }

  for (const part of PARTS) {
    const group = document.querySelector(`[data-part="${part}"]`);
    for (const colour of PALETTES[part]) {
      const b = button({ ariaLabel: `${part} ${colour}` });
      b.dataset.colour = colour;
      b.style.background = colour;
      b.addEventListener("click", () => {
        colours[part] = colour;
        picked.add(part);
        markSwatch(part);
        repaint();
      });
      group.append(b);
    }
  }

  // Height and build: pixel sliders with five big steps (a notch for each), snapping as they're dragged.
  const STEPS = [-1, -0.5, 0, 0.5, 1];
  const WORDS = { height: ["Shortest", "Shorter", "Middle", "Taller", "Tallest"], bulk: ["Slimmest", "Slimmer", "Middle", "Broader", "Broadest"] };
  for (const [input, part] of [[heightInput, "height"], [bulkInput, "bulk"]]) {
    const v = Number(params.get(part));
    const start = Number.isFinite(v) && params.has(part) ? STEPS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)) : 0;
    const track = input.parentElement;
    for (let i = 0; i < STEPS.length; i++) {
      const notch = document.createElement("span");
      notch.style.setProperty("--i", String(i));
      track.prepend(notch);
    }
    const show = () => {
      const i = Number(input.value);
      build[part] = STEPS[i];
      input.setAttribute("aria-valuetext", WORDS[part][i]);
      track.style.setProperty("--i", String(i));
    };
    input.value = String(STEPS.indexOf(start));
    show();
    const choose = (i) => {
      if (String(i) === input.value) return;
      input.value = String(i);
      show();
      repaint();
    };
    input.addEventListener("input", () => {
      show();
      repaint();
    });
    // Dragging is done here, not left to the browser: phones (iPhone Safari especially) only drag a
    // range input from exactly on its handle, so a finger anywhere on the slider moves it to the
    // nearest step and follows sideways. Up-and-down still scrolls the page (touch-action in the CSS).
    const stepAt = (x) => {
      const r = input.getBoundingClientRect();
      const thumb = 24; // --thumb in builder.css
      const f = (x - r.left - thumb / 2) / Math.max(1, r.width - thumb);
      return Math.max(0, Math.min(STEPS.length - 1, Math.round(f * (STEPS.length - 1))));
    };
    input.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      input.focus();
      input.setPointerCapture(e.pointerId);
      choose(stepAt(e.clientX));
    });
    input.addEventListener("pointermove", (e) => {
      if (input.hasPointerCapture(e.pointerId)) choose(stepAt(e.clientX));
    });
  }

  nameInput.addEventListener("input", checkWords);
  teamInput.addEventListener("input", checkWords);
  const showName = () => {
    const n = colours.number;
    previewName.textContent = [nameInput.value.trim(), n !== "" && n !== undefined ? `#${n}` : ""].filter(Boolean).join(" ");
  };
  nameInput.addEventListener("input", showName);
  teamInput.addEventListener("input", () => {
    teamInput.value = teamInput.value.toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 10);
    colours.teamName = teamInput.value.trim();
    repaint();
  });
  numberInput.addEventListener("input", () => {
    numberInput.value = numberInput.value.replace(/\D/g, "").slice(0, 2);
    colours.number = numberInput.value;
    showName();
    repaint();
  });

  // Start from the link's look, if any, otherwise the first body.
  const start = bases.find((b) => b.id === params.get("base")) ?? bases[0];
  press(basesBox, basesBox.children[bases.indexOf(start)]);
  Object.assign(colours, start.colours);
  for (const part of PARTS) {
    const c = params.get(part);
    if (c && /^[0-9a-f]{6}$/i.test(c)) {
      colours[part] = `#${c.toLowerCase()}`;
      picked.add(part);
    }
  }
  if (/^\d{1,2}$/.test(params.get("number") ?? "")) numberInput.value = colours.number = params.get("number");
  teamInput.value = colours.teamName = (params.get("teamName") ?? DEFAULT_TEAM).toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 10);
  if (params.get("name")) nameInput.value = params.get("name").slice(0, 12);
  showName();
  await chooseBase(start, true);
  requestAnimationFrame(draw);
  setupTurnstile();
}

// ---------- Preview ----------

let started = performance.now();
function draw(now) {
  requestAnimationFrame(draw);
  if (!sheet) return;
  const frames = sheet.meta.frames;
  // Find where we are in the show loop.
  if (sheet.steps?.frames !== frames) sheet.steps = Object.assign(showSteps(frames), { frames });
  const steps = sheet.steps;
  const total = steps.reduce((t, s) => t + s.length, 0);
  let t = ((now - started) / 1000) % total;
  let step = steps[0];
  for (const s of steps) {
    if (t < s.length) {
      step = s;
      break;
    }
    t -= s.length;
  }
  const [x, y, w, h, ox, oy] = step.list[Math.floor(t * step.fps) % step.list.length];
  const meta = sheet.meta;
  const res = meta.res;

  const groundX = canvas.width / 2;
  const groundY = canvas.height - 14;
  const s = (groundY - 12) / (520 * res); // atlas px -> canvas px, so the tallest pose (ball overhead) fits
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(45, 20, 35, 0.35)";
  ctx.beginPath();
  ctx.ellipse(groundX, groundY, 70 * s * res, 22 * s * res, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const at = [Math.round(groundX + ox * s), Math.round(groundY + oy * s)];
  // a kid from video holds the game's own ball, drawn behind them
  const held = meta.balls?.[`${x},${y}`];
  if (held) {
    ballSprites ??= makeBallSprites();
    const d = 2 * held[2] * s * 1.04;
    ctx.drawImage(ballSprites[NORMAL][0], at[0] + held[0] * s - d / 2, at[1] + held[1] * s - d / 2, d, d);
  }
  ctx.drawImage(sheet.img, x, y, w, h, at[0], at[1], w * s, h * s);
  // a kid from video: their number and team name, printed finer than the art (as in the game)
  const print = sheet.prints?.get(`${x},${y}`);
  if (print) ctx.drawImage(print, 0, 0, print.width, print.height, at[0], at[1], w * s, h * s);
}

// ---------- Friendly words ----------
// Names are checked as they're typed (the server checks again when sending).

const play = document.getElementById("play");
const RUDE = "Let's keep it friendly. Try different words.";
let checkTimer;
let rude = false;
// Each box is checked on its own, so the problem shows right under the one that has it.
async function friendly(text) {
  if (!text.trim()) return true;
  try {
    return (await fetch(`${API}/check?text=${encodeURIComponent(text)}`).then((r) => r.json())).ok;
  } catch {
    return true; // offline: let it through, the server checks again
  }
}
function checkWords() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(async () => {
    const [nameOk, teamOk] = await Promise.all([friendly(nameInput.value), friendly(teamInput.value)]);
    markField(nameInput, nameOk ? "" : RUDE);
    markField(teamInput, teamOk ? "" : RUDE);
    rude = !nameOk || !teamOk;
    play.disabled = send.disabled = rude;
    if (rude) say(message, `${RUDE} The ${!nameOk ? "nickname" : "team name"} needs changing.`, { error: true });
    else if (message.classList.contains("fb-error")) say(message, "");
  }, 350);
}

// ---------- Sending ----------

let token = "";
let widgetId;
async function setupTurnstile() {
  try {
    const [{ turnstileSiteKey }, turnstile] = await Promise.all([
      fetch(`${API}/config`).then((r) => r.json()),
      new Promise((resolve, reject) => {
        const s = Object.assign(document.createElement("script"), {
          src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
          async: true,
        });
        s.onload = () => resolve(window.turnstile);
        s.onerror = reject;
        document.head.append(s);
      }),
    ]);
    widgetId = turnstile.render(document.getElementById("check"), {
      sitekey: turnstileSiteKey,
      theme: "dark",
      callback: (t) => (token = t),
      "expired-callback": () => (token = ""),
    });
  } catch {
    say(message, "Players can't be sent right now. Please try later.", { error: true });
  }
}

// A kid from video's size and gear, saved with them on this device.
const looks = () => ({ build: current.video ? { ...build } : undefined, gear: current.video && Object.keys(gear).length ? { ...gear } : undefined });

// Play straight away: save to this device and jump into the game as them.
play.addEventListener("click", () => {
  if (rude) return;
  const name = nameInput.value.trim();
  if (!name) {
    say(message, "Give your player a nickname.", { error: true });
    markField(nameInput, "Give your player a nickname.");
    nameInput.focus();
    return;
  }
  const id = saveMyPlayer({ name, base: current.id, colours: { ...colours, teamName: teamInput.value.trim() }, ...looks() });
  try {
    localStorage.setItem("orson-hoops-character", JSON.stringify(id));
    localStorage.setItem("orson-hoops-chosen", "true"); // straight into a game, no player select
  } catch {
    // The game falls back to Orson.
  }
  location.href = "/games/shootaround/";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!nameInput.value.trim()) {
    say(message, "Give your player a nickname.", { error: true });
    markField(nameInput, "Give your player a nickname.");
    nameInput.focus();
    return;
  }
  if (!token) {
    say(message, "Please finish the robot check first.", { error: true });
    return;
  }
  send.disabled = true;
  say(message, "Sending…");
  // Already playing as a player by this name on this device? Give it this look, here and on the
  // leaderboard (the server updates the scores this device played as it).
  const name = nameInput.value.trim();
  const mine = myPlayers().find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (mine) saveMyPlayer({ ...mine, name, base: current.id, colours: { ...colours, teamName: teamInput.value.trim() }, ...looks() });
  let device = "";
  try {
    device = localStorage.getItem("orson-device") ?? "";
  } catch {
    // No device id, so no scores to update.
  }
  try {
    const res = await fetch(`${API}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nameInput.value,
        base: current.id,
        colours,
        number: numberInput.value,
        teamName: teamInput.value.trim(),
        localId: mine?.id,
        device,
        turnstileToken: token,
      }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    say(message, `Sent! Orson will check ${nameInput.value.trim()} soon. Once approved, pick them in the game.`);
    send.textContent = "Make another";
    token = "";
    window.turnstile?.reset(widgetId);
  } catch (err) {
    say(message, err.message || "That didn't send. Please try again.", { error: true });
    token = "";
    window.turnstile?.reset(widgetId);
  } finally {
    send.disabled = false;
  }
});

setup().catch(() => {
  say(message, "The builder couldn't load. Try refreshing the page.", { error: true });
});
