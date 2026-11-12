// Saved progress, the game's side: coins earned by playing and the ball styles they buy, kept on the
// server (worker/src/progress.ts) so they can come along to another device with a pairing code.
//
// This device holds a random key, given by the server with its first coins. The last known coins and
// ball are kept here too, so the shop and the ball look right straight away (and offline).
//
// The rest of what's kept on this device travels too (shared/save.js): personal bests, the daily
// challenge streak, players made in the builder and the nickname. Each call sends this device's, and
// the server's merged copy comes back and is merged in here (so nothing set meanwhile is lost).

import { API } from "./api.js";
import { DAILY_KEYS } from "./daily.js";
import { load, save } from "./engine/storage.js";
import { NICKNAME_KEYS, deviceId } from "./leaderboard.js";
import { modes, state } from "./play/state.js";
import { gonePlayers, myPlayers, setGonePlayers, setMyPlayers } from "./players/recolor.js";
import { MODES } from "./shared/rules.js";
import { mergeSaves, sameSave, tidySave } from "./shared/save.js";
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

// ---------- The rest of the save ----------

const bestKey = (m) => modes[m]?.bestKey;

/** This device's save, from where each part is kept. */
function localSave() {
  const streak = load(DAILY_KEYS.streak, null);
  return tidySave({
    bests: Object.fromEntries(MODES.map((m) => [m, bestKey(m) ? load(bestKey(m), 0) : 0])),
    daily: { done: load(DAILY_KEYS.done, ""), last: streak?.last, days: streak?.days },
    players: myPlayers(),
    gone: gonePlayers(),
    nickname: { name: load(NICKNAME_KEYS.name, ""), at: load(NICKNAME_KEYS.at, 0) },
  });
}

/** Called with the merged save when anything in it changed here (new players, a better best...). */
const saveListeners = new Set();
export const onSave = (fn) => saveListeners.add(fn);

function applySave(fromServer) {
  if (!fromServer) return;
  const mine = localSave();
  const merged = mergeSaves(mine, tidySave(fromServer));
  if (sameSave(merged, mine)) return;
  for (const m of MODES) if (bestKey(m) && merged.bests[m]) save(bestKey(m), merged.bests[m]);
  if (merged.daily.done) save(DAILY_KEYS.done, merged.daily.done);
  if (merged.daily.last) save(DAILY_KEYS.streak, { last: merged.daily.last, days: merged.daily.days });
  // Players keep anything this device knows that the save doesn't, and any of this device's players
  // the save couldn't take (an odd old one) stay here.
  const known = new Map(myPlayers().map((p) => [p.id, p]));
  const inSave = new Set([...mine.players, ...merged.players].map((p) => p.id));
  const odd = myPlayers().filter((p) => !inSave.has(p.id) && !merged.gone.includes(p.id));
  setMyPlayers([...merged.players.map((p) => ({ ...known.get(p.id), ...p, colours: { ...known.get(p.id)?.colours, ...p.colours } })), ...odd]);
  setGonePlayers(merged.gone);
  if (merged.nickname.name) {
    save(NICKNAME_KEYS.name, merged.nickname.name);
    save(NICKNAME_KEYS.at, merged.nickname.at);
  }
  if (bestKey(state.mode)) state.best = load(bestKey(state.mode), 0);
  for (const fn of saveListeners) fn(merged);
}

function apply(out) {
  if (out.key) save(KEY, out.key);
  applySave(out.save);
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
      body: JSON.stringify({ key: load(KEY, null), device: deviceId(), save: localSave(), ...body }), // device: so their leaderboard rows come along too
    });
  } catch {
    throw Object.assign(new Error("Can't reach the internet right now. Try again soon."), { offline: true });
  }
  const out = await res.json().catch(() => ({}));
  // The key is never thrown away here, whatever comes back: it's the only way back to their coins and
  // balls, and a 404 can come from a wrong route or a page in the way as easily as from the server. If
  // the server really doesn't know it, their next game's coins start a new progress and a new key.
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
