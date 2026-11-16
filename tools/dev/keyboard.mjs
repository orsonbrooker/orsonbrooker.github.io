// The keyboard check: every control on the site's screens can be reached and pressed with the keyboard alone,
// with real key presses in a headless Chrome. `node tools/dev/verify.mjs keys` runs both parts:
//
//   checkScreen  one page or screen (the site's pages, the builder's tabs, Choose your player, HORSE):
//   1. reaches: from the top of the page, presses Tab, and from every control it lands on presses Tab,
//      Shift+Tab and the arrow keys; every button and link must also be landed on by an arrow key (real key presses, through Chrome's input), until nothing new is reached. Every control
//      showing on the screen must be reached.
//   2. looks: each one, focused from the keyboard, must show the yellow highlight (#ffe066) as its outline,
//      edge or glow.
//   3. presses: Enter on each (and Space on each button) must click it. Links are held so the page stays.
//      Sliders must move with the arrow keys. A dialog or sheet that opens must take focus, keep it
//      through 12 Tabs, close on Escape and give focus back to what opened it.
//   Each screen is opened by `open()` (verify's KEY_SCREENS: its page, then what a kid taps first). A press
//   that leaves the page, or hides the rest, opens the screen again for the next one.
//   checkGame    the game's own sheets, walked through in order (below).
//   checkTouch   the same menus and pages opened by touch: nothing may look chosen (at the end).
// How a screen opts in, and what the browser does for free: ui/keys.js.

import { join } from "node:path";
import { wait } from "./cdp.mjs";

const KEYS = {
  Tab: [9, "Tab"], Enter: [13, "Enter", "\r"], " ": [32, "Space", " "], Escape: [27, "Escape"],
  ArrowLeft: [37, "ArrowLeft"], ArrowUp: [38, "ArrowUp"], ArrowRight: [39, "ArrowRight"], ArrowDown: [40, "ArrowDown"],
};

/** Presses a key the way a keyboard does (keydown, the character, keyup). */
export async function key(tab, name, { shift = false } = {}) {
  const [code, codeName, text] = KEYS[name];
  const base = { key: name, code: codeName, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
  await tab.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text } : {}) });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await wait(name === "Tab" || name.startsWith("Arrow") ? 25 : 250);
}

// Page code: gives every control showing an id (data-kb) and lists them.
const MARK = `
  const SEL = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [role="tab"]';
  const open = document.querySelector("dialog[open], [role=dialog]:not([hidden])");
  window.__kbN ??= 0;
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: false }) || el.closest("[inert]")) continue;
    if (open && !open.contains(el)) continue; // only the dialog's, while one is open
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // covered by a screen or sheet over it (the game behind its menus): not on show
    const top = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
    if (r.top >= 0 && r.bottom <= innerHeight && top && !el.contains(top) && !top.contains(el) && !open) continue;
    if (el.closest(".cf-turnstile, iframe")) continue; // the robot check is Cloudflare's
    el.dataset.kb ??= String(++window.__kbN);
    out.push({ id: el.dataset.kb, name: (el.getAttribute("aria-label") || el.textContent || el.id || el.className || el.tagName).trim().replace(/\\s+/g, " ").slice(0, 40), tag: el.tagName.toLowerCase(), type: el.type ?? "", role: el.getAttribute("role") ?? "", link: !!el.closest("a[href]") });
  }
  return out;`;
const ACTIVE = `const a = document.activeElement; if (!a || a === document.body) return null; a.dataset.kb ??= String(++window.__kbN); return a.dataset.kb;`;
const focusIt = (id) => `const el = document.querySelector('[data-kb="${id}"]'); if (!el) return false; el.focus({ preventScroll: false }); return document.activeElement === el;`;
const LOOK = (id) => `
  const el = document.querySelector('[data-kb="${id}"]');
  const yellow = (x) => {
    const s = getComputedStyle(x);
    const ring = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 && /255,\\s*224,\\s*102/.test(s.outlineColor);
    const edge = /255,\\s*224,\\s*102/.test(s.borderTopColor) && parseFloat(s.borderTopWidth) > 0;
    return ring || edge || /255,\\s*224,\\s*102/.test(s.boxShadow);
  };
  // the highlight is on the control, or on the one thing it holds (a picture that is the button)
  return { yellow: yellow(el) || (el.children.length === 1 && yellow(el.children[0])), visible: el.matches(":focus-visible") };`;
// Clicks reaching a control, recorded; links are held so pressing them doesn't leave the page.
const LISTEN = `
  window.__kbClicks = [];
  if (!window.__kbListening) {
    window.__kbListening = true;
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-kb]");
      if (el) window.__kbClicks.push(el.dataset.kb);
      if (e.target.closest("a[href]")) e.preventDefault();
    }, true);
  }`;
const OPEN_DIALOG = `const d = [...document.querySelectorAll("dialog[open], [role=dialog]")].find((x) => !x.hidden && x.checkVisibility()); if (!d) return null; d.dataset.kbDialog ??= String(Math.random()); return d.dataset.kbDialog;`;
const FOCUS_IN = (d) => `const d = document.querySelector('[data-kb-dialog="${d}"]'); return !!d && d.contains(document.activeElement);`; // (on the dialog itself is fine: nothing picked yet)
// Tab past a modal dialog's last control goes to the browser's own bar (no element has focus), then back:
// what matters is that nothing on the page behind gets it.
const FOCUS_NOT_BEHIND = (d) => `const d = document.querySelector('[data-kb-dialog="${d}"]'); const a = document.activeElement; return !a || a === document.body || d.contains(a);`;

/**
 * Checks one screen. `open()` (re)loads it and runs its setup; returns { ok, problems, reached, total }.
 */
export async function checkScreen(tab, open) {
  const problems = [];
  await open();
  await tab.run(LISTEN);
  const controls = await tab.run(MARK);
  const byId = new Map(controls.map((c) => [c.id, c]));
  const label = (id) => { const c = byId.get(id); return c ? `${c.tag}${c.role ? `[${c.role}]` : ""} "${c.name}"` : `#${id}`; };

  // 1. Reach
  // where the screen put focus when it opened, else the first Tab from the top
  let start = await tab.run(ACTIVE);
  if (!start || !byId.has(start)) {
    await tab.run(`document.activeElement?.blur(); window.scrollTo(0, 0);`);
    for (let i = 0; i < 3 && !start; i++) {
      await key(tab, "Tab");
      start = await tab.run(ACTIVE);
    }
  }
  const reached = new Set(start ? [start] : []);
  const byArrows = new Set(start ? [start] : []); // reached by an arrow key from another control
  const queue = start ? [start] : [];
  while (queue.length) {
    const id = queue.shift();
    const c = byId.get(id);
    const keys = ["Tab", "Shift+Tab"];
    // the arrows belong to typing boxes, sliders and lists
    if (c && c.tag !== "input" && c.tag !== "textarea" && c.tag !== "select") keys.push("ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp");
    for (const k of keys) {
      if (!(await tab.run(focusIt(id)))) break;
      await key(tab, k.replace("Shift+", ""), { shift: k.startsWith("Shift+") });
      const now = await tab.run(ACTIVE);
      if (now && k.startsWith("Arrow") && now !== id) byArrows.add(now);
      if (now && !reached.has(now)) {
        reached.add(now);
        if (byId.has(now)) queue.push(now);
      }
    }
  }
  const missed = controls.filter((c) => !reached.has(c.id));
  if (missed.length) problems.push(`can't be reached with Tab or the arrow keys: ${missed.map((c) => label(c.id)).join(", ")}`);
  // and the arrow keys must move between them (a screen that didn't opt in with data-keys only has Tab);
  // typing boxes and sliders keep their arrows, so Tab is enough for them
  const typed = (c) => ["input", "textarea", "select"].includes(c.tag);
  const noArrows = controls.filter((c) => reached.has(c.id) && !typed(c) && !byArrows.has(c.id));
  if (noArrows.length) problems.push(`the arrow keys never land on: ${noArrows.map((c) => label(c.id)).join(", ")}`);

  // 2. Look and 3. press: each from a fresh screen when the last press changed it
  const noYellow = [];
  const noClick = [];
  const dialogs = [];
  for (const c of controls.filter((x) => reached.has(x.id))) {
    const there = await tab.run(`const el = document.querySelector('[data-kb="${c.id}"]'); return !!el && el.checkVisibility() && !el.closest("[inert]") && !document.querySelector("dialog[open]");`);
    if (!there) {
      await open();
      await tab.run(LISTEN);
      const again = await tab.run(MARK); // a fresh page numbers its controls in the same order
      if (again.find((x) => x.id === c.id)?.name !== c.name) continue; // not on the fresh screen: left as is
    }
    // focused just after a key press, so Chrome shows it as keyboard focus
    await tab.run(focusIt(c.id));
    const look = await tab.run(LOOK(c.id));
    if (!look.yellow) noYellow.push(label(c.id));

    if (c.tag === "input" && c.type === "range") {
      const val = () => tab.run(`return document.querySelector('[data-kb="${c.id}"]').value`);
      const before = await val();
      await key(tab, before === (await tab.run(`return document.querySelector('[data-kb="${c.id}"]').max`)) ? "ArrowLeft" : "ArrowRight");
      if (before === (await val())) problems.push(`slider ${label(c.id)} doesn't move with the arrow keys`);
      continue;
    }
    if (["input", "textarea", "select"].includes(c.tag)) continue; // typed into, not pressed

    // Enter on everything; then, on a button that's still there, Space as well
    const url = await tab.run(`return location.href`);
    for (const k of c.tag === "button" || c.role === "button" ? ["Enter", " "] : ["Enter"]) {
      await tab.run(`window.__kbClicks = [];`);
      if (!(await tab.run(focusIt(c.id)))) break;
      if (await tab.run(`return !!document.querySelector("dialog[open]")`)) break;
      const dialogBefore = await tab.run(OPEN_DIALOG);
      await key(tab, k);
      await wait(250);
      if ((await tab.run(`return location.href`)) !== url) break; // it went to another page: it was pressed
      if (!(await tab.run(`return window.__kbClicks.includes("${c.id}")`))) noClick.push(`${label(c.id)} (${k === " " ? "Space" : k})`);
      const dialog = await tab.run(OPEN_DIALOG);
      if (dialog && dialog !== dialogBefore) {
        dialogs.push(label(c.id));
        await wait(300);
        if (!(await tab.run(FOCUS_IN(dialog)))) problems.push(`${label(c.id)} opens a dialog that doesn't take focus`);
        for (let i = 0; i < 12; i++) {
          await key(tab, "Tab");
          if (!(await tab.run(FOCUS_NOT_BEHIND(dialog)))) { problems.push(`focus leaves the dialog ${label(c.id)} opens`); break; }
        }
        const required = await tab.run(`return document.querySelector('[data-kb-dialog="${dialog}"]').matches("[data-keys-required]")`);
        if (required) {
          // it must be answered: Escape leaves it open; closed here to carry on
          await key(tab, "Escape");
          if (!(await tab.run(`return document.querySelector('[data-kb-dialog="${dialog}"]')?.open`))) problems.push(`Escape closes the dialog ${label(c.id)} opens, though it must be answered`);
          await tab.run(`document.querySelector('[data-kb-dialog="${dialog}"]')?.close()`);
          await wait(800); // the screen may redraw after it (Choose your player redraws its cards)
          continue;
        }
        await key(tab, "Escape");
        await wait(400);
        if (await tab.run(`const d = document.querySelector('[data-kb-dialog="${dialog}"]'); return !!d && d.checkVisibility() && (d.open ?? !d.hidden);`)) problems.push(`Escape doesn't close the dialog ${label(c.id)} opens`);
        else if ((await tab.run(ACTIVE)) !== c.id) problems.push(`closing the dialog ${label(c.id)} opens doesn't give focus back to it`);
      }
    }
  }
  if (noYellow.length) problems.push(`no yellow highlight when focused: ${noYellow.join(", ")}`);
  if (noClick.length) problems.push(`the key doesn't press it: ${noClick.join(", ")}`);
  return { ok: !problems.length, problems, reached: controls.filter((c) => reached.has(c.id)).length, total: controls.length, dialogs };
}

// ---------- The game, walked through by keyboard ----------
//
//   checkGame    the game's sheets in the order a kid meets them: the title's corner buttons, the menu, the
//                leaderboard, the shop, How to play, Choose a game, Choose your player, the team picker,
//                START, pause and game over. On each, every button is reached with the arrow keys (from
//                where focus lands, following the layout) and with Tab, pressed with Enter and shows
//                yellow; a sheet opening puts focus on its main button (data-keys-default) and Escape
//                closes it.
const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

// In the page: what the keyboard can reach in an area, tagged data-k, and whether the focused one shows yellow.
const PAGE = `
window.__k = {
  tag(sel) {
    const shows = (el) => !el.disabled && !el.closest("[inert], [hidden]") && !(el.closest("details:not([open])") && !el.matches("summary")) && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
    const els = [...document.querySelectorAll(sel)].flatMap((area) => [...area.querySelectorAll("button, a[href], summary, input, select, textarea, [tabindex]:not([tabindex='-1'])")]).filter(shows);
    document.querySelectorAll("[data-k]").forEach((el) => el.removeAttribute("data-k"));
    els.forEach((el, i) => (el.dataset.k = String(i)));
    return els.map((el) => (el.id ? "#" + el.id : "") + " " + (el.getAttribute("aria-label") || el.textContent.trim().replace(/\\s+/g, " ").slice(0, 24)));
  },
  now: () => document.activeElement?.dataset.k ?? null,
  nowId: () => { const a = document.activeElement; return a ? (a.id ? "#" + a.id : a.className || a.tagName) : null; },
  focus(k) { document.querySelector('[data-k="' + k + '"]').focus(); },
  yellow() {
    const el = document.activeElement;
    if (!el) return false;
    const y = (v) => /255, 224, 102/.test(v);
    const cs = getComputedStyle(el);
    if (cs.outlineStyle !== "none" && y(cs.outlineColor) && parseFloat(cs.outlineWidth) >= 2) return true;
    if (y(cs.borderTopColor) && parseFloat(cs.borderTopWidth) >= 2) return true;
    if (y(cs.boxShadow)) return true;
    const art = el.querySelector(".arcade-art");
    return !!art && y(getComputedStyle(art).filter);
  },
  clicks: [],
  block(on) {
    const f = (window.__kBlock ??= (e) => { window.__k.clicks.push(e.target.closest("[data-k]")?.dataset.k ?? null); e.preventDefault(); e.stopImmediatePropagation(); });
    (on ? window.addEventListener : window.removeEventListener)("click", f, true);
  },
};
return 1;`;

/**
 * Checks one sheet (or the title's corners): `sel` the area, `name` for the report, `main` the selector focus should
 * land on as it opens (or null). Focus must be in it already. Returns problems, one line each.
 */
async function sheet(tab, sel, main) {
  const problems = [];
  const labels = await tab.run(`return __k.tag(${JSON.stringify(sel)})`);
  if (main && !(await tab.run(`return document.activeElement?.matches(${JSON.stringify(main)})`)))
    problems.push(`focus landed on ${await tab.run("return __k.nowId()")}, not ${main}`);
  let start = await tab.run("return __k.now()");
  if (start === null) {
    await key(tab, "ArrowDown"); // nothing there focused yet: the arrows start it
    start = await tab.run("return __k.now()");
  }
  if (start === null) return [`focus isn't on anything in ${sel}, even after an arrow key`, ...problems];
  // the arrows: every button reachable from where focus starts
  const seen = new Set([start]);
  const queue = [start];
  const noRing = new Set();
  while (queue.length) {
    const k = queue.shift();
    for (const a of ARROWS) {
      await tab.run(`__k.focus(${JSON.stringify(k)}); return 1;`);
      await key(tab, a);
      const to = await tab.run("return __k.now()");
      if (to !== null && !(await tab.run("return __k.yellow()"))) noRing.add(to);
      if (to !== null && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  const missed = labels.map((l, i) => [String(i), l]).filter(([i]) => !seen.has(i)).map(([, l]) => l);
  if (missed.length) problems.push(`the arrow keys can't reach: ${missed.join(", ")}`);
  if (noRing.size) problems.push(`no yellow focus on: ${[...noRing].map((k) => labels[k]).join(", ")}`);
  // Tab: every button, going round
  await tab.run(`__k.focus(${JSON.stringify(start)}); return 1;`);
  const tabbed = new Set([start]);
  for (let i = 0; i < labels.length * 2 + 4; i++) {
    await key(tab, "Tab");
    const k = await tab.run("return __k.now()");
    if (k !== null) tabbed.add(k);
  }
  const untabbed = labels.map((l, i) => [String(i), l]).filter(([i]) => !tabbed.has(i)).map(([, l]) => l);
  if (untabbed.length) problems.push(`Tab can't reach: ${untabbed.join(", ")}`);
  // Enter presses each one (the click stops there)
  await tab.run("__k.clicks = []; __k.block(true); return 1;");
  const dead = [];
  for (let i = 0; i < labels.length; i++) {
    await tab.run(`__k.focus("${i}"); __k.clicks = []; return 1;`);
    await key(tab, "Enter");
    if (!(await tab.run(`return __k.clicks.includes("${i}")`))) dead.push(labels[i]);
  }
  await tab.run("__k.block(false); return 1;");
  if (dead.length) problems.push(`Enter doesn't press: ${dead.join(", ")}`);
  return problems;
}

/** Runs the whole check on the game at `base` (a built site), recording a line per screen. */
export async function checkGame(tab, base, record, out) {
  await tab.viewport(1180, 820); // an iPad held sideways, with a keyboard
  await tab.goto(`${base}/games/shootaround/?debug`, 7000);
  await tab.run(PAGE);
  const shot = (name) => tab.screenshot(join(out, `${name}.png`));
  const phase = () => tab.run("return document.querySelector('.game-page')?.dataset.phase");
  const isOpen = (id) => tab.run(`return !document.getElementById("${id}").hidden`);
  const report = async (name, problems, extra = []) => record(`keyboard: ${name}`, !problems.length, [...problems, ...extra].join("\n"), [await shot(name.replace(/\W+/g, "-"))]);
  const focusOn = (sel) => tab.run(`document.querySelector(${JSON.stringify(sel)}).focus(); return 1;`);

  // the title: the corner buttons
  await key(tab, "ArrowRight");
  await report("title corners", await sheet(tab, ".corner", null));

  // the sheets the corners open: focus lands on the main button, Escape closes, focus goes back to the corner
  for (const [name, button, id, main] of [
    ["menu", "#menu-button", "menu-screen", '[data-menu="play"]'],
    ["leaderboard", "#board-button", "board-screen", null],
    ["shop", "#shop-button", "shop-screen", null],
    ["how to play", "#help-button", "help-screen", "#help-close"],
  ]) {
    await focusOn(button);
    await key(tab, "Enter");
    await wait(600);
    if (!(await isOpen(id))) {
      await report(name, [`Enter on ${button} didn't open it`]);
      continue;
    }
    const problems = await sheet(tab, `#${id}`, main);
    await shot(`${name.replace(/\W+/g, "-")}-open`);
    await key(tab, "Escape");
    await wait(300);
    if (await isOpen(id)) problems.push("Escape didn't close it");
    else if (!(await tab.run(`return document.activeElement?.matches("${button}")`))) problems.push(`focus didn't go back to ${button}`);
    await report(name, problems);
  }

  // Choose a game: Space from the title
  await tab.run("document.getElementById('stage').focus(); return 1;");
  await key(tab, " ");
  await wait(800);
  if (!(await isOpen("mode-screen"))) return report("choose a game", ["Space on the title didn't open Choose a game"]);
  await report("choose a game", await sheet(tab, "#mode-screen", ".mode-card"));
  // Escape back, Space again, then pick Time attack for real: Choose your player (the first time)
  await key(tab, "Escape");
  await wait(400);
  const backProblems = (await phase()) === "title" ? [] : ["Escape on Choose a game didn't go back to the title"];
  await tab.run("document.getElementById('stage').focus(); return 1;");
  await key(tab, " ");
  await wait(800);
  await focusOn('.mode-card[data-mode="timed"]');
  await key(tab, "Enter");
  await wait(800);
  if (await isOpen("select-screen")) await report("choose your player", [...backProblems, ...(await sheet(tab, "#select-screen", ".card"))]);
  // START: pick a player for real (the first time, a team picker comes up first: it's
  // checked too, then its first team picked), then START has focus and Enter opens the gym
  await focusOn("#char-pick .card");
  await key(tab, "Enter");
  await wait(1200);
  if (await tab.run("return !!document.querySelector('dialog[open]')")) {
    await report("team picker", await sheet(tab, "dialog[open]", null));
    await tab.run("__k.focus('0'); return 1;");
    await key(tab, "Enter");
  }
  await wait(2500);
  const startProblems = [];
  if (!(await tab.run("return document.activeElement?.matches('.box-start')"))) startProblems.push(`focus is on ${await tab.run("return __k.nowId()")}, not START`);
  else if (!(await tab.run("return __k.yellow()"))) startProblems.push("START has focus but shows no yellow edge");
  await shot("start-focused");
  await key(tab, "Enter");
  await wait(3500);
  if (await tab.run("return !document.querySelector('.box-start').hidden && !document.querySelector('.box-start').disabled")) startProblems.push("Enter on START didn't open the gym");
  await report("START", startProblems);

  // pause: Escape in a game; focus on Resume
  await key(tab, "Escape");
  await wait(500);
  if (!(await isOpen("pause-screen"))) await report("pause", ["Escape in a game didn't pause it"]);
  else {
    const problems = await sheet(tab, "#pause-screen", "#pause-resume");
    await focusOn("#pause-resume");
    await key(tab, "Enter");
    await wait(400);
    if (await isOpen("pause-screen")) problems.push("Enter on Resume didn't carry on");
    await report("pause", problems);
  }

  // game over: the clock run down; focus on Play again
  await tab.run("window.game.state.timeLeft = 0.3; return 1;");
  for (let i = 0; i < 40 && (await phase()) !== "over"; i++) await wait(500);
  await wait(1200);
  if (!(await isOpen("over-screen"))) await report("game over", ["the game didn't end"]);
  else {
    const problems = await sheet(tab, "#over-screen", "#again");
    await wait(1000);
    await key(tab, "Escape");
    await wait(500);
    if (await isOpen("over-screen")) problems.push("Escape didn't close it");
    await report("game over", problems);
  }
}

// ---------- Touch: nothing looks chosen ----------
//
//   checkTouch   on a phone (touch, no keyboard), opens the game's menus and the site's pages with taps and
//                fails if anything looks focused: a control with keyboard focus showing, a card lifted or
//                tilted, the bouncing arrow over a card, or a yellow edge on something that isn't a real
//                choice (a picked swatch, team or tab, marked aria-pressed, -checked or -selected, stays).

/** Taps the middle of what `sel` finds, as a finger does. */
async function tap(tab, sel) {
  const at = await tab.run(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`);
  if (!at) return false;
  const point = [{ x: at[0], y: at[1] }];
  await tab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(900);
  return true;
}

// In the page: what in `sel` looks chosen though it's only been tapped.
const LOOKS_FOCUSED = (sel) => `
  const yellow = (v) => /255,\\s*224,\\s*102/.test(v);
  const real = '[aria-pressed="true"], [aria-checked="true"], [aria-selected="true"], [aria-current="page"]';
  const out = [];
  const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.className).trim().replace(/\\s+/g, " ").slice(0, 30);
  const a = document.activeElement;
  if (a && a !== document.body && a.matches(":focus-visible") && !a.matches("input:not([type=button], [type=submit]), textarea, select")) out.push("keyboard focus showing on " + name(a));
  for (const area of document.querySelectorAll(${JSON.stringify(sel)})) {
    for (const el of area.querySelectorAll("button, a[href], [tabindex]")) {
      if (!el.checkVisibility()) continue;
      const s = getComputedStyle(el);
      if (s.transform !== "none" && !/^matrix\\(1, 0, 0, 1, 0, 0\\)$/.test(s.transform)) out.push("lifted: " + name(el));
      if (parseFloat(getComputedStyle(el, "::after").opacity) > 0 && getComputedStyle(el, "::after").animationName !== "none") out.push("arrow over: " + name(el));
      if (!el.matches(real) && ((yellow(s.borderTopColor) && parseFloat(s.borderTopWidth) > 0) || yellow(s.boxShadow) || (s.outlineStyle !== "none" && yellow(s.outlineColor)))) out.push("yellow: " + name(el));
    }
  }
  return [...new Set(out)];`;

/** Opens menus and pages by touch at phone size and records whether anything looks chosen. */
export async function checkTouch(tab, base, record, out) {
  await tab.viewport(390, 844, { scale: 2, mobile: true });
  await tab.goto(`${base}/404.html`, 800);
  await tab.run(`localStorage.clear(); sessionStorage.clear();`);
  const look = async (name, sel) => {
    const found = await tab.run(LOOKS_FOCUSED(sel));
    const file = join(out, `touch-${name.replace(/\W+/g, "-")}.png`);
    await tab.screenshot(file);
    record(`touch: ${name}`, !found.length, found.length ? `looks chosen though only tapped: ${found.join(", ")}` : "", [file]);
  };
  const isOpen = (id) => tab.run(`return !document.getElementById("${id}")?.hidden`);

  // the game: the title, then each menu a tap opens
  await tab.goto(`${base}/games/shootaround/`, 6000);
  await look("title", ".corner");
  for (const [name, button, id] of [["menu", "#menu-button", "menu-screen"], ["leaderboard", "#board-button", "board-screen"], ["shop", "#shop-button", "shop-screen"], ["how to play", "#help-button", "help-screen"]]) {
    if (!(await tap(tab, button)) || !(await isOpen(id))) {
      record(`touch: ${name}`, false, `a tap on ${button} didn't open it`);
      continue;
    }
    await look(name, `#${id}`);
    await tap(tab, `#${id} .screen-back`);
  }
  await tap(tab, "#stage");
  if (await isOpen("mode-screen")) {
    await look("choose a game", "#mode-screen");
    await tap(tab, '.mode-card[data-mode="timed"]');
    if (await isOpen("select-screen")) await look("choose your player", "#select-screen");
    await tap(tab, "#select-back");
    await tap(tab, "#mode-back");
    // their last game is remembered now: it mustn't look chosen either
    await tap(tab, "#stage");
    if (await isOpen("mode-screen")) await look("choose a game, again", "#mode-screen");
  } else record("touch: choose a game", false, "a tap on the game didn't open Choose a game");

  // the site's pages
  for (const [name, path, steps] of [["home", "/", []], ["ideas", "/ideas/", []], ["404", "/404.html", []], ["builder", "/players/", ["#tab-body", "#tab-team", "#tab-gear", "#tab-character"]]]) {
    await tab.goto(base + path, 3000);
    await tap(tab, "main");
    for (const step of steps) await tap(tab, step);
    await look(name, "body");
  }
}
