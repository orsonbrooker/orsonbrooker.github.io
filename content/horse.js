// HORSE: the spots the leader can pick to shoot from, and the letters. [angle from the hoop, metres
// out (or "three" for just behind the 3-point line), name]. modes/horse.js turns them into court
// spots; the turn screen shows them on a little map of the court.
export const HORSE_LAYOUT = [
  [40, 2.9, "the baseline"],
  [66, 3.4, "the elbow"],
  [90, 3.45, "the free throw line"],
  [114, 3.4, "the other elbow"],
  [140, 2.9, "the other baseline"],
  [63, "three", "the wing for three"],
  [90, "three", "the top for three"],
  [118, "three", "the other wing for three"],
];

export const HORSE_WORD = "HORSE";

// The part of the court art the spot map shows, in court pixels (the floor around the hoop).
export const HORSE_MAP = { x: 480, y: 800, size: 980 };
