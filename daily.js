// Shootaround's daily challenge: one goal a day, the same for everyone on the same date. Whether
// it's done (and how many days in a row) is kept on this device.
//
// Each challenge counts something from one game (the stats in game.js, newStats) and is done when
// that reaches `goal`. `mode` limits it to one way of playing. Add your own!

export const CHALLENGES = [
  { text: "Make 7 threes in one game", goal: 7, count: (s) => s.threes },
  { text: "Make 4 threes in a row", goal: 4, count: (s) => s.bestThreeRun },
  { text: "Make 4 swishes in a row", goal: 4, count: (s) => s.bestSwishRun },
  { text: "Hit 3 bank shots in one game", goal: 3, count: (s) => s.banks },
  { text: "Catch fire 3 times in one game", goal: 3, count: (s) => s.fires },
  { text: "Make 8 in a row", goal: 8, count: (s) => s.bestStreak },
  { text: "Make 16 shots in one game", goal: 16, count: (s) => s.makes },
  { text: "Score 50 points in Time attack", goal: 50, mode: "timed", count: (s) => s.score },
  { text: "Score 75 points in Time attack", goal: 75, mode: "timed", count: (s) => s.score },
  { text: "Make 10 in a row in Sudden death", goal: 10, mode: "survival", count: (s) => s.bestStreak },
  { text: "Make 15 in a row in Sudden death", goal: 15, mode: "survival", count: (s) => s.bestStreak },
  { text: "Make 2 money balls in one game", goal: 2, count: (s) => s.money + s.rainbow },
  // A perfect trip around the world takes about 22 seconds.
  { text: "Go around the world in under 40 seconds", goal: 1, mode: "around", count: (s) => (s.aroundTime && s.aroundTime < 40 ? 1 : 0) },
  { text: "Go around the world in under 30 seconds", goal: 1, mode: "around", count: (s) => (s.aroundTime && s.aroundTime < 30 ? 1 : 0) },
  { text: "Hit a buzzer beater", goal: 1, mode: "timed", count: (s) => (s.buzzerBeater ? 1 : 0) },
];

const DONE = "orson-hoops-daily";
const STREAK = "orson-hoops-daily-streak";
/** Where they're kept: saved progress (progress.js) carries them to their other devices. */
export const DAILY_KEYS = { done: DONE, streak: STREAK };

const load = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing: it just isn't remembered.
  }
};

// Today's date where they are, like "2026-11-06".
function dateKey(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The same challenge for everyone on a date, mixed up so the days don't follow the list in order.
export function todaysChallenge() {
  let h = 0x811c9dc5;
  for (const c of dateKey()) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  return CHALLENGES[h % CHALLENGES.length];
}

export const doneToday = () => load(DONE, null) === dateKey();

// Days in a row with the challenge done (today's counts once it's done).
export function streakDays() {
  const s = load(STREAK, null);
  return s && (s.last === dateKey() || s.last === dateKey(-1)) ? s.days : 0;
}

// Marks today's challenge done. Returns the days-in-a-row count.
export function markDone() {
  const s = load(STREAK, null);
  const days = s?.last === dateKey() ? s.days : s?.last === dateKey(-1) ? s.days + 1 : 1;
  save(DONE, dateKey());
  save(STREAK, { last: dateKey(), days });
  return days;
}

// Whether a game in this mode counts toward the challenge, and how far it got.
export const countsIn = (challenge, mode) => !challenge.mode || challenge.mode === mode;
export const progress = (challenge, stats) => Math.min(challenge.goal, challenge.count(stats));
