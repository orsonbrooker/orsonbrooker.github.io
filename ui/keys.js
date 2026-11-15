// The keyboard, the same on every screen of the site (the game's sheets too). A screen opts in with markup
// and needs no key code of its own:
//
//   data-keys="grid"     on a container: the arrow keys move between its controls the way they're laid out,
//                        left and right within a row, up and down to the nearest row (landing on the control
//                        nearest across). Past its edge they carry on into the next group on screen.
//   data-keys="row"      the same, left and right only (up and down still scroll the page)
//   data-keys-default    on the control a screen starts on: where focus goes when a sheet opens (startOf),
//                        and where the arrow keys start when nothing on the screen has focus yet. Without one:
//                        what's pressed or selected, else the first that isn't data-keys-back.
//   data-keys-back       on a screen's back or close button, so a screen never starts there
//   data-keys-required   on a dialog that must be answered (a first team): tells verify keys that Escape must leave
//                        it open. The dialog's own cancel handler keeps it open; this module doesn't read it.
//
// Keyboard or touch: a key press marks the page data-input="keys", a tap or a click "touch" (usingKeys()).
// Only while the keyboard is in use does a screen opening put focus on its start (focusStart) and does anything
// look focused (styles.css). The first key after a tap starts on the screen's start control.
//
// The rest is the browser's: real <button>s and links (Enter, and Space on a button, press them), sliders
// (<input type="range">: the arrows slide them), Tab in the order things are on screen, and <dialog>s opened
// with showModal() (focus goes in, to its `autofocus` control, stays in, Escape closes it, and focus goes
// back where it was). An open dialog is always a group. What has focus shows the yellow highlight
// (styles.css, :focus-visible). Typing boxes keep their own arrow keys, and the arrows never land in one. Space to shoot, steering in Free
// play and Escape backing out of the game's sheets are the game's (engine/input.js).

const root = document.documentElement;
/** Whether the keyboard is what they're using now (else touch or a mouse). */
export const usingKeys = () => root.dataset.input === "keys";
for (const type of ["pointerdown", "touchstart"]) addEventListener(type, () => (root.dataset.input = "touch"), { capture: true, passive: true });

const ITEMS = 'a[href], button, summary, input, select, textarea, [role="tab"], [tabindex]:not([tabindex="-1"])';
// Typing boxes and sliders keep their own arrow keys, so the arrows never land in one (Tab does).
const ownsArrows = (el) => el.matches("textarea, select, input:not([type=button], [type=submit], [type=checkbox], [type=radio])");
const arrowable = (area) => reachable(area).filter((el) => !ownsArrows(el));

/** The controls in `area` the keyboard can reach now. */
export const reachable = (area) =>
  [...area.querySelectorAll(ITEMS)].filter(
    (el) =>
      !el.disabled &&
      !el.closest("[inert], [hidden]") &&
      !(el.closest("details:not([open])") && !el.matches("summary")) && // folded away
      el.getClientRects().length &&
      getComputedStyle(el).visibility !== "hidden",
  );

/** Puts focus on the control `area` starts on, if they're using the keyboard (with touch, nothing looks chosen). */
export function focusStart(area) {
  if (usingKeys()) startOf(area)?.focus({ preventScroll: true });
}

/** The control a screen starts on (data-keys-default, else what's picked, else the first that isn't its back button). */
export function startOf(area) {
  const all = reachable(area);
  return (
    all.find((el) => el.matches("[data-keys-default]")) ??
    all.find((el) => el.matches('[aria-pressed="true"], [aria-selected="true"]')) ??
    all.find((el) => !el.matches("[data-keys-back]")) ??
    all[0] ??
    null
  );
}

// The control the arrow key goes to from `from`: across, the nearest that way in the same row; up or down,
// the nearest row that way, then the control in it nearest across.
function nextThatWay(from, all, key) {
  const box = (el) => el.getBoundingClientRect();
  const c = box(from);
  const cx = c.left + c.width / 2;
  const sign = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  let best = null;
  let gap = Infinity;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    for (const el of all) {
      const r = box(el);
      const x = r.left + r.width / 2;
      if (el === from || (x - cx) * sign < 4 || r.bottom <= c.top + 2 || r.top >= c.bottom - 2) continue;
      if (Math.abs(x - cx) < gap) [best, gap] = [el, Math.abs(x - cx)];
    }
    return best;
  }
  const edge = (r) => (sign > 0 ? r.top - c.bottom : c.top - r.bottom);
  const rows = all.filter((el) => el !== from && edge(box(el)) >= -2);
  const near = Math.min(...rows.map((el) => edge(box(el))));
  for (const el of rows) {
    const r = box(el);
    if (edge(r) > near + Math.min(r.height, c.height) / 2) continue; // a row further on
    const d = r.right < cx ? cx - r.right : r.left > cx ? r.left - cx : 0;
    if (d < gap) [best, gap] = [el, d];
  }
  return best;
}


// The screen in front: an open dialog, or the group in the middle of the screen (the open sheet, the page).
const front = () => document.querySelector("dialog[open]") ?? document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("[data-keys]");

document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const fresh = root.dataset.input === "touch"; // the first key since a tap or a click
  root.dataset.input = "keys";
  const key = e.key;
  if (fresh && (key === "Tab" || key.startsWith("Arrow")) && !e.defaultPrevented) {
    // start on the screen in front's start control, rather than wherever a tap left focus
    const screen = front();
    const start = screen && startOf(screen);
    if (start && document.activeElement !== start) {
      e.preventDefault();
      start.focus({ preventScroll: true });
      return;
    }
  }
  if (!key.startsWith("Arrow") || e.defaultPrevented || e.shiftKey) return;
  const active = document.activeElement;
  const from = active instanceof HTMLElement && active !== document.body ? active : null;
  if (from && ownsArrows(from)) return;
  const modal = document.querySelector("dialog[open]");
  const groups = [...(modal ?? document).querySelectorAll("[data-keys]")].filter((g) => reachable(g).length);
  if (modal) groups.unshift(modal);
  const group = from && groups.findLast((g) => g.contains(from)); // the innermost
  let next = null;
  if (group && group === from) {
    next = startOf(group); // on the dialog itself (nothing picked yet): the arrows start on its first choice
  } else if (group) {
    if (group.dataset.keys === "row" && (key === "ArrowUp" || key === "ArrowDown")) return;
    next = nextThatWay(from, arrowable(group), key) ?? nextThatWay(from, groups.flatMap(arrowable), key);
  } else if (groups.length) {
    next = startOf(groups[0]); // focus isn't on a screen yet (it's on the game, or the page): start on one
  }
  if (!next) return;
  e.preventDefault();
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
});
