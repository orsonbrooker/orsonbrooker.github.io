// Saved progress, the game's side: coins earned by playing and the ball styles they buy, kept on the
// server (worker/src/progress.ts) so they can come along to another device with a pairing code.
//
// This device holds a random key, given by the server with its first coins. The last known coins and
// ball are kept here too, so the shop and the ball look right straight away (and offline).

import { API } from "./api.js";
import { load, save } from "./engine/storage.js";
import { BALL_STYLES, DEFAULT_BALL, ballStyle } from "./shared/shop.js";

const KEY = "orson-progress-key";
const KNOWN = "orson-progress";

const fresh = () => ({ coins: 0, earned: 0, ball: DEFAULT_BALL, items: [DEFAULT_BALL] });
export const progress = { ...fresh(), ...load(KNOWN, {}) };

const listeners = new Set();
/** Called with `progress` whenever it changes. */
export const onProgress = (fn) => listeners.add(fn);

export const hasProgress = () => !!load(KEY, null);
export const ballLook = () => (ballStyle(progress.ball) ?? BALL_STYLES[0]).look;
export const owns = (id) => id === DEFAULT_BALL || progress.items.includes(id);

function apply(out) {
  if (out.key) save(KEY, out.key);
  for (const k of ["coins", "earned", "ball", "items"]) if (out[k] !== undefined) progress[k] = out[k];
  save(KNOWN, { coins: progress.coins, earned: progress.earned, ball: progress.ball, items: progress.items });
  for (const fn of listeners) fn(progress);
}

// A call to the progress API with this device's key. Throws an Error with the server's friendly
// message (and `offline` when it can't be reached).
async function call(path, body = {}) {
  let res;
  try {
    res = await fetch(`${API}/progress${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: load(KEY, null), ...body }),
    });
  } catch {
    throw Object.assign(new Error("Can't reach the internet right now. Try again soon."), { offline: true });
  }
  const out = await res.json().catch(() => ({}));
  if (res.status === 404 && path === "") {
    // The server doesn't know this key: start again with nothing.
    save(KEY, null);
    apply(fresh());
  }
  if (!res.ok) throw new Error(out.error || "Something went wrong. Try again soon.");
  return out;
}

/** The latest coins and balls from the server (another device may have changed them). */
export async function refreshProgress() {
  if (!hasProgress()) return;
  try {
    apply(await call(""));
  } catch {
    // Offline: keep what we knew.
  }
}

/** A finished game's coins. `game` is what the leaderboard would get (token, mode, score, shots). */
export async function claimCoins(game) {
  const out = await call("/games", game);
  apply(out);
  return out.got;
}

export const buyBall = async (id) => apply(await call("/buy", { item: id }));
export const useBall = async (id) => apply(await call("/ball", { ball: id }));
/** A code for another device: { code: "ABCD-EFGH", minutes }. */
export const pairCode = () => call("/pair");
export const joinWithCode = async (code) => apply(await call("/join", { code }));
