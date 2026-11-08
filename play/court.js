// Which court is being played: switches the court's measurements (engine/court.js), its physics
// (engine/physics.js) and its art (the court image under the canvas, the hoop front drawn over the
// ball). The courts themselves are in content/courts.js. Players only ever get the default court
// for now; ?debug can switch with window.game.setCourt(id).

import { COURTS, DEFAULT_COURT } from "../content/courts.js";
import { court, setCourt } from "../engine/court.js";
import { setPhysics } from "../engine/physics.js";
import { loadImage } from "../play/players.js";
import { art } from "../play/scene.js";

export { COURTS, court };

let hoopFrontSrc = null; // which hoop front art.hoopFront is

// Plays on this court from now on, once its art has loaded.
export async function useCourt(id = DEFAULT_COURT) {
  const def = COURTS[id];
  if (!def) throw new Error(`No court called "${id}"`);
  const hoopFront = hoopFrontSrc === def.hoopFront ? art.hoopFront : await loadImage(def.hoopFront);
  setCourt(def);
  setPhysics(def.physics);
  art.hoopFront = hoopFront;
  hoopFrontSrc = def.hoopFront;
  const img = document.querySelector("img.court");
  if (img && img.getAttribute("src") !== def.image) img.src = def.image;
  return def;
}
