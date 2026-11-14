// Choosing a team (while the `teams` flag is on). No team is ever picked for a kid. The first time a
// device plays as Orson or someone else's approved player, it picks the team its games count for on Top
// teams (players/community.js myTeam); the Team buttons change it. Its own players' teams are picked in
// the builder, the one place to change them: the Team button on Choose a game opens it on that player's
// Team tab, and so does the question before a scored game as a player with no team picked (a new one,
// or one saved in KINGS only because every player used to start there). Also: telling them when a
// community team they were on has gone.

import { IN_APP } from "../api.js";
import { flagOn } from "../flags.js";
import { dressInTeam, reloadMyPlayers } from "../play/players.js";
import { myPlayers, saveMyPlayer, teamPicked } from "../players/recolor.js";
import { kitColours } from "../players/teams.js";
import { goneTeams, keptTeam, keptTeams, myTeam, myTeamKit, setMyTeam } from "../players/community.js";
import { TEAMS } from "../shared/teams.js";
import { confirmDialog } from "../ui/confirm.js";
import { icon } from "../ui/icons.js";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
export const swatch = (kit) => el("span", { className: "team-kit" }, ...["jersey", "shorts", "trim"].map((p) => el("span", { style: `background:${kit[p]}` })));

/**
 * Whether a scored game as this player needs a team picked first: the device's (Orson and approved
 * players; chooseTeam) or, for its own player, theirs (in the builder; askPlayerTeam).
 */
// (The iOS app has no builder, so a player of theirs from saved progress isn't asked there: until a team's
// picked on the website, its games count for none.)
export const needsTeam = (player, gameMode) =>
  flagOn("teams") && !gameMode.passAndPlay && !!gameMode.bestKey && (player?.mine ? !IN_APP && !teamPicked(player) : !myTeam());

/** The builder, on this own player's Team tab; saving there comes back to Choose a game. */
export function editTeam(player) {
  if (IN_APP) return; // no builder in the app (and so no players of its own)
  location.assign(`/players/?edit=${encodeURIComponent(player.id)}&tab=team&back=modes`);
}

/** Before a scored game as their own player with no team picked: off to pick one in the builder. */
export async function askPlayerTeam(player) {
  const go = await confirmDialog(`Pick ${player.name}'s team`, { yes: "Pick a team", yesIcon: "players", no: "Not now", detail: "Every player plays for a team. Their games count for it on Top teams." });
  if (go) editTeam(player);
}

/**
 * The team a player plays for and the kit they wear: { name, kit: { jersey, shorts, trim } }, or null
 * before one's picked. Their own player's is the one saved with them in the builder, in the colours they
 * wear (it may be the away kit); anyone else's is the device's team.
 */
export function teamOf(player) {
  if (!player?.mine) {
    const kit = myTeamKit();
    return kit && { name: kit.name, kit: kit.home };
  }
  if (flagOn("teams") && !teamPicked(player)) return null;
  const c = player.colours ?? {};
  const official = TEAMS.find((t) => t.name === c.teamName);
  const kit = c.jersey && c.shorts && c.team ? { jersey: c.jersey, shorts: c.shorts, trim: c.team } : (official?.home ?? null);
  return { name: c.teamName || official?.name || "", kit };
}

/** Asks which team the device plays for; resolves once they've picked (it can't be skipped the first time). */
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
      await dressInTeam(); // he wears it
      resolve(myTeam());
    });
    document.body.append(dialog);
    dialog.tabIndex = -1;
    dialog.showModal();
    // Their team, or (none chosen yet) no team at all: showModal would ring the first, KINGS, as if picked.
    (dialog.querySelector('[aria-pressed="true"]') ?? dialog).focus();
  });
}

/**
 * Once a visit: if a community team this device was on has gone, its players stop wearing it (no team,
 * so they pick another before their next scored game) and the device chooses again next game. Says so, once. A team that was renamed or given new kits (Luke renames a team whose name isn't
 * friendly) shows its new name and kit on its players here too, not only once the builder opens them.
 */
export async function checkTeams() {
  if (!flagOn("teams")) return;
  const gone = await goneTeams(myPlayers().map((p) => ({ key: p.colours?.teamId, name: p.colours?.teamName })));
  const keys = new Set(gone.map((t) => t.key));
  if (keys.has(myTeam()?.key)) setMyTeam(null);
  await dressInTeam(); // a team chosen on another device, or a renamed one, is known now
  let changed = false;
  for (const p of myPlayers()) {
    const id = p.colours?.teamId;
    if (!id) continue;
    if (keys.has(id)) {
      const { teamId: _, ...colours } = p.colours;
      const { teamPicked: __, ...player } = p;
      saveMyPlayer({ ...player, colours: { ...colours, teamName: "" } });
      changed = true;
      continue;
    }
    const t = keptTeam(id);
    if (!t || t.member === false) continue;
    const c = p.colours;
    const wearing = [t.home, t.away].some((k) => k.jersey === c.jersey && k.shorts === c.shorts && k.trim === c.team);
    if (wearing && c.teamName === t.name) continue;
    saveMyPlayer({ ...p, colours: { ...c, ...(wearing ? {} : kitColours(t.home)), teamName: t.name } });
    changed = true;
  }
  if (changed) await reloadMyPlayers();
  if (gone.length) await confirmDialog(`${gone[0].name} isn't around any more.`, { yes: "Okay", no: null, yesIcon: "", detail: "Pick another team." });
}
