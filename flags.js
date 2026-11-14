// Feature flags in the browser: whether something that's built but not out yet should show (the list
// is shared/flags.js; Luke switches them on the admin page). The copy this device kept last time is
// used straight away, so a page never waits for the server; if it's more than a few minutes old a new
// one is fetched in the background, for the next page. Only a device with no copy yet (a first visit)
// waits for the server, briefly; if it doesn't answer, everything is off, so nothing unreleased ever
// shows by accident. So a flag switched on shows on a device's next page after its copy is refreshed,
// and every device asks the server at most once every few minutes (each ask is a Worker request,
// which the free tier counts; the answer itself comes from the edge cache, not the database).
//
// For testing: ?flags=threepoint,freeplay (or ?flags=all, or ?flags=none) shows exactly those in this
// tab, whatever the server has on (?flags=server ends it), and ?debug turns them all on (unless it has a ?flags= of its own). Turned on that way, a flag is only for looking: what it sends (scores, players) is still
// refused by the server until the flag is really on, so the game doesn't try (released()).

import { API } from "./api.js";
import { load, save } from "./engine/storage.js";
import { FLAG_KEYS, parseFlagList } from "./shared/flags.js";
import { flagPreview } from "./ui/flag-preview.js";

const KEPT = "orson-flags"; // { flags, at }: the server's answer and when it came
const WAIT = 1500; // ms a first visit waits for the server
const FRESH_FOR = 10 * 60_000; // ms a kept copy is used without asking again

const params = new URLSearchParams(location.search);
// A ?flags= list stays for the rest of this tab (ui/flag-preview.js).
const preview = flagPreview();
// An explicit ?flags= wins over ?debug, so ?debug&flags=none plays test mode with everything off.
const forced = preview !== null ? parseFlagList(preview) : params.has("debug") ? [...FLAG_KEYS] : [];

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

/** Asks the server and keeps its answer; returns it (null if it didn't answer). */
async function refresh() {
  const flags = await fetchFlags();
  if (flags) save(KEPT, { flags, at: Date.now() });
  return flags;
}

const kept = load(KEPT, null);
// (a copy kept before the time was saved with it is just the flags: used, and refreshed)
const keptFlags = kept && typeof kept === "object" ? (kept.flags && typeof kept.at === "number" ? kept.flags : kept) : null;
const keptAt = typeof kept?.at === "number" ? kept.at : 0;
if (keptFlags && !(Date.now() - keptAt >= 0 && Date.now() - keptAt < FRESH_FOR)) refresh();
/** @type {Record<string, boolean>} */
const server = keptFlags ?? (await refresh()) ?? {};

/** Whether `key` is out for everyone (switched on on the admin page). */
export const released = (key) => server[key] === true;

/** Whether to show what `key` hides: it's out, or turned on for testing with ?debug. A ?flags= list
 * shows exactly those flags, so ?flags=none previews the site with everything off. */
export const flagOn = (key) => (preview !== null ? forced.includes(key) : released(key) || forced.includes(key));
