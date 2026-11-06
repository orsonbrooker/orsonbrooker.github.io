// How things look: fire levels, the balls, bonus ball badges, the wall scoreboard, confetti.
// Plain tables; the rules behind them (streaks, bonuses, which ball comes when) are in shared/rules.js.

import { FIRE_RULES, MONEY, NORMAL, RAINBOW } from "../shared/rules.js";

// Like NBA Jam: two makes in a row heats him up, three puts him on fire until he misses,
// keeping it going turns the flames purple, and ten in a row goes blue-white supernova.
// How many makes each level needs, and its bonus points, are in FIRE_RULES (shared/rules.js,
// which the server uses to check scores too). Here is how each level looks and plays:
//   window: timing window is this much wider
const FIRE_LOOKS = [
  { window: 1.4, phrase: "onFire", stillPhrase: "stillOnFire", color: "#ff9f43", fx: { palette: "fire", radius: 5 } },
  { window: 1.6, phrase: "purpleFire", stillPhrase: "stillPurpleFire", color: "#c77dff", fx: { palette: "purpleFire", radius: 6 } },
  { window: 1.7, phrase: "supernova", stillPhrase: "stillSupernova", color: "#8fd8ff", fx: { palette: "supernova", radius: 7 } },
];
//   streak: makes in a row to reach it
//   bonus:  extra points per basket
export const FIRE_LEVELS = FIRE_RULES.map((rule, i) => ({ ...rule, ...FIRE_LOOKS[i] }));

// The ball's colours. A rainbow ball's colour runs around it in bands.
export const BALL_LOOKS = {
  [NORMAL]: { main: "#de6d2b", shade: "#b5501d", shine: "#f39a55", seam: "#5b2a12", edge: "#3a1a10" },
  [MONEY]: { main: "#f0b424", shade: "#c48412", shine: "#fff3a6", seam: "#7a4a08", edge: "#4a2c08" },
  [RAINBOW]: { rainbow: true, shine: "#ffffff", seam: "#3a2a5a", edge: "#2a1a3a" },
};

// Shown over the player (and called out) while the ball in his hands is a bonus ball.
export const BALL_BADGES = { [MONEY]: { text: "MONEY BALL x2", color: "#ffd700", call: "moneyBall" }, [RAINBOW]: { text: "RAINBOW BALL +5", color: "#ff86e6", call: "rainbowBall" } };

// The wall scoreboard, in its own skewed coordinates (x runs along the wall, y straight down).
export const BOARD_ART = {
  origin: { x: 753.3, y: 446.7 },
  slope: -0.53,
  area: { x: 745, y: 315, w: 260, h: 275 }, // court pixels the scoreboard can touch
  face: "#2d3238",
  window: "#281a2e",
  lit: "#ff4d4d",
  unlit: "rgba(255, 77, 77, 0.12)",
  label: "#e8eef0",
  left: { label: "SCORE", labelAt: [57, 46], cover: [12, 26, 88, 34], window: [18, 71, 78, 64] },
  right: { label: "TIME", labelAt: [190, 46], cover: [142, 26, 96, 34], window: [149, 69, 83, 69] },
};

export const CONFETTI_COLORS = ["#ffd700", "#ff6b6b", "#7cf0ff", "#ffffff", "#c77dff", "#3ddc84"];
