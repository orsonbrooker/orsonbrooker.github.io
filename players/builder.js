// The player builder: pick a body and colours, watch them dribble and shoot, send it to Orson.
// Players wait for approval in /admin before they show up in the game's player picker.
// Open with ?base=curly&skin=c98c5f&hair=26222a&jersey=d63a3a&team=2b2b2f&shoes=f2f2ef&number=7&teamName=KINGS&name=Ace&pronoun=he
// to preload a look.

import { markField, say } from "../ui/form.js";
import { DEFAULT_TEAM, loadBase, loadBases, myPlayers, PALETTES, PARTS, recolor, saveMyPlayer } from "../players/recolor.js";

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const API = LOCAL ? "http://localhost:8787/api" : "/api";

// Preview loop: [animation, frames per second, times to repeat].
const SHOW = [
  ["idle", 3, 2],
  ["turn", 20, 1],
  ["dribble", 14, 3],
  ["gather", 24, 1],
  ["jump", 1 / 0.085, 1],
  ["release", 16, 1],
  ["release-hold", 1, 1],
];

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const form = document.getElementById("form");
const nameInput = document.getElementById("name");
const numberInput = document.getElementById("number");
const teamInput = document.getElementById("team-name");
const message = document.getElementById("message");
const send = document.getElementById("send");
const previewName = document.getElementById("preview-name");
const pronounBox = document.getElementById("pronoun");

const params = new URLSearchParams(location.search);
let bases = [];
let current; // the loaded base
let sheet; // its sprite sheet in the chosen colours
const colours = {};
const picked = new Set(); // parts the player has chosen a colour for, kept when they switch bodies
let pronoun = ""; // "he", "she", or "" if they haven't said

function button(props, ...children) {
  const b = Object.assign(document.createElement("button"), { type: "button", ...props });
  b.append(...children);
  return b;
}

function press(group, chosen) {
  for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === chosen));
}

async function chooseBase(base, keepColours) {
  current = await loadBase(base);
  // A new body brings its own colours for anything the player hasn't picked yet; their picks stay.
  if (!keepColours) for (const part of PARTS) if (!picked.has(part)) colours[part] = base.colours[part];
  for (const part of PARTS) markSwatch(part);
  repaint();
}

function markSwatch(part) {
  const group = document.querySelector(`[data-part="${part}"]`);
  for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.colour === colours[part]));
}

let repaintQueued = false;
function repaint() {
  if (repaintQueued) return;
  repaintQueued = true;
  requestAnimationFrame(() => {
    repaintQueued = false;
    sheet = recolor(current, colours);
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

  // He or she, for the announcer. Optional: tapping the chosen one again unpicks it.
  const choosePronoun = (value) => {
    pronoun = value;
    for (const b of pronounBox.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.pronoun === pronoun));
  };
  for (const b of pronounBox.querySelectorAll("button")) b.addEventListener("click", () => choosePronoun(pronoun === b.dataset.pronoun ? "" : b.dataset.pronoun));
  if (["he", "she"].includes(params.get("pronoun"))) choosePronoun(params.get("pronoun"));

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
  const frames = current.meta.frames;
  const res = current.meta.res;
  // Find where we are in the show loop.
  const steps = SHOW.map(([anim, fps, repeats]) => {
    const list = anim === "release-hold" ? [frames.release.at(-1)] : frames[anim];
    return { list, fps, length: (list.length / fps) * repeats };
  });
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

  const groundX = canvas.width / 2;
  const groundY = canvas.height - 26;
  const s = (groundY - 12) / (520 * res); // atlas px -> canvas px, so the tallest pose (ball overhead) fits
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(45, 20, 35, 0.35)";
  ctx.beginPath();
  ctx.ellipse(groundX, groundY, 70 * s * res, 22 * s * res, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sheet, x, y, w, h, groundX + ox * s, groundY + oy * s, w * s, h * s);
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
  const id = saveMyPlayer({ name, base: current.id, pronoun, colours: { ...colours, teamName: teamInput.value.trim() } });
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
  if (mine) saveMyPlayer({ ...mine, name, base: current.id, pronoun, colours: { ...colours, teamName: teamInput.value.trim() } });
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
        pronoun,
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
