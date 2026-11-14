// Choosing a team (while the `teams` flag is on). The first time a device plays as Orson or someone
// else's approved player, it picks the team its games count for on Top teams (players/community.js
// myTeam); the Team button on Choose your player changes it. Its own players wear the team picked for
// them in the builder. Also: telling them when a community team they were on has gone.

import { IN_APP } from "../api.js";
import { flagOn } from "../flags.js";
import { dressOrson, reloadMyPlayers } from "../play/players.js";
import { myPlayers, saveMyPlayer } from "../players/recolor.js";
import { goneTeams, keptTeams, myTeam, setMyTeam } from "../players/community.js";
import { TEAMS } from "../shared/teams.js";
import { confirmDialog } from "../ui/confirm.js";
import { icon } from "../ui/icons.js";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const swatch = (kit) => el("span", { className: "team-kit" }, ...["jersey", "shorts", "trim"].map((p) => el("span", { style: `background:${kit[p]}` })));

/** Whether a game as this player needs the device to choose a team first. */
export const needsTeam = (player, gameMode) => flagOn("teams") && !player?.mine && !gameMode.passAndPlay && !!gameMode.bestKey && !myTeam();

/** Asks which team the device plays for; resolves once they've picked (it can't be skipped). */
export function chooseTeam(note = "") {
  return new Promise((resolve) => {
    const now = myTeam();
    const dialog = el("dialog", { className: "confirm-dialog team-dialog" });
    const pick = (t) => {
      setMyTeam(t);
      dialog.close();
    };
    const row = (t, community) => {
      const on = now && (community ? now.key === t.key : !now.key && now.name === t.name);
      const b = el("button", { type: "button", className: "team-choice" }, swatch(t.home), el("span", { className: "team-choice-name", textContent: t.name })); // a kid may have typed it: text only
      b.setAttribute("aria-pressed", String(!!on));
      if (community) {
        const badge = el("span", { className: "lb-badge", title: "Made by players" });
        badge.innerHTML = icon("players");
        badge.append(el("span", { textContent: "Made by players" }));
        b.append(badge);
      }
      b.addEventListener("click", () => pick(community ? { name: t.name, key: t.key } : { name: t.name }));
      return b;
    };
    const joined = keptTeams().filter((t) => t.member !== false);
    dialog.append(
      el("p", { className: "confirm-question", textContent: "Choose your team" }),
      ...(note ? [el("p", { className: "confirm-detail team-gone", textContent: note })] : []),
      el("p", { className: "team-why", textContent: "Your games count for your team on Top teams." }),
      el("div", { className: "team-choices" }, ...joined.map((t) => row(t, true)), ...TEAMS.map((t) => row(t, false))),
      ...(IN_APP ? [] : [el("a", { className: "team-make", href: "/players/", textContent: "Make a team, or join a friend's with a code, in Make your player." })]),
    );
    dialog.addEventListener("cancel", (e) => {
      if (!myTeam()) e.preventDefault(); // a team has to be chosen; changing it can be left
    });
    dialog.addEventListener("close", async () => {
      dialog.remove();
      await dressOrson(); // he wears it
      resolve(myTeam());
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('[aria-pressed="true"]')?.focus();
  });
}

/**
 * Once a visit: if a community team this device was on has gone, its players stop wearing it and the
 * device chooses again next game. Says so, once.
 */
export async function checkTeams() {
  if (!flagOn("teams")) return;
  const gone = await goneTeams();
  await dressOrson(); // a team chosen on another device is known now
  if (!gone.length) return;
  const keys = new Set(gone.map((t) => t.key));
  if (keys.has(myTeam()?.key)) {
    setMyTeam(null);
    await dressOrson();
  }
  for (const p of myPlayers()) {
    if (!keys.has(p.colours?.teamId)) continue;
    const { teamId: _, ...colours } = p.colours;
    saveMyPlayer({ ...p, colours });
  }
  await reloadMyPlayers();
  await confirmDialog(`${gone[0].name} isn't around any more.`, { yes: "Okay", no: null, yesIcon: "", detail: "Pick another team." });
}
