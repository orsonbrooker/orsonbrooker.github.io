// The shop: ball styles bought with coins earned by playing, and a pairing code to bring them to
// another device. Opens over whichever screen is showing and goes back to it, like help.

import { makeBallFrames } from "../engine/draw.js";
import { buyBall, hasProgress, joinWithCode, onProgress, owns, pairCode, progress, refreshProgress, useBall } from "../progress.js";
import { $, openScreen, screens, showScreen, stage } from "../screens/base.js";
import { BALL_STYLES } from "../shared/shop.js";
import { confirmDialog } from "../ui/confirm.js";
import { icon } from "../ui/icons.js";

const list = $("ball-styles");
const say = (text) => ($("shop-say").textContent = text);
// Pairing messages sit in their own step, at the bottom of the shop, which scrolls on a phone: each
// one is brought into view.
const note = (id, text) => {
  $(id).textContent = text;
  if (text) $(id).scrollIntoView({ block: "nearest", behavior: REDUCED_MOTION.matches ? "auto" : "smooth" });
};
const sendSay = (text) => note("pair-send-say", text);
const joinSay = (text) => note("pair-join-say", text);
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)");

// Each style's spinning frames, made once.
const frames = new Map();
const framesFor = (style) => frames.get(style.id) ?? frames.set(style.id, makeBallFrames(style.look)).get(style.id);

const coinText = (n) => `${n} ${n === 1 ? "coin" : "coins"}`;

function render() {
  // Before their first coins there's nothing to bring, so no code to show (they can still type one in).
  const saved = hasProgress();
  $("pair-show").hidden = !saved || !$("pair-code").hidden;
  $("pair-send-text").textContent = saved ? "Get a code that works once, for 10 minutes." : "Play a game to earn some coins first. Then come back here for a code.";
  $("shop-coins").innerHTML = icon("coins");
  $("shop-coins").append(String(progress.coins));
  $("shop-coins").setAttribute("aria-label", coinText(progress.coins));
  list.replaceChildren(
    ...BALL_STYLES.map((style) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ball-card";
      card.dataset.ball = style.id;
      const using = progress.ball === style.id;
      card.setAttribute("aria-pressed", String(using));
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      canvas.getContext("2d").drawImage(framesFor(style)[0], 0, 0);
      const name = Object.assign(document.createElement("strong"), { textContent: style.name });
      const tag = document.createElement("em");
      if (using) tag.textContent = "Using";
      else if (owns(style.id)) tag.textContent = "Use";
      else {
        tag.innerHTML = icon("coins");
        tag.append(String(style.price));
        tag.classList.add("price");
        if (style.price > progress.coins) card.classList.add("locked");
      }
      card.append(canvas, name, tag);
      card.addEventListener("click", () => pick(style));
      return card;
    }),
  );
}

let busy = false;
async function pick(style) {
  if (busy || progress.ball === style.id) return;
  say("");
  if (!owns(style.id)) {
    if (style.price > progress.coins) return say(`You need ${coinText(style.price - progress.coins)} more for ${style.name}. Keep shooting!`);
    const yes = await confirmDialog(`Get the ${style.name} ball?`, { yes: `Buy for ${style.price}`, no: "Not now", yesIcon: "coins", detail: `You have ${coinText(progress.coins)}.` });
    if (!yes) return;
  }
  busy = true;
  try {
    await (owns(style.id) ? useBall(style.id) : buyBall(style.id));
    say(`You're using the ${style.name} ball!`);
  } catch (err) {
    say(err.message);
  } finally {
    busy = false;
  }
}

// The balls spin while the shop is open (not with reduced motion).
let spin = null;
function startSpin() {
  if (REDUCED_MOTION.matches) return;
  let frame = 0;
  spin = setInterval(() => {
    frame = (frame + 1) % 12;
    for (const card of list.querySelectorAll(".ball-card")) {
      const style = BALL_STYLES.find((s) => s.id === card.dataset.ball);
      const g = card.querySelector("canvas").getContext("2d");
      g.clearRect(0, 0, 16, 16);
      g.drawImage(framesFor(style)[frame], 0, 0);
    }
  }, 90);
}

// ---------- Another device ----------

let codeTimer = null;
// Back to step 1's button (a code ran out, or the shop opened again).
function resetCode() {
  clearTimeout(codeTimer);
  $("pair-code").hidden = true;
  $("pair-show").hidden = !hasProgress();
}

async function showCode() {
  sendSay("");
  try {
    const { code, minutes } = await pairCode();
    $("pair-code").textContent = code;
    $("pair-code").hidden = false;
    $("pair-show").hidden = true;
    sendSay("Now type it in step 2 on your other device.");
    clearTimeout(codeTimer);
    codeTimer = setTimeout(() => {
      resetCode();
      sendSay("That code has run out. Get a new one when you're ready.");
    }, minutes * 60_000);
  } catch (err) {
    sendSay(err.message);
  }
}

async function join(e) {
  e.preventDefault();
  const code = $("pair-input").value;
  if (code.replace(/[^0-9a-z]/gi, "").length !== 8) return joinSay("A code is 8 letters and numbers, like ABCD-EFGH.");
  const before = progress.coins;
  try {
    await joinWithCode(code);
    $("pair-input").value = "";
    joinSay(before ? `Joined! Your coins are all together now: ${coinText(progress.coins)}.` : `Joined! You've got ${coinText(progress.coins)}.`);
  } catch (err) {
    joinSay(err.message);
  }
}

// ---------- Open and close ----------

let shopReturn = null;
export function openShop() {
  shopReturn = openScreen();
  say("");
  sendSay("");
  joinSay("");
  resetCode();
  render();
  showScreen("shop");
  startSpin();
  $("shop-back").focus({ preventScroll: true });
  refreshProgress(); // another device may have spent or earned some
}
export function closeShop() {
  clearInterval(spin);
  showScreen(shopReturn === "shop" ? "title" : shopReturn);
  stage.focus({ preventScroll: true });
}
export const toggleShop = () => (screens.shop.hidden ? openShop() : closeShop());

export function wireShop() {
  $("shop-button").addEventListener("click", toggleShop);
  $("shop-back").addEventListener("click", closeShop);
  $("pair-show").addEventListener("click", showCode);
  $("pair-form").addEventListener("submit", join);
  onProgress(() => {
    if (!screens.shop.hidden) render();
  });
}
