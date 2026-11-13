// Feature flags in the browser: whether something that's built but not out yet should show (the list
// is shared/flags.js; Luke switches them on the admin page). Loaded once, when the page starts: from
// the server if it answers quickly, else the copy this device kept last time (so it works offline),
// else everything off, so nothing unreleased ever shows by accident.
//
// For testing: ?flags=threepoint,freeplay (or ?flags=all, or ?flags=none) shows exactly those for this
// page, whatever the server has on, and ?debug turns them all on (unless it has a ?flags= of its own). Turned on that way, a flag is only for looking: what it sends (scores, players) is still
// refused by the server until the flag is really on, so the game doesn't try (released()).

import { API } from "./api.js";
import { load, save } from "./engine/storage.js";
import { FLAG_KEYS, parseFlagList } from "./shared/flags.js";

const KEPT = "orson-flags";
const WAIT = 1500; // ms to wait for the server before using the kept copy

const params = new URLSearchParams(location.search);
// An explicit ?flags= wins over ?debug, so ?debug&flags=none plays test mode with everything off.
const forced = params.has("flags") ? parseFlagList(params.get("flags")) : params.has("debug") ? [...FLAG_KEYS] : [];

/** @returns {Promise<Record<string, boolean> | null>} */
async function fetchFlags() {
  try {
    const res = await fetch(`${API}/flags`, { signal: AbortSignal.timeout(WAIT) });
    if (!res.ok) return null;
    const { flags } = await res.json();
    return flags && typeof flags === "object" ? flags : null;
  } catch {
    return null; // offline, slow or no server (a local page without the Worker)
  }
}

const fresh = await fetchFlags();
if (fresh) save(KEPT, fresh);
/** @type {Record<string, boolean>} */
const server = fresh ?? load(KEPT, {}) ?? {};

/** Whether `key` is out for everyone (switched on on the admin page). */
export const released = (key) => server[key] === true;

/** Whether to show what `key` hides: it's out, or turned on for testing with ?debug. A ?flags= list
 * shows exactly those flags, so ?flags=none previews the site with everything off. */
export const flagOn = (key) => (params.has("flags") ? forced.includes(key) : released(key) || forced.includes(key));
