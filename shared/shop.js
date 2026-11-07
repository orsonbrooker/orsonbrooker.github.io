// What coins buy: ball styles, drawn in code by engine/draw.js so they need no art. Shared with the
// Worker, which checks the price when something's bought. Gear with its own art joins later.
// A style's colours: main, shade (lower right), shine, seam, edge. `panels` paints the ball in stripes
// of those colours instead of main and shade. Keep clear of gold (the money ball) and rainbow, so bonus
// balls still stand out.

/** @typedef {{ id: string, name: string, price: number, look: Record<string, unknown> }} BallStyle */

/** @type {BallStyle[]} */
export const BALL_STYLES = [
  { id: "classic", name: "Classic", price: 0, look: { main: "#de6d2b", shade: "#b5501d", shine: "#f39a55", seam: "#5b2a12", edge: "#3a1a10" } },
  { id: "midnight", name: "Midnight", price: 100, look: { main: "#2c3350", shade: "#1d2238", shine: "#5a6890", seam: "#7fb2ff", edge: "#0e1120" } },
  { id: "lava", name: "Lava", price: 150, look: { main: "#c8322f", shade: "#93201f", shine: "#ff7a5c", seam: "#2b0c0c", edge: "#200808" } },
  { id: "ice", name: "Ice", price: 200, look: { main: "#bfe6ff", shade: "#86c3ea", shine: "#ffffff", seam: "#3b6f9a", edge: "#22445f" } },
  { id: "slime", name: "Slime", price: 250, look: { main: "#5fd35a", shade: "#3a9e3c", shine: "#b6ff9c", seam: "#174a1a", edge: "#0e2e10" } },
  { id: "grape", name: "Grape", price: 300, look: { main: "#8a4fd0", shade: "#6233a0", shine: "#c39cff", seam: "#2a1248", edge: "#1a0a30" } },
  { id: "bubblegum", name: "Bubblegum", price: 400, look: { main: "#ff86c2", shade: "#e05a9e", shine: "#ffd0e8", seam: "#7a2050", edge: "#4a1030" } },
  { id: "retro", name: "Retro", price: 600, look: { panels: ["#d9343a", "#f4f1ea", "#2f5fc4"], shine: "#ffffff", seam: "#1e1e2a", edge: "#14141c" } },
];

export const DEFAULT_BALL = "classic";

/** @param {unknown} id */
export const ballStyle = (id) => BALL_STYLES.find((s) => s.id === id) ?? null;
