// The player builder, in four tabs under a preview that's always on screen:
//   Character: skin and hair colour first, with every character below in those colours (and size),
//              so kids can compare them before picking one.
//   Body:      height and build (kids made from video).
//   Team:      a team from the list or one of your own, its home or away kit, and your number.
//   Gear:      shoes, for now.
// Done opens a sheet with the nickname, "Play as them now" and "Send to Orson".
// Players wait for approval in /admin before they show up in the game's player picker.
//
// Open with ?base=curly&skin=c98c5f&hair=26222a&jersey=d63a3a&team=2b2b2f&shoes=f2f2ef&number=7&teamName=KINGS&name=Ace
// to preload a look (&shorts=… too; &height=1&bulk=-0.5 starts a kid from video at a size).

import { API } from "../api.js";
import { markField, say } from "../ui/form.js";
import { fillIcons, icon } from "../ui/icons.js";
import { ballFrame, makeBallFrames, makeBallSprites } from "../engine/draw.js";
import { buyBall, hasProgress, onProgress, owns, progress, refreshProgress, useBall } from "../progress.js";
import { BALL_STYLES, DEFAULT_BALL, ballStyle } from "../shared/shop.js";
import { paletteSwap } from "../players/pixelkit.js";
import { stretchFrame, stretchSheet } from "../players/stretch.js";
import { NORMAL } from "../shared/rules.js";
import { DEFAULT_TEAM, loadBase, loadBases, myPlayers, PALETTES, PARTS, recolor, saveMyPlayer } from "../players/recolor.js";
import { KIT_PARTS, kitColours, myTeams, newTeam, saveMyTeams, TEAMS } from "../players/teams.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
const button = (props, ...children) => el("button", { type: "button", ...props }, ...children);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const builder = $("builder");
const canvas = $("preview");
const ctx = canvas.getContext("2d");
const form = $("form");
const nameInput = $("name");
const numberInput = $("number");
const teamInput = $("team-name");
const message = $("message");
const send = $("send");
const play = $("play");
const previewName = $("preview-name");
const heightInput = $("height");
const bulkInput = $("bulk");

const params = new URLSearchParams(location.search);
let bases = [];
let current; // the loaded base
// what the preview draws: { meta, img, prints }, the body's sheet in their colours (and size)
let sheet;
// The ball a kid from video holds: the one they're trying on in the Gear tab, else their ball from the
// shop (the same one the game uses).
let tryingBall = null;
const ballId = () => tryingBall ?? ballStyle(progress.ball)?.id ?? DEFAULT_BALL;
const ballSprites = new Map();
// `held` [x, y, r]: as in the game, it rolls a little as the dribble moves it up and down.
const ball = (held) => {
  const id = ballId();
  if (!ballSprites.has(id)) ballSprites.set(id, makeBallSprites(ballStyle(id).look));
  return ballFrame(ballSprites.get(id)[NORMAL], held ? (held[1] / held[2]) * 0.6 : 0);
};
const colours = {}; // skin, hair, jersey, shorts, team (the trim), shoes, number, teamName
const build = { height: 0, bulk: 0 };
const LOOK = ["skin", "hair"];
let lookPart = "skin";

// ---------- Tabs ----------

const tabs = [...document.querySelectorAll(".builder-tabs [role=tab]")];
function showTab(name) {
  builder.dataset.tab = name;
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
  }
  for (const p of document.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== name;
  $("panel").scrollTop = 0;
}
for (const t of tabs) {
  t.addEventListener("click", () => {
    if (t.dataset.tab !== "gear") cancelBall();
    showTab(t.dataset.tab);
  });
  t.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const next = tabs[(tabs.indexOf(t) + step + tabs.length) % tabs.length];
    next.focus();
    showTab(next.dataset.tab);
  });
}

// ---------- Swatches ----------

function swatches(row, part, palette, onPick) {
  row.replaceChildren(
    ...palette.map((colour) => {
      const b = button({ className: "swatch", ariaLabel: `${part} colour` });
      b.dataset.colour = colour;
      b.style.background = colour;
      b.addEventListener("click", () => onPick(colour));
      return b;
    }),
  );
}
const mark = (row, colour) => {
  for (const b of row.querySelectorAll(".swatch")) b.setAttribute("aria-pressed", String(b.dataset.colour === colour));
};

// Character tab: skin or hair, then its colours.
const lookParts = $("look-parts");
const lookRow = $("look-swatches");
function paintLook() {
  for (const b of lookParts.children) {
    b.setAttribute("aria-checked", String(b.dataset.part === lookPart));
    b.querySelector(".dot").style.background = colours[b.dataset.part];
  }
  swatches(lookRow, lookPart, PALETTES[lookPart], (c) => setColours({ [lookPart]: c }));
  mark(lookRow, colours[lookPart]);
}
for (const part of LOOK) {
  const b = button({ className: "part-chip", role: "radio" }, el("span", { className: "dot" }), part === "skin" ? "Skin" : "Hair");
  b.dataset.part = part;
  b.addEventListener("click", () => {
    lookPart = part;
    paintLook();
  });
  lookParts.append(b);
}

// Gear tab: shoes.
const shoesRow = document.querySelector('[data-part="shoes"]');
swatches(shoesRow, "shoes", PALETTES.shoes, (c) => setColours({ shoes: c }));

function setColours(change) {
  Object.assign(colours, change);
  paintLook();
  mark(shoesRow, colours.shoes);
  repaint();
}

// ---------- Characters: every body, in your colours and size ----------

const wall = $("bases");
const cards = new Map(); // base id -> { base, button, canvas, loaded, frames: Map(frame -> canvas) }
const CARD_W = 120;
const CARD_H = 170;

// The look a card shows: colours and size, without the number and team name (too small to read).
const cardKey = () => JSON.stringify([LOOK.map((p) => colours[p]), kitColours(currentKit()), colours.shoes, build.height, build.bulk, ballId()]);
let cardsKey = "";

const HEIGHT_ROOM = 0.08; // how much taller the tallest setting makes a kid, roughly

// How tall a body stands: the drawn rows of its first idle frame, feet to the top of the hair.
function standingHeight(b) {
  const [x, y, w, h] = b.meta.frames.idle[0];
  const c = el("canvas", { width: w, height: h });
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(b.atlasImg, x, y, w, h, 0, 0, w, h);
  const a = g.getImageData(0, 0, w, h).data;
  const row = (r) => {
    for (let i = r * w * 4 + 3; i < (r + 1) * w * 4; i += 4) if (a[i] > 32) return true;
    return false;
  };
  let top = 0;
  while (top < h - 1 && !row(top)) top++;
  let bottom = h - 1;
  while (bottom > top && !row(bottom)) bottom--;
  return Math.max(1, bottom - top + 1);
}

function cardFrame(card, i) {
  if (card.frames.has(i)) return card.frames.get(i);
  const b = card.loaded;
  const f = b.meta.frames.idle[i];
  const [x, y, w, h, ox, oy] = f;
  const art = recolor(b, { ...colours, number: "", teamName: "" }, [x, y, w, h]);
  const held = b.meta.balls?.[`${x},${y}`];
  const sized = b.video ? stretchFrame(art, [0, 0], b.regionsData, f, build, { ball: held }) : { canvas: art, w, h, dx: 0, dy: 0, ball: held };
  const c = el("canvas", { width: CARD_W, height: CARD_H });
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  // Room for the tallest player standing, feet on the card's floor.
  // Every character the same standing height on its card (kids from video are drawn at a different
  // scale from the hand-drawn bodies), with room above for the tallest size.
  card.standing ??= standingHeight(b);
  const s = (CARD_H - 12) / (1 + HEIGHT_ROOM) / card.standing;
  const at = [CARD_W / 2 + (ox - sized.dx) * s, CARD_H - 5 + (oy - sized.dy) * s];
  if (sized.ball) {
    const d = 2 * sized.ball[2] * s * 1.04;
    g.drawImage(ball(sized.ball), at[0] + sized.ball[0] * s - d / 2, at[1] + sized.ball[1] * s - d / 2, d, d);
  }
  g.drawImage(sized.canvas, 0, 0, sized.w, sized.h, at[0], at[1], sized.w * s, sized.h * s);
  card.frames.set(i, c);
  return c;
}

function paintCard(card, i = 0) {
  if (!card.loaded) return;
  const g = card.canvas.getContext("2d");
  g.clearRect(0, 0, CARD_W, CARD_H);
  g.drawImage(cardFrame(card, i % card.loaded.meta.frames.idle.length), 0, 0);
}

function paintCards() {
  const key = cardKey();
  if (key !== cardsKey) {
    cardsKey = key;
    for (const card of cards.values()) card.frames.clear();
  }
  for (const card of cards.values()) {
    card.button.setAttribute("aria-pressed", String(card.base.id === current?.id));
    paintCard(card, 0);
  }
}

// The cards stand still, apart from a slow idle loop while the Character tab is open.
let cardTick = 0;
setInterval(() => {
  if (reducedMotion.matches || document.hidden || builder.dataset.tab !== "character") return;
  cardTick++;
  for (const card of cards.values()) paintCard(card, cardTick);
}, 250);

function setupWall() {
  for (const base of bases) {
    const c = el("canvas", { width: CARD_W, height: CARD_H, className: "card-art" });
    const b = button({ className: "character-card", ariaLabel: base.name }, c, el("span", { className: "card-name" }, base.name));
    if (base.video) b.append(el("span", { className: "card-new" }, "NEW"));
    b.addEventListener("click", () => chooseBase(base));
    wall.append(b);
    cards.set(base.id, { base, button: b, canvas: c, loaded: null, frames: new Map() });
  }
}

// Every body loads in the background (the picked one first), one at a time so the page stays quick.
async function loadCards() {
  const order = [current.id, ...bases.map((b) => b.id).filter((id) => id !== current.id)];
  for (const id of order) {
    const card = cards.get(id);
    card.loaded = await loadBase(card.base).catch(() => null);
    paintCard(card, cardTick);
  }
}

async function chooseBase(base) {
  current = await loadBase(base);
  if (base.video && current.meta.printsFrom) current.twin ??= await loadTwin(current.meta.printsFrom).catch(() => null);
  heightInput.disabled = bulkInput.disabled = !current.video;
  showTurning();
  $("size-hint").hidden = !!current.video;
  repaint();
}

// ---------- Balls: the shop's ball styles, tried on here and bought with coins ----------

const coinText = (n) => `${n} ${n === 1 ? "coin" : "coins"}`;
const ballArt = (style, size) => {
  const c = el("canvas", { width: size, height: size });
  c.getContext("2d").drawImage(makeBallFrames(style.look)[0], 0, 0, size, size);
  return c;
};
let ballBusy = false;

function paintBalls() {
  const coins = $("coins");
  coins.innerHTML = icon("coins");
  coins.append(String(progress.coins));
  coins.setAttribute("aria-label", `You have ${coinText(progress.coins)}`);
  $("balls").replaceChildren(
    ...BALL_STYLES.map((style) => {
      const using = ballStyle(progress.ball)?.id === style.id || (!ballStyle(progress.ball) && style.id === DEFAULT_BALL);
      const tag = el("span", { className: owns(style.id) ? "ball-price owned" : "ball-price" });
      if (owns(style.id)) tag.innerHTML = `${icon("check")}${using ? "Using" : "Yours"}`;
      else tag.innerHTML = `${icon("coins")}${style.price}`;
      const b = button({ className: "ball-card", ariaPressed: String(using), ariaLabel: style.name }, ballArt(style, 48), el("span", { className: "ball-name" }, style.name), tag);
      b.addEventListener("click", () => pickBall(style));
      return b;
    }),
  );
}

async function pickBall(style) {
  if (ballBusy || ballId() === style.id) return;
  say($("gear-message"), "");
  if (!owns(style.id)) return tryBall(style);
  ballBusy = true;
  try {
    await useBall(style.id);
  } catch (err) {
    say($("gear-message"), err.message, { error: true });
  } finally {
    ballBusy = false;
  }
}

// Picking a ball they don't have: it goes in their hands, and the gear is covered until they buy or cancel.
function tryBall(style) {
  tryingBall = style.id;
  const can = progress.coins >= style.price;
  $("buy-art").getContext("2d").clearRect(0, 0, 96, 96);
  $("buy-art").getContext("2d").drawImage(makeBallFrames(style.look)[0], 0, 0, 96, 96);
  $("buy-name").textContent = `${style.name} ball`;
  $("buy-price").innerHTML = `${icon("coins")}${style.price}`;
  $("buy-say").textContent = can
    ? `You have ${coinText(progress.coins)}. Buy it to keep it.`
    : `You have ${coinText(progress.coins)}. Win ${style.price - progress.coins} more in the game to buy it.`;
  const yes = $("buy-yes");
  yes.innerHTML = `${icon("coins")}Buy for ${style.price}`;
  yes.disabled = !can;
  $("gear-main").hidden = true;
  $("ball-buy").hidden = false;
  repaint();
}

function cancelBall() {
  if (!tryingBall) return;
  tryingBall = null;
  $("gear-main").hidden = false;
  $("ball-buy").hidden = true;
  repaint();
}

function setupBalls() {
  $("buy-cancel").addEventListener("click", cancelBall);
  $("buy-yes").addEventListener("click", async () => {
    const style = ballStyle(tryingBall);
    if (!style || ballBusy) return;
    ballBusy = true;
    $("buy-yes").disabled = true;
    try {
      await buyBall(style.id);
      tryingBall = null;
      $("gear-main").hidden = false;
      $("ball-buy").hidden = true;
      say($("gear-message"), `The ${style.name} ball is yours!`);
      repaint();
    } catch (err) {
      $("buy-say").textContent = err.message;
      $("buy-yes").disabled = false;
    } finally {
      ballBusy = false;
    }
  });
  onProgress(() => {
    paintBalls();
    repaint();
  });
  paintBalls();
  if (hasProgress()) refreshProgress(); // coins from games on another device
}

// ---------- Size ----------

function setupSize() {
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
      if (e.button !== 0 || input.disabled) return;
      e.preventDefault();
      input.focus();
      input.setPointerCapture(e.pointerId);
      choose(stepAt(e.clientX));
    });
    input.addEventListener("pointermove", (e) => {
      if (input.hasPointerCapture(e.pointerId)) choose(stepAt(e.clientX));
    });
  }
}

// ---------- Teams ----------

let mine = myTeams();
let team; // the team being played for
let kit = "home";
let editing = false;
let linkTeam = null; // a look from a link (the admin page's "open in builder"), kept only if edited

const allTeams = () => [...mine, ...(linkTeam ? [linkTeam] : []), ...TEAMS];
const currentKit = () => team[kit];
const isMine = (t) => t === linkTeam || mine.includes(t);

const kitSwatch = (k) => el("span", { className: "kit" }, ...KIT_PARTS.map((p) => el("span", { style: `background:${k[p]}` })));

function wearTeam(t, which = kit) {
  team = t;
  kit = which;
  Object.assign(colours, kitColours(team[kit]), { teamName: team.name });
  teamInput.value = team.name;
  paintTeams();
  repaint();
}

function keepMine() {
  if (team === linkTeam) {
    mine = [...mine, linkTeam];
    linkTeam = null;
  }
  saveMyTeams(mine);
}

function teamRow(t) {
  const on = t === team;
  const pick = button({ className: "team-pick", ariaPressed: String(on) }, el("span", { className: "kits" }, kitSwatch(t.home), kitSwatch(t.away)), el("b", {}, t.name));
  if (on) pick.insertAdjacentHTML("beforeend", `<span class="team-on">${icon("check")}</span>`);
  pick.addEventListener("click", () => wearTeam(t));
  const row = el("div", { className: "team-row" }, pick);
  if (isMine(t)) {
    const edit = button({ className: "fb-button team-edit" }, "Edit");
    edit.addEventListener("click", () => {
      wearTeam(t);
      editing = true;
      paintTeams();
      teamInput.focus({ preventScroll: true });
    });
    row.append(edit);
  }
  return row;
}

function paintTeams() {
  $("team-now").textContent = team.name;
  // Home and away.
  const picker = $("kit-picker");
  picker.replaceChildren(
    ...["home", "away"].map((which) => {
      const b = button({ className: "kit-choice", role: "radio", ariaChecked: String(kit === which) }, kitSwatch(team[which]), which === "home" ? "Home" : "Away");
      b.addEventListener("click", () => wearTeam(team, which));
      return b;
    }),
  );
  $("team-list").hidden = editing;
  $("team-editor").hidden = !editing;
  if (editing) {
    const box = $("kit-colours");
    const label = kit === "home" ? "Home" : "Away";
    box.replaceChildren(
      ...KIT_PARTS.map((part) => {
        const row = el("div", { className: "swatch-row" });
        const palette = part === "trim" ? PALETTES.team : PALETTES.jersey;
        swatches(row, part, palette, (c) => {
          team[kit] = { ...team[kit], [part]: c };
          keepMine();
          wearTeam(team);
        });
        mark(row, team[kit][part]);
        return el("div", { className: "colour-field" }, el("span", { className: "mini-label" }, `${label} ${part === "trim" ? "trim and number" : part}`), row);
      }),
    );
    return;
  }
  const list = $("team-list");
  const make = button({ className: "make-team" });
  make.innerHTML = `${icon("plus")}Make a team`;
  make.addEventListener("click", () => {
    const t = newTeam(mine.length);
    mine = [...mine, t];
    saveMyTeams(mine);
    editing = true;
    wearTeam(t, "home");
    teamInput.focus({ preventScroll: true });
    teamInput.select();
  });
  const yours = [...mine, ...(linkTeam ? [linkTeam] : [])];
  list.replaceChildren(
    el("section", { className: "team-list" }, el("p", { className: "pane-title" }, "Your teams"), ...yours.map(teamRow), make),
    el("section", { className: "team-list" }, el("p", { className: "pane-title" }, "Teams"), ...TEAMS.map(teamRow)),
  );
}

function setupTeams() {
  teamInput.addEventListener("input", () => {
    teamInput.value = teamInput.value.toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 10);
    team.name = teamInput.value.trim() || team.name;
    colours.teamName = teamInput.value.trim();
    $("team-now").textContent = teamInput.value.trim();
    keepMine();
    checkWords();
    repaint();
  });
  $("team-done").addEventListener("click", () => {
    if (!teamInput.value.trim()) teamInput.value = team.name;
    editing = false;
    keepMine();
    paintTeams();
  });
  $("team-delete").addEventListener("click", () => {
    mine = mine.filter((t) => t !== team);
    if (team === linkTeam) linkTeam = null;
    saveMyTeams(mine);
    editing = false;
    wearTeam(TEAMS[0], "home");
  });
  numberInput.addEventListener("input", () => {
    numberInput.value = numberInput.value.replace(/\D/g, "").slice(0, 2);
    colours.number = numberInput.value;
    showName();
    repaint();
  });
}

// ---------- Preview ----------

// Preview loop: [animation, frames per second, times to repeat].
// The preview's loop: standing, then a dribble and a shot facing each way the sheet has (a hand-drawn
// body has the front only; a kid from video turns all the way round), so every side can be checked.
const SIDES = ["", "-fr", "-r", "-br", "-b", "-bl", "-l", "-fl"];
// Turned by hand (the arrows, or a swipe on the preview): that side's dribble and shot, over and over.
function showSteps(frames, facing = null) {
  const steps = facing === null ? [["idle", 3, 2]] : [];
  for (const side of facing === null ? SIDES : [facing]) {
    if (!frames[`release${side}`] && facing === null) continue;
    steps.push(
      [`dribble${side}`, 14, 2],
      [`gather${side}`, 24, 1],
      [`jump${side}`, 1 / 0.085, 1],
      [`release${side}`, 16, 1],
      [`release${side}`, 1, 0.8, "hold"],
      [`recover${side}`, 14, 1],
    );
  }
  const kept = steps.filter(([anim]) => frames[anim]);
  return (kept.length ? kept : [["idle", 3, 1]])
    .map(([anim, fps, repeats, how]) => {
      const list = how === "hold" ? [frames[anim].at(-1)] : frames[anim];
      return { anim, list, fps, length: (list.length / fps) * repeats };
    });
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

// A video kid's number and team name for each of their frames, from the twin's jersey faces.
function twinPrints() {
  if (!current.twin) return null;
  const parts = Object.fromEntries(PARTS.map((p) => [p, colours[p]]));
  const kitText = { number: colours.number ?? "", team: colours.teamName ?? DEFAULT_TEAM };
  const layers = paletteSwap(current.twin.pimg, current.twin.pm, parts, kitText).printLayers ?? new Map();
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
    sheet = current.video
      ? stretchSheet({ meta: current.meta, img: recolor(current, colours), prints: twinPrints() }, current.regionsData, build)
      : { meta: current.meta, img: recolor(current, colours), prints: null };
    showName();
    paintCards();
  });
}

function showName() {
  const n = colours.number;
  const name = nameInput.value.trim() || bases.find((b) => b.id === current?.id)?.name || "";
  previewName.textContent = [name, n !== "" && n !== undefined ? `#${n}` : ""].filter(Boolean).join(" ");
}

let started = performance.now();

// ---------- Turning the player round ----------

let facing = null; // a side from SIDES once they've turned the player; null shows every side in turn
const sidesOf = (frames) => SIDES.filter((side) => frames[`dribble${side}`]);
const turnLeft = $("turn-left");
const turnRight = $("turn-right");

function turn(step) {
  const sides = sidesOf(current.meta.frames);
  if (sides.length < 2) return;
  const at = facing === null ? 0 : Math.max(0, sides.indexOf(facing));
  facing = sides[(at + step + sides.length) % sides.length];
  started = performance.now();
}

function setupTurning() {
  turnLeft.addEventListener("click", () => turn(-1));
  turnRight.addEventListener("click", () => turn(1));
  // a sideways swipe on the preview turns them too
  let x0 = null;
  canvas.addEventListener("pointerdown", (e) => (x0 = e.clientX));
  canvas.addEventListener("pointerup", (e) => {
    if (x0 !== null && Math.abs(e.clientX - x0) > 30) turn(e.clientX < x0 ? 1 : -1);
    x0 = null;
  });
  canvas.addEventListener("pointercancel", () => (x0 = null));
}

// Only bodies drawn from every side can turn (kids from video); a new body starts by showing them all.
function showTurning() {
  facing = null;
  started = performance.now();
  turnLeft.hidden = turnRight.hidden = sidesOf(current.meta.frames).length < 2;
}
function draw(now) {
  requestAnimationFrame(draw);
  if (!sheet) return;
  const frames = sheet.meta.frames;
  // Find where we are in the show loop (standing still when motion is reduced).
  if (sheet.steps?.frames !== frames || sheet.steps.facing !== facing) sheet.steps = Object.assign(showSteps(frames, facing), { frames, facing });
  const steps = sheet.steps;
  const total = steps.reduce((t, s) => t + s.length, 0);
  let t = reducedMotion.matches ? 0 : ((now - started) / 1000) % total;
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
    const d = 2 * held[2] * s * 1.04;
    ctx.drawImage(ball(held), at[0] + held[0] * s - d / 2, at[1] + held[1] * s - d / 2, d, d);
  }
  ctx.drawImage(sheet.img, x, y, w, h, at[0], at[1], w * s, h * s);
  // a kid from video: their number and team name, printed finer than the art (as in the game)
  const print = sheet.prints?.get(`${x},${y}`);
  if (print) ctx.drawImage(print, 0, 0, print.width, print.height, at[0], at[1], w * s, h * s);
}

// ---------- Done: nickname, play or send ----------

const scrim = $("scrim");
let opener = null;
function openDone() {
  opener = document.activeElement;
  form.hidden = scrim.hidden = false;
  void form.offsetHeight; // lay it out below the screen first, so it slides up
  document.body.classList.add("finishing");
  if (!turnstileStarted) setupTurnstile();
  nameInput.focus({ preventScroll: true });
}
function closeDone() {
  document.body.classList.remove("finishing");
  form.hidden = scrim.hidden = true;
  opener?.focus?.({ preventScroll: true });
}
$("done-open").addEventListener("click", () => {
  cancelBall();
  openDone();
});
$("done-close").addEventListener("click", closeDone);
scrim.addEventListener("click", closeDone);
form.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDone();
});

// ---------- Friendly words ----------
// Names are checked as they're typed (the server checks again when sending).

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
    const [nameOk, teamOk] = await Promise.all([friendly(nameInput.value), friendly(colours.teamName ?? "")]);
    markField(nameInput, nameOk ? "" : RUDE);
    markField(teamInput, teamOk ? "" : RUDE);
    rude = !nameOk || !teamOk;
    play.disabled = send.disabled = rude;
    if (rude) say(message, `${RUDE} The ${!nameOk ? "nickname" : "team name"} needs changing.`, { error: true });
    else if (message.classList.contains("fb-error")) say(message, "");
  }, 350);
}
nameInput.addEventListener("input", () => {
  checkWords();
  showName();
});

// ---------- Sending ----------

let token = "";
let widgetId;
let turnstileStarted = false;
async function setupTurnstile() {
  turnstileStarted = true;
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
    widgetId = turnstile.render($("check"), {
      sitekey: turnstileSiteKey,
      theme: "dark",
      callback: (t) => (token = t),
      "expired-callback": () => (token = ""),
    });
  } catch {
    say(message, "Players can't be sent right now. Please try later.", { error: true });
  }
}

// What's saved with a player: their colours (with the team's name) and, for a kid from video, their size.
const look = () => ({ base: current.id, colours: { ...colours, teamName: colours.teamName ?? DEFAULT_TEAM }, build: current.video ? { ...build } : undefined });

function needName() {
  if (nameInput.value.trim()) return false;
  say(message, "Give your player a nickname.", { error: true });
  markField(nameInput, "Give your player a nickname.");
  nameInput.focus();
  return true;
}

// Play straight away: save to this device and jump into the game as them.
play.addEventListener("click", () => {
  if (rude || needName()) return;
  const id = saveMyPlayer({ name: nameInput.value.trim(), ...look() });
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
  if (needName()) return;
  if (!token) {
    say(message, "Please finish the robot check first.", { error: true });
    return;
  }
  send.disabled = true;
  say(message, "Sending…");
  // Already playing as a player by this name on this device? Give it this look, here and on the
  // leaderboard (the server updates the scores this device played as it).
  const name = nameInput.value.trim();
  const same = myPlayers().find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (same) saveMyPlayer({ ...same, name, ...look() });
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
        teamName: colours.teamName ?? DEFAULT_TEAM,
        localId: same?.id,
        device,
        turnstileToken: token,
      }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    say(message, `Sent! Orson will check ${name} soon. Once approved, pick them in the game.`);
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

// ---------- Start ----------

const hexParam = (part) => {
  const c = params.get(part);
  return c && /^[0-9a-f]{6}$/i.test(c) ? `#${c.toLowerCase()}` : null;
};

async function setup() {
  fillIcons();
  bases = await loadBases();
  // Start from the link's look, if any, otherwise the first body.
  const start = bases.find((b) => b.id === params.get("base")) ?? bases[0];
  for (const part of [...LOOK, "shoes"]) colours[part] = hexParam(part) ?? start.colours[part];

  // A link with a kit of its own wears it as a team of yours (saved only if you change it).
  const teamName = (params.get("teamName") ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 10);
  const [jersey, trim] = [hexParam("jersey"), hexParam("team")];
  if (jersey && trim) {
    const home = { jersey, shorts: hexParam("shorts") ?? trim, trim };
    const known = [...mine, ...TEAMS].find((t) => t.name === (teamName || DEFAULT_TEAM) && KIT_PARTS.every((p) => t.home[p] === home[p]));
    linkTeam = known ? null : { id: `mine${Date.now()}`, name: teamName || DEFAULT_TEAM, home, away: { jersey: "#f2f2ef", shorts: trim, trim } };
    team = known ?? linkTeam;
  } else {
    team = [...mine, ...TEAMS].find((t) => t.name === teamName) ?? TEAMS[0];
  }
  if (/^\d{1,2}$/.test(params.get("number") ?? "")) numberInput.value = colours.number = params.get("number");
  if (params.get("name")) nameInput.value = params.get("name").slice(0, 12);

  setupWall();
  setupSize();
  setupTeams();
  setupBalls();
  setupTurning();
  paintLook();
  mark(shoesRow, colours.shoes);
  showTab("character");
  await chooseBase(start);
  wearTeam(team, "home");
  requestAnimationFrame(draw);
  loadCards();
}

setup().catch(() => {
  say(message, "The builder couldn't load. Try refreshing the page.", { error: true });
});
