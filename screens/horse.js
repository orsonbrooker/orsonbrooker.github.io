// The turn screen in a pass and play game (HORSE, modes/horse.js), shown between shots so the device can
// be passed on: who's up ("Pass to Jethro!"), what just happened, everyone's letters, and the spot on a
// little map of the court. The leader picks the spot there; anyone matching sees the leader's spot.

import { HORSE_WORD } from "../content/horse.js";
import { court, project } from "../engine/court.js";
import { setFace } from "../play/players.js";
import { $, showScreen } from "../screens/base.js";

const map = $("spot-map");
const pct = (n) => `${(n * 100).toFixed(2)}%`;
// The map shows the court's horseMap square of its art (content/courts.js).
function showCourt() {
  const { image, size, horseMap: m } = court;
  map.style.backgroundImage = `url(${image})`;
  map.style.backgroundSize = pct(size / m.size);
  map.style.backgroundPosition = `${pct(m.x / (size - m.size))} ${pct(m.y / (size - m.size))}`;
}

const spotText = (spots, i) => `Spot ${i + 1}: ${spots[i].name}${spots[i].three ? " (3 points)" : ""}`;

let onGo = null;
let chosen = 0;

// view: { title, news, note, face, spots, spot, canPick, standings: [{ name, face, letters, out, up }], go(spot) }
export function showTurn(view) {
  onGo = view.go;
  chosen = view.spot;
  $("turn-title").textContent = view.title;
  $("turn-news").textContent = view.news;
  $("turn-news").hidden = !view.news;
  $("turn-note").textContent = view.note;
  if (view.face) setFace($("turn-face"), view.face);
  renderMap(view.spots, view.canPick);
  renderLetters(view.standings);
  showScreen("turn");
}

function renderMap(spots, canPick) {
  showCourt();
  const m = court.horseMap;
  map.classList.toggle("picking", canPick);
  const label = $("turn-spot");
  map.replaceChildren(
    ...spots.map((spot, i) => {
      const p = project(spot.u, spot.v);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card spot" + (spot.three ? " three" : ""); // .card: the arrow keys move between them
      button.textContent = String(i + 1);
      button.style.left = pct((p.x - m.x) / m.size);
      button.style.top = pct((p.y - m.y) / m.size);
      button.setAttribute("aria-label", spotText(spots, i));
      button.setAttribute("aria-pressed", String(i === chosen));
      button.disabled = !canPick && i !== chosen;
      button.addEventListener("click", () => {
        if (!canPick) return;
        chosen = i;
        for (const b of map.children) b.setAttribute("aria-pressed", String(b === button));
        label.textContent = spotText(spots, i);
      });
      return button;
    }),
  );
  label.textContent = spotText(spots, chosen);
}

function renderLetters(standings) {
  $("turn-letters").replaceChildren(
    ...standings.map((s) => {
      const li = document.createElement("li");
      if (s.out) li.className = "out";
      if (s.up) li.classList.add("up");
      const img = document.createElement("img");
      img.alt = "";
      if (s.face) setFace(img, s.face);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = s.name;
      const letters = document.createElement("span");
      letters.className = "letters";
      letters.setAttribute("aria-label", s.out ? "Out" : s.letters ? `Letters: ${s.letters.split("").join(" ")}` : "No letters");
      for (let k = 0; k < HORSE_WORD.length; k++) {
        const tile = document.createElement("b");
        tile.textContent = HORSE_WORD[k];
        if (k < s.letters.length) tile.className = "lit";
        letters.append(tile);
      }
      li.append(img, name, letters);
      return li;
    }),
  );
}

$("turn-go").addEventListener("click", () => onGo?.(chosen));
