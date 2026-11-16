// Teams kept only on this device ("drafts": made before community teams) count for nothing on Top teams,
// since the server doesn't know them. The builder (players/builder.js) and the game (screens/team.js) make
// each one a private community team by itself once a robot check passes, and the players saved here
// wearing it move onto it. A draft named like one of the game's teams (SHARKS in other colours) already
// counts for that team, so it stays as it is.

import { isOfficialTeam } from "../shared/teams.js";
import { makeTeam } from "./community.js";
import { myPlayers, saveMyPlayer } from "./recolor.js";
import { myTeams, saveMyTeams } from "./teams.js";

const HEX = /^#[0-9a-f]{6}$/;

/** Whether a team name is a draft's: any name but one of the game's teams. */
export const draftName = (name) => !!name && !isOfficialTeam(name);

/** Whether this saved player wears a draft (a team name the server doesn't know). */
export const wearsDraft = (p) => !p?.colours?.teamId && draftName(p?.colours?.teamName);

/**
 * The drafts waiting to be made into teams, the ones a saved player wears first. A player can wear one
 * that isn't kept (it came from a link): its kit is then the player's colours, as the builder makes it.
 */
export function waitingDrafts() {
  const kept = myTeams().filter((t) => draftName(t.name));
  const worn = new Set();
  const extra = [];
  for (const p of myPlayers()) {
    if (!wearsDraft(p)) continue;
    const c = p.colours;
    worn.add(c.teamName);
    if (kept.some((t) => t.name === c.teamName) || extra.some((t) => t.name === c.teamName)) continue;
    if (![c.jersey, c.shorts, c.team].every((h) => HEX.test(h ?? ""))) continue;
    extra.push({ id: `mine-${p.id}`, name: c.teamName, home: { jersey: c.jersey, shorts: c.shorts, trim: c.team }, away: { jersey: "#f2f2ef", shorts: c.team, trim: c.team } });
  }
  return [...extra, ...kept.filter((t) => worn.has(t.name)), ...kept.filter((t) => !worn.has(t.name))];
}

/**
 * Makes a draft a private community team with this robot check token (and, from the builder's editor,
 * maybe a new name). It's no longer kept as a draft, and every player saved here wearing it (by its name:
 * drafts have no id) wears the new team, so their games count for it.
 */
export async function makeDraft(draft, token, name = draft.name) {
  const made = await makeTeam({ name, home: draft.home, away: draft.away, turnstileToken: token });
  saveMyTeams(myTeams().filter((t) => t.id !== draft.id));
  for (const p of myPlayers()) {
    if (p.colours?.teamId || p.colours?.teamName !== draft.name) continue;
    saveMyPlayer({ ...p, teamPicked: true, colours: { ...p.colours, teamName: made.name, teamId: made.key } });
  }
  return made;
}
