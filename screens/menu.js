// The menu: everything in one place. The game first (play, the leaderboard, the shop, how to play, sound),
// then the rest of the website, which the iOS app leaves out (it's just the game).
// Opens over whichever screen is showing and goes back to it, like help.

import { IN_APP } from "../api.js";
import { $, openScreen, screens, showScreen, stage } from "../screens/base.js";
import { openModes, showTitle } from "../screens/menus.js";
import { openBoard, toggleHelp } from "../screens/panels.js";
import { openShop } from "../screens/shop.js";

if (IN_APP) for (const el of screens.menu.querySelectorAll("[data-site-links]")) el.remove();

let menuReturn = null;
export function openMenu() {
  menuReturn = openScreen();
  showScreen("menu");
  screens.menu.querySelector('[data-menu="play"]').focus({ preventScroll: true });
}
export function closeMenu() {
  showScreen(menuReturn === "menu" ? "title" : menuReturn);
  stage.focus({ preventScroll: true });
}

// Each item closes the menu first, so the screen it opens goes back to where they were.
const ITEMS = {
  play: () => openModes(),
  board: () => openBoard(),
  shop: () => openShop(),
  help: () => toggleHelp(),
};

export function wireMenu() {
  $("menu-button").addEventListener("click", openMenu);
  $("menu-close").addEventListener("click", closeMenu);
  for (const item of screens.menu.querySelectorAll("button[data-menu]")) {
    const go = ITEMS[item.dataset.menu];
    if (!go) continue; // music and sound switch in place (screens/base.js)
    item.addEventListener("click", () => {
      closeMenu();
      // Play starts from the title: if they were somewhere else (a game just over), go there first.
      if (item.dataset.menu === "play" && openScreen() !== "title") showTitle();
      go();
    });
  }
}
