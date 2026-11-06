// When the announcer makes the bigger calls. The lines themselves are in phrases.js.

// Sudden death: a bigger call the longer the run goes.
//   streak: makes in a row   call: phrase list (phrases.js)   level: 1 a shout, 2 adds confetti, 3 adds fireworks
// Past the last one, every 10 more gets a "runLegend" call at the top level.
const RUN_CALLS = [
  { streak: 10, call: "run10", level: 1 },
  { streak: 15, call: "run15", level: 1 },
  { streak: 20, call: "run20", level: 2 },
  { streak: 25, call: "run25", level: 2 },
  { streak: 30, call: "run30", level: 3 },
  { streak: 40, call: "run40", level: 3 },
  { streak: 50, call: "run50", level: 3 },
];

// The call for reaching this many makes in a row, or null.
export function runCall(streak) {
  const top = RUN_CALLS.at(-1);
  return RUN_CALLS.find((r) => r.streak === streak) ?? (streak > top.streak && streak % 10 === 0 ? { streak, call: "runLegend", level: 3 } : null);
}

// The call at the end of a game that scores points: the first whose score it reached
// (a new best gets "newBest" instead).
const OVER_CALLS = [
  { score: 50, call: "overGoat" },
  { score: 30, call: "overHigh" },
  { score: 10, call: "overMid" },
];
export const overCall = (score) => OVER_CALLS.find((c) => score >= c.score)?.call ?? "overLow";
