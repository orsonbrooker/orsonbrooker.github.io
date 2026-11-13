// The player builder, in four tabs under a preview that's always on screen:
//   Character: skin and hair colour first, with every character below in those colours (and size),
//              so kids can compare them before picking one.
//   Body:      height and build (kids made from video).
//   Team:      a team from the list or one of your own, its home or away kit, and your number.
//   Gear:      what a kid from video wears (one item per slot), shoe colour and the ball.
// Done opens a sheet with the nickname, "Play as them now" and "Send to Orson".
// Players wait for approval in /admin before they show up in the game's player picker.
//
// Open with ?base=curly&skin=c98c5f&hair=26222a&jersey=d63a3a&team=2b2b2f&shoes=f2f2ef&number=7&teamName=KINGS&name=Ace
// to preload a look (&shorts=… too; &height=1&bulk=-0.5 starts a kid from video at a size).
// &gear=beanie,stripes tries gear on a kid from video (content/gear.json), saved with the player for the game.

import { API } from "../api.js";
import { flagOn } from "../flags.js";
import { markField, say } from "../ui/form.js";
import { fillIcons, icon } from "../ui/icons.js";
import { ballFrame, makeBallFrames, makeBallSprites } from "../engine/draw.js";
import { buyBall, hasProgress, onProgress, owns, progress, refreshProgress, useBall } from "../progress.js";
import { BALL_STYLES, DEFAULT_BALL, ballStyle } from "../shared/shop.js";
import { paletteSwap } from "../players/pixelkit.js";
import { GEAR, SLOTS, gearParam, itemArt, loadGear, madeFor, readyGear, wearGear } from "../players/gear.js";
import { stretchFrame, stretchSheet } from "../players/stretch.js";
import { NORMAL } from "../shared/rules.js";
import { DEFAULT_TEAM, loadBase, loadBases, myPlayers, PALETTES, PARTS, pickSize, recolor, saveMyPlayer, useDrawnKids } from "../players/recolor.js";
import { KIT_PARTS, kitColours, myTeams, newTeam, saveMyTeams, TEAMS } from "../players/teams.js";
import { changeTeam, joinTeam, keptTeam, keptTeams, leaveTeam, listedTeams, makeTeam, refreshTeams } from "../players/community.js";
import { confirmDialog } from "../ui/confirm.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
const button = (props, ...children) => el("button", { type: "button", ...props }, ...children);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Kids from video aren't out until their flag is on (shared/flags.js). Until then Curly and Buns are
// their drawn bodies, and there's no Body tab (only kids from video change size).
if (!flagOn("videokids")) {
  useDrawnKids();
  $("tab-body").remove();
}

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
const gearTest = params.has("gear"); // a ?gear= test link: every item made, ready or not
// ?edit=<id>: change a player made on this device (from the game's player picker). Their look is
// read in as if it were a link's, and saving keeps their id, so their scores stay theirs.
const ownPlayer = myPlayers().find((p) => p.id === params.get("edit")) ?? null;
if (ownPlayer) {
  const c = ownPlayer.colours ?? {};
  params.set("base", ownPlayer.base);
  for (const part of [...PARTS, "shorts"]) if (/^#[0-9a-f]{6}$/i.test(c[part] ?? "")) params.set(part, c[part].slice(1));
  if (c.number !== undefined && c.number !== "") params.set("number", String(c.number));
  params.set("teamName", c.teamName ?? DEFAULT_TEAM);
  params.set("name", ownPlayer.name);
  if (ownPlayer.gear) params.set("gear", Object.values(readyGear(ownPlayer.base, ownPlayer.gear)).join(","));
  if (ownPlayer.build) {
    params.set("height", String(ownPlayer.build.height ?? 0));
    params.set("bulk", String(ownPlayer.build.bulk ?? 0));
  }
}
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
const ballSet = () => {
  const id = ballId();
  if (!ballSprites.has(id)) ballSprites.set(id, makeBallSprites(ballStyle(id).look));
  return ballSprites.get(id)[NORMAL];
};
const ball = (held) => ballFrame(ballSet(), held ? (held[1] / held[2]) * 0.6 : 0);
const colours = {}; // skin, hair, jersey, shorts, team (the trim), shoes, number, teamName
const build = { height: 0, bulk: 0 };
const gear = gearParam(params.get("gear")); // { slot: item } (a test link, until the builder can pick gear)
let worn = []; // the gear's layers for the current body
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
  // how many across: all in one row with room, else two rows (builder.css), so each is big enough to tap
  row.style.setProperty("--n", String(palette.length));
  row.style.setProperty("--half", String(Math.ceil(palette.length / 2)));
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
  paintWear(); // the items show in the new colours
}

// ---------- Characters: every body, in your colours and size ----------

const wall = $("bases");
const cards = new Map(); // base id -> { base, button, canvas, loaded, frames: Map(frame -> canvas) }
const CARD_W = 120;
const CARD_H = 170;
const CARD_SCALE = 0.6; // card pixels per full-sheet pixel, about (cardFrame)

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
    // a card draws its body at about 0.6 card pixels per full-sheet pixel: the smallest size shows all of it
    card.loaded = await loadBase(card.base, "/", pickSize(card.base, CARD_SCALE)).catch(() => null);
    paintCard(card, cardTick);
  }
}

// Screen pixels per full-sheet pixel in the preview, as draw() sizes them (null while it isn't laid out: a
// phone's Character tab hides it).
function previewScale() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const h = canvas.clientHeight * dpr;
  if (h < 60 || canvas.clientWidth < 30) return null;
  return Math.min((h - 26 * dpr) / (520 * 0.6), 1.3 * dpr);
}

// The size of their sheet the preview needs (players/recolor.js pickSize): the smallest that isn't drawn
// enlarged, else full; while the preview is hidden, the size already in use (or the smallest, to start).
function previewSize(base) {
  const k = previewScale();
  const using = current?.id === base.id ? current.size : undefined;
  if (k === null) return using !== undefined ? using : pickSize(base, 0);
  return pickSize(base, k, using);
}

// The preview was resized (or shown): their sheet again at another size, if it needs one.
let rechecking = 0;
function recheckPreview() {
  clearTimeout(rechecking);
  rechecking = setTimeout(() => {
    const base = current && bases.find((b) => b.id === current.id);
    if (base && previewScale() !== null && previewSize(base) !== current.size) chooseBase(base);
  }, 300);
}
new ResizeObserver(recheckPreview).observe(canvas);

async function chooseBase(base) {
  current = await loadBase(base, "/", previewSize(base));
  if (base.video && current.meta.printsFrom) current.twin ??= await loadTwin(current.meta.printsFrom).catch(() => null);
  heightInput.disabled = bulkInput.disabled = !current.video;
  showTurning();
  $("size-hint").hidden = !!current.video;
  // Only a kid from video holds a ball of its own (a drawn body's ball is part of its art), so only
  // they can try one on here. Kids from video only show with the videokids flag on.
  $("ball-pick").hidden = !current.video;
  if (!current.video) cancelBall();
  worn = current.video ? await loadGear(base.id, gear, "/", current.size).catch(() => []) : [];
  repaint();
  paintWear();
}

// ---------- What they wear (a kid from video): one item per slot, shown in their own colours ----------

let wearSlot = null;
let wearToken = 0;
async function paintWear() {
  const box = $("wear");
  const token = ++wearToken;
  const kid = current?.video && flagOn("gear") ? current.id : null;
  const made = kid ? await madeFor(kid, "/", gearTest).catch(() => ({})) : {}; // a ?gear= link shows every item made
  if (token !== wearToken) return; // a newer paint started
  const slots = SLOTS.filter(([id]) => made[id]?.length);
  box.hidden = !slots.length;
  if (!slots.length) return;
  if (!slots.some(([id]) => id === wearSlot)) wearSlot = slots[0][0];
  $("wear-slots").replaceChildren(
    ...slots.map(([id, name]) => {
      const b = button({ className: "slot-chip", role: "tab", ariaSelected: String(id === wearSlot) }, name);
      if (gear[id]) b.insertAdjacentHTML("beforeend", `<span class="worn">${icon("check")}</span>`);
      b.addEventListener("click", () => {
        wearSlot = id;
        paintWear();
      });
      return b;
    }),
  );
  const layers = await Promise.all(made[wearSlot].map((id) => loadGear(kid, [id], "/", current.size).then((l) => l[0]).catch(() => null)));
  if (token !== wearToken) return;
  const none = button({ className: "ball-card", ariaPressed: String(!gear[wearSlot]), ariaLabel: "Nothing" }, el("span", { className: "slot-empty" }), el("span", { className: "ball-name" }, "None"));
  none.addEventListener("click", () => wear(wearSlot, null));
  $("wear-items").replaceChildren(
    none,
    ...layers.filter(Boolean).map((layer) => {
      const b = button({ className: "ball-card", ariaPressed: String(gear[wearSlot] === layer.id), ariaLabel: GEAR[layer.id].name }, itemArt(layer, colours, 96, (rect) => recolor(current, colours, rect), current.meta), el("span", { className: "ball-name" }, GEAR[layer.id].name));
      b.addEventListener("click", () => wear(wearSlot, layer.id));
      return b;
    }),
  );
}

async function wear(slot, id) {
  if (id) gear[slot] = id;
  else delete gear[slot];
  worn = await loadGear(current.id, gear, "/", current.size).catch(() => []);
  repaint();
  paintWear();
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
// The official teams (shared/teams.js) and, with the `teams` flag, community teams (players/community.js):
// made by kids, joined with a code (or from the list once Luke has OKed showing one to everyone). Without
// the flag, "your teams" are kept on this device only, as before. A device's own teams that aren't real
// community teams yet ("drafts") can be made into one.

const COMMUNITY = flagOn("teams");
let mine = myTeams(); // teams kept on this device (drafts, with the flag on)
let community = COMMUNITY ? keptTeams() : []; // community teams this device is on or made
let listed = []; // community teams shown to everyone
let mostTeams = 3;
let team; // the team being played for
let kit = "home";
let editing = false;
let linkTeam = null; // a look from a link (the admin page's "open in builder"), kept only if edited
let teamBusy = false;
let codeTyped = ""; // a join code being typed (kept when the list is drawn again, e.g. after a wrong one)
// What happened with a team change, shown in the Team tab (the builder's other message line is in the Done sheet).
const teamMessage = $("team-message");
const sayTeam = (text, options) => {
  say(teamMessage, text, options);
  if (text) teamMessage.scrollIntoView({ block: "nearest" });
};

const allTeams = () => [...community, ...mine, ...(linkTeam ? [linkTeam] : []), ...TEAMS];
const currentKit = () => team[kit];
const isMine = (t) => t === linkTeam || mine.includes(t);
const isCommunity = (t) => !!t?.key;

const kitSwatch = (k) => el("span", { className: "kit" }, ...KIT_PARTS.map((p) => el("span", { style: `background:${k[p]}` })));
// Marks a community team, so it never looks like one of the game's own teams.
const badge = () => {
  const b = el("span", { className: "team-badge", title: "Made by players" });
  b.innerHTML = icon("players");
  b.append(el("span", {}, "Made by players"));
  return b;
};

function wearTeam(t, which = kit) {
  team = t;
  kit = which;
  Object.assign(colours, kitColours(team[kit]), { teamName: team.name });
  if (isCommunity(team)) colours.teamId = team.key;
  else delete colours.teamId;
  teamInput.value = team.name;
  paintTeams();
  repaint();
  paintWear(); // gear takes the kit's colours
}

function keepMine() {
  if (isCommunity(team)) return; // changed on the server when they're done (saveCommunity)
  if (team === linkTeam) {
    mine = [...mine, linkTeam];
    linkTeam = null;
  }
  saveMyTeams(mine);
}

function teamRow(t, extra) {
  const on = t === team || (isCommunity(t) && t.key === team?.key);
  const label = el("span", { className: "team-label" }, el("b", {}, t.name));
  if (isCommunity(t)) label.append(badge());
  const pick = button({ className: "team-pick", ariaPressed: String(on) }, el("span", { className: "kits" }, kitSwatch(t.home), kitSwatch(t.away)), label);
  if (on) pick.insertAdjacentHTML("beforeend", `<span class="team-on">${icon("check")}</span>`);
  pick.addEventListener("click", () => (extra?.onPick ? extra.onPick() : wearTeam(t)));
  const row = el("div", { className: "team-row" }, pick);
  if (extra?.side) row.append(extra.side);
  else if (isMine(t) || t.maker) {
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
  $("team-now-badge").replaceChildren(...(isCommunity(team) ? [badge()] : []));
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
  if (editing) return paintEditor();
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
  // The teams first (theirs, then ones made by players they can join, then the official ones), then
  // making a team and joining one with a code at the end.
  const drafts = [...mine, ...(linkTeam ? [linkTeam] : [])];
  const section = (title, ...rows) => el("section", { className: "team-list" }, el("p", { className: "pane-title" }, title), ...rows);
  const official = section("Teams", ...TEAMS.map((t) => teamRow(t)));
  if (!COMMUNITY) {
    list.replaceChildren(...(drafts.length ? [section("Your teams", ...drafts.map((t) => teamRow(t)))] : []), official, section("New team", make));
    return;
  }
  const on = community.filter((t) => t.member !== false);
  const yours = [];
  for (const t of on) {
    if (t.maker) yours.push(teamRow(t));
    else {
      const leave = button({ className: "fb-button team-edit" }, "Leave");
      leave.addEventListener("click", () => leave_(t));
      yours.push(teamRow(t, { side: leave }));
    }
  }
  for (const t of drafts) yours.push(teamRow(t));
  if (drafts.length) yours.push(el("p", { className: "fb-hint team-hint", textContent: "Teams with Edit but no badge are only on this device. Edit one and tap Make it a team so friends can join." }));

  const open = listed.filter((t) => !on.some((o) => o.key === t.key));
  const openRows = open.map((t) => {
    const count = el("span", { className: "team-count", textContent: `${t.members} ${t.members === 1 ? "player" : "players"}` });
    return teamRow(t, { side: count, onPick: () => runTeam(null, async () => wearTeam(await joinTeam({ id: t.id }), "home"), "Joined!") });
  });

  const code = el("input", { type: "text", id: "team-code", maxLength: 9, autocomplete: "off", autocapitalize: "characters", spellcheck: false, placeholder: "ABCD-EFGH", ariaLabel: "Team code", value: codeTyped });
  code.addEventListener("input", () => {
    const raw = code.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 8);
    code.value = codeTyped = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
  });
  const go = button({ className: "fb-button fb-primary", id: "team-join" }, "Join");
  const join = () =>
    runTeam(go, async () => {
      wearTeam(await joinTeam({ code: code.value }), "home");
      codeTyped = "";
    }, "Joined!");
  go.addEventListener("click", join);
  code.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), join()));
  list.replaceChildren(
    ...(yours.length ? [section("Your teams", ...yours)] : []),
    ...(openRows.length ? [section("Teams made by players", ...openRows)] : []),
    official,
    section("New team", make),
    section(
      "Join a team",
      el("label", { className: "field" }, el("span", { className: "mini-label" }, "Got a code from a friend?"), el("div", { className: "code-row" }, code, go)),
    ),
  );
}

// The editor: name and kit colours. For a draft with the flag on, Make it a team; for a community team
// its maker made, its code and showing it to everyone too.
function paintEditor() {
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
  const extra = $("team-extra");
  $("team-delete").hidden = isCommunity(team);
  $("team-done").innerHTML = icon("check");
  $("team-done").append(isCommunity(team) ? "Save" : "Done");
  if (!COMMUNITY) return extra.replaceChildren();
  if (!isCommunity(team)) {
    const real = button({ className: "fb-button fb-primary make-real", id: "team-make" }, "Make it a team");
    real.addEventListener("click", () => makeReal(real));
    const full = community.filter((t) => t.maker).length >= mostTeams;
    extra.replaceChildren(
      el("p", { className: "fb-hint", textContent: full ? `You've made ${mostTeams} teams on this device. Join a friend's team instead?` : "Make it a team so friends can join it with a code. Make up a name: not your school or club." }),
      ...(full ? [] : [teamCheck(), real]),
    );
    return;
  }
  // Their own community team.
  const codeText = el("b", { className: "team-code", textContent: team.code ?? "••••-••••" });
  const fresh = button({ className: "fb-button" }, team.code ? "New code" : "Show a code");
  fresh.addEventListener("click", () =>
    runTeam(fresh, async () => Object.assign(team, await changeTeam(team, "code")), team.code ? "New code made. The old one won't work any more." : ""),
  );
  const STATE = {
    private: "Only friends with the code can join.",
    asked: "Waiting for Luke to OK the name.",
    listed: "Everyone can find and join it.",
    refused: "Try a different name to show it to everyone.",
  };
  const show = button({ className: "fb-button" }, team.listing === "listed" || team.listing === "asked" ? "Only with the code" : "Show it to everyone");
  show.addEventListener("click", () => {
    const listing = team.listing === "listed" || team.listing === "asked";
    if (!listing && !teamToken) return sayTeam("Please finish the robot check first.", { error: true });
    runTeam(show, async () => {
      Object.assign(team, await changeTeam(team, listing ? "unlist" : "list", listing ? {} : { turnstileToken: useTeamToken() }));
      paintTeams();
    });
  });
  extra.replaceChildren(
    el("div", { className: "code-box" }, el("span", { className: "mini-label" }, "Team code"), codeText, fresh),
    el("p", { className: "fb-hint", textContent: "Share the code in person with friends. They type it in Join a team." }),
    el("div", { className: "code-box" }, el("span", { className: "mini-label" }, "Who can join"), el("span", { className: "team-state", textContent: STATE[team.listing] ?? STATE.private }), ...(team.listing === "refused" ? [] : [show])),
    teamCheck(),
  );
}

// ---------- Talking to the server about teams ----------

let teamToken = "";
let teamWidget;
const useTeamToken = () => {
  const t = teamToken;
  teamToken = "";
  if (teamWidget !== undefined) window.turnstile?.reset(teamWidget);
  return t;
};
// The robot check for making, renaming or showing a team: one widget, moved into the editor.
const teamCheckBox = el("div", { className: "fb-check", id: "team-check" });
function teamCheck() {
  if (teamWidget === undefined) {
    teamWidget = null;
    loadTurnstile()
      .then(({ turnstile, sitekey }) => {
        teamWidget = turnstile.render(teamCheckBox, { sitekey, theme: "dark", callback: (t) => (teamToken = t), "expired-callback": () => (teamToken = "") });
      })
      .catch(() => (teamWidget = undefined));
  }
  return teamCheckBox;
}

// Runs a team change, showing what happened in the message line (and the button busy meanwhile).
async function runTeam(btn, work, done = "") {
  if (teamBusy) return;
  teamBusy = true;
  if (btn) btn.disabled = true;
  try {
    await work();
    community = keptTeams();
    sayTeam(done);
  } catch (err) {
    sayTeam(err.message || "That didn't work. Please try again.", { error: true });
  } finally {
    teamBusy = false;
    if (btn) btn.disabled = false;
    paintTeams();
  }
}

function makeReal(btn) {
  const name = teamInput.value.trim();
  if (!name) return sayTeam("Give your team a name.", { error: true });
  if (!teamToken) return sayTeam("Please finish the robot check first.", { error: true });
  runTeam(
    btn,
    async () => {
      const draft = team;
      const made = await makeTeam({ name, home: draft.home, away: draft.away, turnstileToken: useTeamToken() });
      mine = mine.filter((t) => t !== draft);
      if (draft === linkTeam) linkTeam = null;
      saveMyTeams(mine);
      community = keptTeams();
      wearTeam(made, kit); // and stays in the editor, showing the code
    },
    "Your team is ready! Share its code with friends.",
  );
}

// Saves a maker's changes to their team's name and kits.
async function saveCommunity() {
  const saved = keptTeam(team.key);
  const name = teamInput.value.trim() || saved?.name || team.name;
  const kitChanged = JSON.stringify([saved?.home, saved?.away]) !== JSON.stringify([team.home, team.away]);
  if (name !== saved?.name && !teamToken) {
    sayTeam("Please finish the robot check to change the name.", { error: true });
    return false;
  }
  let ok = true;
  await runTeam(null, async () => {
    try {
      if (kitChanged) Object.assign(team, await changeTeam(team, "kit", { home: team.home, away: team.away }));
      if (name !== saved?.name) Object.assign(team, await changeTeam(team, "name", { name, turnstileToken: useTeamToken() }));
    } catch (err) {
      ok = false;
      throw err;
    }
  });
  return ok;
}

async function leave_(t) {
  // The whole device leaves (team_members is per device), so its other players on this team leave too.
  const others = myPlayers().filter((p) => p.colours?.teamId === t.key && p.id !== ownPlayer?.id).map((p) => p.name);
  const detail = others.length ? `${others.join(", ")} on this device will leave it too. You can join again with the code.` : "You can join again with the code.";
  if (!(await confirmDialog(`Leave ${t.name}?`, { yes: "Leave", detail }))) return;
  runTeam(null, async () => {
    await leaveTeam(t);
    community = keptTeams();
    if (team?.key === t.key) wearTeam(TEAMS[0], "home");
  });
}

async function loadCommunity() {
  if (!COMMUNITY) return;
  const [{ teams, most }, open] = await Promise.all([refreshTeams(), listedTeams()]);
  community = teams;
  mostTeams = most;
  listed = open;
  // A player saved on a community team this device didn't know yet (another of their devices, with saved
  // progress): wear it again, unless they've picked another team since the builder opened.
  const saved = ownPlayer?.colours?.teamId;
  const back = saved && !isCommunity(team) && !editing && team.name === ownPlayer.colours.teamName ? community.find((t) => t.key === saved && t.member !== false) : null;
  // The team they wear may have gone (hidden, or they left on another device): back to an official one.
  if (back) {
    if (team === linkTeam) linkTeam = null;
    wearTeam(back, kit);
  } else if (isCommunity(team) && !community.some((t) => t.key === team.key && t.member !== false)) {
    wearTeam(TEAMS[0], "home");
    sayTeam("This team isn't around any more. Pick another team.");
  } else if (isCommunity(team)) wearTeam(community.find((t) => t.key === team.key), kit);
  else paintTeams();
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
  $("team-done").addEventListener("click", async () => {
    if (!teamInput.value.trim()) teamInput.value = team.name;
    if (isCommunity(team) && !(await saveCommunity())) return;
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
  for (const side of facing === null ? sidesOf(frames) : [facing]) {
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
  const has = (anim) => frames[anim]?.length > 0;
  const kept = steps.filter(([anim]) => has(anim));
  // nothing for that side (or no idle): whatever move the sheet has
  const any = has("idle") ? "idle" : Object.keys(frames).find(has);
  return (kept.length ? kept : any ? [[any, 3, 1]] : [])
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
  const parts = Object.fromEntries(PARTS.filter((p) => colours[p]).map((p) => [p, colours[p]]));
  // (a smaller sheet's number is printed less finely: still at least as fine as its art)
  const scale = current.meta.fullRes ? current.meta.res / current.meta.fullRes : 1;
  const kitText = { number: colours.number ?? "", team: colours.teamName ?? DEFAULT_TEAM, fine: scale < 0.7 ? 2 : scale < 0.9 ? 3 : undefined };
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
    if (!current) return; // the body is still loading: chooseBase() paints when it's in
    if (current.video) {
      // their gear on, then their height and build
      const img = recolor(current, colours);
      const dressed = wearGear({ meta: current.meta, img, prints: twinPrints(), regions: current.regionsData }, worn, colours);
      img.pixels = null; // (only needed by wearGear)
      sheet = stretchSheet(dressed, dressed.regions, build);
    } else {
      sheet = { meta: current.meta, img: recolor(current, colours), prints: null };
      sheet.img.pixels = null;
    }
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
let lastHeld = null; // where the held ball was last drawn, to send it off when they let go
let shotGone = false; // the ball has left their hands in this shot
let flight = null; // a shot ball flying off: canvas position, size, velocity, spin

// The canvas matches its size on screen, in device pixels, so the stage's whole area is drawn on
// (checked as each frame is drawn).
function fitCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
}

// ---------- Turning the player round ----------

let facing = null; // a side from SIDES once they've turned the player; null shows every side in turn
// The sides a sheet really has: a side that reuses another's frames (a kid's front-left can be their
// left until it's made) is left out, keeping the plainer name, so turning never shows the same twice.
const PLAINEST = ["-b", "-bl", "-l", "-r", "-br", "-fl", "-fr", ""];
function sidesOf(frames) {
  const seen = new Set();
  const kept = new Set();
  for (const side of PLAINEST) {
    const first = frames[`dribble${side}`]?.[0];
    if (!first || seen.has(first.join())) continue;
    seen.add(first.join());
    kept.add(side);
  }
  return SIDES.filter((side) => kept.has(side));
}
const turnLeft = $("turn-left");
const turnRight = $("turn-right");

function turn(step) {
  if (!current) return;
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
  fitCanvas();
  if (canvas.height < 60 || canvas.width < 60) return; // not laid out yet (or squeezed): nothing to draw
  const frames = sheet.meta.frames;
  // Find where we are in the show loop (standing still when motion is reduced).
  if (sheet.steps?.frames !== frames || sheet.steps.facing !== facing) sheet.steps = Object.assign(showSteps(frames, facing), { frames, facing });
  const steps = sheet.steps;
  if (!steps.length) return;
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
  const frame = step.list[Math.floor(t * step.fps) % step.list.length];
  if (!frame) return;
  const [x, y, w, h, ox, oy] = frame;
  const meta = sheet.meta;
  const res = meta.res;

  // The canvas fills the stage. The player is drawn no bigger than about 1.3 screen pixels to each of
  // the art's (so they stay crisp), and fits the tallest pose (ball overhead); with room to spare they
  // stand in the middle, and a shot flies on up to the stage's edge.
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  const tallest = 520 * res;
  const s = Math.max(0.05, Math.min((canvas.height - 26 * dpr) / tallest, 1.3 * dpr * (0.6 / res)));
  const groundX = canvas.width / 2;
  const groundY = Math.min(canvas.height - 14 * dpr, canvas.height / 2 + (tallest * s) / 2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(45, 20, 35, 0.35)";
  ctx.beginPath();
  ctx.ellipse(groundX, groundY, 70 * s * res, 22 * s * res, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const at = [Math.round(groundX + ox * s), Math.round(groundY + oy * s)];
  // a kid from video holds the game's own ball, drawn behind them
  const shooting = /^(gather|jump|release)/.test(step.anim);
  if (!shooting) shotGone = false;
  // once it's left their hands, a later frame of the shot that still has it doesn't bring it back
  const held = shotGone ? null : meta.balls?.[`${x},${y}`];
  if (held) {
    const d = 2 * held[2] * s * 1.04;
    ctx.drawImage(ball(held), at[0] + held[0] * s - d / 2, at[1] + held[1] * s - d / 2, d, d);
    lastHeld = { x: at[0] + held[0] * s, y: at[1] + held[1] * s, d, step, ox };
  } else if (lastHeld && step.anim.startsWith("release") && !reducedMotion.matches) {
    // The ball has left their hands: from where the game lets it go for this way they face
    // (releaseOffsets, from the feet, in court pixels: times res for the sheet's; a right side is the
    // left mirrored, so its offset is too), on a
    // shot's arc that way, with backspin. A ball only hidden behind the head in a jump isn't let go.
    const side = step.anim.split("-")[1] ?? "";
    const [offX, offY] = meta.releaseOffsets?.[side] ?? meta.releaseOffset ?? [0, -455];
    const [dx, dz] = SHOT_WAY[side] ?? SHOT_WAY[""];
    flight = { x0: groundX + offX * res * s, y0: groundY + offY * res * s, d: lastHeld.d, s, dx, dz, t: now };
    lastHeld = null;
    shotGone = true;
  } else if (!shooting) lastHeld = null;
  const flying = flight && flightAt(flight, now);
  if (flying && !flying.front) ctx.drawImage(flying.img, flying.x - flying.r, flying.y - flying.r, 2 * flying.r, 2 * flying.r);
  ctx.drawImage(sheet.img, x, y, w, h, at[0], at[1], w * s, h * s);
  // a kid from video: their number and team name, printed finer than the art (as in the game)
  const print = sheet.prints?.get(`${x},${y}`);
  if (print) ctx.drawImage(print, 0, 0, print.width, print.height, at[0], at[1], w * s, h * s);
  // a shot coming toward us flies in front of them
  if (flying?.front) ctx.drawImage(flying.img, flying.x - flying.r, flying.y - flying.r, 2 * flying.r, 2 * flying.r);
}

// A shot in the preview: where it goes for each way they face, across the screen (right +) and into it
// (away +). A kid's plain moves face up the court, away and to the left.
// A kid's left (and right) shot is their front-left video (flipped for the right), so it comes out toward us.
const SHOT_WAY = { "": [-0.55, 0.85], b: [0, 1], bl: [-0.55, 0.85], br: [0.55, 0.85], l: [-0.55, -0.85], r: [0.55, -0.85], fl: [-0.55, -0.85], fr: [0.55, -0.85], f: [0, -1] };
const SHOT_UP = 520; // art pixels a second, upward at the release: a little over the head, then down
const SHOT_ON = 620; // and along the ground, the way they face
const SHOT_FALL = 1150; // gravity
const DEPTH_RISE = 0.3; // on screen, further away is a little higher up
const DEPTH_SHRINK = 0.0011; // and smaller

// Where a shot is now (canvas position, radius, which frame), or null once it's gone from the stage.
function flightAt(f, now) {
  const t = (now - f.t) / 1000;
  const up = SHOT_UP * t - (SHOT_FALL * t * t) / 2;
  const along = SHOT_ON * t;
  const across = f.dx * along;
  const away = f.dz * along;
  const k = 1 / (1 + away * DEPTH_SHRINK);
  const x = f.x0 + across * f.s;
  const y = f.y0 - (up + away * DEPTH_RISE) * f.s;
  const r = (f.d / 2) * k;
  // a shot going away is gone (into a hoop in the distance) once it drops back to where it left the hands
  const done = f.dz > 0 ? t > 0.3 && up < 0 : t > 0.3 && up < -150;
  if (t > 2.5 || done || y < -r || y > canvas.height + r || x < -r || x > canvas.width + r) {
    flight = null;
    return null;
  }
  // backspin: turning against the way it travels on screen
  const sideways = Math.abs(f.dx) > Math.abs(f.dz);
  const turn = -9 * t * (sideways ? Math.sign(f.dx) : -Math.sign(f.dz || 1));
  return { x, y, r, front: f.dz < 0, img: ballFrame(ballSet(), turn, sideways) };
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
// The Turnstile script and site key, loaded once (for sending a player, and for making a team).
let turnstileLoad = null;
function loadTurnstile() {
  turnstileLoad ??= Promise.all([
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
  ]).then(([{ turnstileSiteKey }, turnstile]) => ({ turnstile, sitekey: turnstileSiteKey }));
  turnstileLoad.catch(() => (turnstileLoad = null));
  return turnstileLoad;
}
async function setupTurnstile() {
  turnstileStarted = true;
  try {
    const { turnstile, sitekey } = await loadTurnstile();
    widgetId = turnstile.render($("check"), {
      sitekey,
      theme: "dark",
      callback: (t) => (token = t),
      "expired-callback": () => (token = ""),
    });
  } catch {
    say(message, "Players can't be sent right now. Please try later.", { error: true });
  }
}

// What's saved with a player: their colours (with the team's name) and, for a kid from video, their size and gear.
const look = () => ({
  base: current.id,
  colours: { ...colours, teamName: colours.teamName ?? DEFAULT_TEAM },
  build: current.video ? { ...build } : undefined,
  gear: current.video && flagOn("gear") && Object.keys(gear).length ? { ...gear } : undefined,
});

// Before the body has loaded there's nothing to save yet (a fast tap on a slow connection).
function stillLoading() {
  if (current) return false;
  say(message, "Your player is still loading. Try again in a moment.", { error: true });
  return true;
}

function needName() {
  if (nameInput.value.trim()) return false;
  say(message, "Give your player a nickname.", { error: true });
  markField(nameInput, "Give your player a nickname.");
  nameInput.focus();
  return true;
}

// Play straight away: save to this device and jump into the game as them.
play.addEventListener("click", () => {
  if (rude || stillLoading() || needName()) return;
  const id = saveMyPlayer({ ...ownPlayer, name: nameInput.value.trim(), ...look() });
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
  if (stillLoading() || needName()) return;
  if (!token) {
    say(message, "Please finish the robot check first.", { error: true });
    return;
  }
  send.disabled = true;
  say(message, "Sending…");
  // Already playing as a player by this name on this device? Give it this look, here and on the
  // leaderboard (the server updates the scores this device played as it).
  const name = nameInput.value.trim();
  const same = ownPlayer ?? myPlayers().find((p) => p.name.toLowerCase() === name.toLowerCase());
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
        build: look().build,
        localId: same?.id,
        device,
        turnstileToken: token,
      }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    if (same) saveMyPlayer({ ...same, name, ...look(), sent: true });
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
  let startKit = "home";
  // Their own player on a community team: that team, in whichever kit they wear.
  const joined = ownPlayer?.colours?.teamId ? community.find((t) => t.key === ownPlayer.colours.teamId) : null;
  if (joined) {
    team = joined;
    if (jersey && jersey !== joined.home.jersey && jersey === joined.away.jersey) startKit = "away";
  } else if (jersey && trim) {
    // the team it's from, in either of its kits; else a team of yours in that kit
    const worn = { jersey, shorts: hexParam("shorts") ?? trim, trim };
    const same = (k) => KIT_PARTS.every((p) => k[p] === worn[p]);
    const known = [...mine, ...TEAMS].find((t) => t.name === (teamName || DEFAULT_TEAM) && (same(t.home) || same(t.away)));
    linkTeam = known ? null : { id: `mine${Date.now()}`, name: teamName || DEFAULT_TEAM, home: worn, away: { jersey: "#f2f2ef", shorts: trim, trim } };
    team = known ?? linkTeam;
    if (known && !same(known.home)) startKit = "away";
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
  wearTeam(team, startKit);
  if (ownPlayer) {
    document.querySelector(".builder-top h1").textContent = "Edit your player";
    document.title = "Edit your player | Orson Brooker";
    $("sent-note").hidden = !ownPlayer.sent;
  }
  requestAnimationFrame(draw);
  loadCards();
  loadCommunity();
}

setup().catch(() => {
  say(message, "The builder couldn't load. Try refreshing the page.", { error: true });
});
