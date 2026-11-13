// Top teams: a leaderboard of teams, per game mode, this week and all time, next to the players' boards.
// Hidden behind the `teams` flag (shared/flags.js): off, the board isn't there.
//
// Which team a game is for is saved with it when it's sent (teamForScore, called from postScore), so
// the board only ever adds up saved scores: KINGS for Orson, an approved builder player's team name,
// or the team a kid's own player (made on their device) wears, checked like any typed name.
//
// A team's score is its TEAM_COUNTS (3) best players added up. Each player counts once, at their best
// game in that mode (whichever device played as them), so a team can't win just by having lots of
// players, and playing as Orson helps KINGS by one player at most. Around the World is a time: the 3
// best times add up, and teams with fewer than 3 times come after the ones with 3.
//
// A team only shows when an official one (shared/teams.js) or one an approved player has (so Luke
// has seen its name in the admin inbox), and only from shown games. Only games from FEATURE_FROM.teams
// count.

import { lowWins, modeOf } from "../../shared/rules.js";
import type { Mode } from "../../shared/rules.js";
import { DEFAULT_TEAM, TEAMS, TEAM_COUNTS, teamNameOf } from "../../shared/teams.js";
import { requireFlag } from "./flags.ts";
import { featureFrom } from "./scores.ts";
import { isUnfriendly, json } from "./util.ts";
import type { Env } from "./util.ts";

const OFFICIAL = new Map(TEAMS.map((t) => [t.name, t]));
const SHOWN_TEAMS = 10;

/**
 * The team a game counts for, saved with it. `player` is who they played as: a built-in player
 * (Orson) is KINGS; an approved builder player ("p12") wears their saved team name; a kid's own player
 * ("me…", made on their device and maybe still waiting for approval) sends the team it wears, which
 * is tidied and checked like a typed name. Null when there's no team that could show.
 */
export async function teamForScore(env: Env, player: string, sent: unknown): Promise<string | null> {
	const approved = player.match(/^p(\d{1,10})$/);
	if (approved) {
		const row = await env.DB.prepare("SELECT team_name FROM players WHERE id = ? AND status = 'approved'")
			.bind(Number(approved[1]))
			.first<{ team_name: string }>();
		return row ? teamNameOf(row.team_name) || DEFAULT_TEAM : null;
	}
	if (/^me\d{1,15}$/.test(player)) {
		const name = teamNameOf(sent) || DEFAULT_TEAM;
		return (await isUnfriendly(env, name)) ? null : name;
	}
	return DEFAULT_TEAM; // Orson, and any other built-in player
}

type TeamPlayer = { id: number; score: number; player: string; base: string | null; colours: unknown };
export type TeamRow = { rank: number; name: string; score: number; players: TeamPlayer[]; kit: { jersey: string; trim: string } | null };

/** Custom team names an approved player has, with the kit colours of the newest one. */
async function approvedTeams(env: Env): Promise<Map<string, { jersey: string; trim: string }>> {
	const rows = await env.DB.prepare("SELECT team_name, jersey, team FROM players WHERE status = 'approved' ORDER BY id")
		.all<{ team_name: string; jersey: string; team: string }>();
	return new Map(rows.results.map((r) => [teamNameOf(r.team_name), { jersey: r.jersey, trim: r.team }]));
}

/** One mode's Top teams, best first (at most 10). */
export async function teamRows(env: Env, mode: Mode, week: boolean): Promise<TeamRow[]> {
	const low = lowWins(mode);
	const order = low ? "ASC" : "DESC";
	// A kid's own player ("me…") is only on their device(s); everyone else is the same player wherever
	// they're played, so each counts once, at their best.
	const rows = await env.DB.prepare(
		`WITH g AS (
		   SELECT id, team, score, player, base, colours,
		     CASE WHEN player GLOB 'me[0-9]*' THEN device || ':' || player ELSE player END AS who
		   FROM scores
		   WHERE status = 'shown' AND mode = ?1 AND team IS NOT NULL AND created_at >= ?2
		     ${week ? "AND created_at > datetime('now', '-7 days')" : ""}
		 ), b AS (
		   SELECT *, ROW_NUMBER() OVER (PARTITION BY team, who ORDER BY score ${order}, id) AS k FROM g
		 ), r AS (
		   SELECT *, ROW_NUMBER() OVER (PARTITION BY team ORDER BY score ${order}, id) AS n FROM b WHERE k = 1
		 )
		 SELECT team, id, score, player, base, colours FROM r WHERE n <= ?3 ORDER BY team, n`,
	)
		.bind(mode, featureFrom("teams"), TEAM_COUNTS)
		.all<TeamPlayer & { team: string; colours: string | null }>();

	const custom = await approvedTeams(env);
	const teams = new Map<string, TeamPlayer[]>();
	for (const { team, colours, ...p } of rows.results) {
		if (!OFFICIAL.has(team) && !custom.has(team)) continue; // nobody's approved a player on that team
		const list = teams.get(team) ?? [];
		list.push({ ...p, colours: colours ? JSON.parse(colours) : null });
		teams.set(team, list);
	}
	// Names Luke has since blocked (or the word list catches) never show.
	const names = [];
	for (const name of teams.keys()) if (OFFICIAL.has(name) || !(await isUnfriendly(env, name))) names.push(name);

	const total = (name: string) => teams.get(name)!.reduce((sum, p) => sum + p.score, 0);
	const ranked = names
		.map((name) => ({ name, score: total(name), count: teams.get(name)!.length }))
		.sort((a, b) => (low ? b.count - a.count || a.score - b.score : b.score - a.score) || a.name.localeCompare(b.name));
	return ranked.slice(0, SHOWN_TEAMS).map((t, i) => {
		const official = OFFICIAL.get(t.name);
		return {
			rank: i + 1,
			name: t.name,
			score: t.score,
			players: teams.get(t.name)!,
			kit: official ? { jersey: official.home.jersey, trim: official.home.trim } : (custom.get(t.name) ?? null),
		};
	});
}

/** GET /api/teams?mode=&range=week|all: { teams }, or refused while the `teams` flag is off. */
export async function teamBoard(env: Env, url: URL): Promise<Response> {
	await requireFlag(env, "teams");
	const teams = await teamRows(env, modeOf(url.searchParams.get("mode")), url.searchParams.get("range") !== "all");
	return json({ teams }, 200, 30);
}
