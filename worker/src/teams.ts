// Teams: the six official teams (shared/teams.js) and community teams kids make in the player builder,
// and Top teams, a leaderboard of teams per game mode, this week and all time. (It was behind a `teams`
// flag until it was out for everyone.)
//
// Community teams (community_teams, migration 0024) start as code-to-join: friends join with an
// 8-character code, shared in person (there's no way to send one in the game). Only a keyed hash of the
// code is stored, so the maker's device keeps the code to show it again; a new code stops the old one.
// The maker can ask for anyone to be able to join it without a code ("listing": 'asked', then 'listed'
// once Luke OKs it in the admin inbox, since it's who can walk in); listed teams are in the builder's
// list of teams to join. A device (its leaderboard id, boardOf in scores.ts, so paired devices count as
// one) makes at most 3 teams.
//
// Every community team that isn't hidden is on Top teams, code-to-join or not, so its name is public
// without Luke's OK: names pass the rude-word filter when they're typed, anyone can report one from its
// row (team_reports, migration 0027; the admin inbox, like players' names), and a team Luke hides is gone
// everywhere (a reported one's exact name is blocked from then on: blocked_team_names, migration 0028).
// A new or renamed team can't take a name another team has (teamName); teams that shared a name before
// that keep it, and on Top teams the later ones get a small number (`tag`: 2, 3…, by when they were made).
//
// Which team a game is for is saved with it when it's sent (teamForScore, called from postScore) and
// never changes: switching teams never moves old games. It's the team the kid chose, whoever they play
// as: their own player's team, or the team the device picked the first time it played (Orson and
// approved players have no team of their own). A community team only counts a game from a device that's
// on it (team_members). Games count from FEATURE_FROM.teams, when Top teams went live, for every team
// (code-to-join ones too, though they joined the board later), so changing who can join never changes
// which games count.
//
// A team's score is its TEAM_COUNTS (3) best devices added up, each at its best game for that team in
// that mode, so a team can't win just by having lots of players, and one kid can't fill all 3 places.
// Around the World is a time: the 3 best times add up, and teams with fewer than 3 come after the ones
// with 3. Top teams shows the 10 best; a device on a team below them sees its rank too (POST
// /api/teams/players). Only shown games count, from FEATURE_FROM.teams.

import { lowWins, modeOf } from "../../shared/rules.js";
import type { Mode } from "../../shared/rules.js";
import { TEAMS, TEAM_COUNTS, teamNameOf } from "../../shared/teams.js";
import { forget, rankKey } from "./cache.ts";
import { HttpError } from "./http.ts";
import { newCode, tidyCode } from "./progress.ts";
import { boardNames, boardOf, featureFrom } from "./scores.ts";
import { checkTurnstile, clean, hash, ipKey, isUnfriendly, json, rateLimit, readJson, RUDE } from "./util.ts";
import type { Env } from "./util.ts";

const OFFICIAL = new Map(TEAMS.map((t) => [t.name, t]));
const SHOWN_TEAMS = 10;
const SHOWN_PLAYERS = 20;
export const TEAMS_PER_DEVICE = 3;
// Per IP and day. A school's Wi-Fi is one IP, so a class making and joining teams together must fit.
const NEW_PER_DAY = 20; // teams made (each device makes at most 3, and Turnstile)
const WRONG_CODES_PER_DAY = 15; // wrong join codes: what stops guessing, as for pairing codes
const JOINS_PER_DAY = 100; // joins with a right code, or of a listed team
const CHANGES_PER_DAY = 30; // a maker's changes: new code, listing, kit, name
const LEAVES_PER_DAY = 60;
const READS_PER_DAY = 2000; // a device's own teams and ranks (not edge-cached; the counting is, in rankAll)
const REPORTS_PER_DAY = 30; // shared with reports of players' names (scores.ts)

const KIT_PARTS = ["jersey", "shorts", "trim"] as const;
type Kit = Record<(typeof KIT_PARTS)[number], string>;
type Listing = "private" | "asked" | "listed" | "refused";
type TeamRecord = { id: number; name: string; home: string; away: string; owner: string; listing: Listing; status: string };

const codeHash = (env: Env, code: string) => hash(env, `team:${code}`);
// A team code is shown as T-ABCD-EFGH, so it never looks like a pairing code (ABCD-EFGH, which shares
// saved progress). Typed in, the T is optional.
const showCode = (code: string) => `T-${code.slice(0, 4)}-${code.slice(4)}`;
const typedCode = (value: unknown) => {
	const code = tidyCode(value);
	return code.length === 9 && code.startsWith("T") ? code.slice(1) : code;
};
const keyOf = (id: number) => `c${id}`;
const idOf = (key: string) => {
	const m = key.match(/^c(\d{1,10})$/);
	return m ? Number(m[1]) : null;
};
const parseJson = <T>(text: string | null): T | null => {
	try {
		return text ? (JSON.parse(text) as T) : null;
	} catch {
		return null;
	}
};

function kitOf(value: unknown): Kit {
	const k = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	if (!KIT_PARTS.every((p) => /^#[0-9a-f]{6}$/i.test(String(k[p] ?? "")))) throw new HttpError(400, "Pick all the kit colours.");
	return Object.fromEntries(KIT_PARTS.map((p) => [p, String(k[p]).toLowerCase()])) as Kit;
}

/** The device's leaderboard id, from the device id in a POST body. */
async function boardFrom(env: Env, body: Record<string, unknown>): Promise<string> {
	const device = clean(body.device, 64);
	if (device.length < 16) throw new HttpError(400, "Bad request.");
	return boardOf(env, device);
}

/** A community team as its members and maker see it (never its owner or code). */
const teamView = (t: TeamRecord, board?: string) => ({
	id: t.id,
	key: keyOf(t.id),
	name: t.name,
	home: parseJson<Kit>(t.home),
	away: parseJson<Kit>(t.away),
	...(board !== undefined && t.owner === board ? { maker: true, listing: t.listing } : {}),
});

async function findTeam(env: Env, id: number): Promise<TeamRecord | null> {
	return env.DB.prepare("SELECT id, name, home, away, owner, listing, status FROM community_teams WHERE id = ?").bind(id).first<TeamRecord>();
}

async function isMember(env: Env, board: string, id: number): Promise<boolean> {
	return !!(await env.DB.prepare("SELECT 1 FROM team_members m JOIN community_teams t ON t.id = m.team_id WHERE m.board = ? AND m.team_id = ? AND t.status = 'ok'")
		.bind(board, id)
		.first());
}

/**
 * A typed team name, tidied and checked; throws with a friendly message if it can't be used. A new name
 * can't be one another team already has (any that isn't hidden; `id` is the team being renamed), so two
 * teams never look the same on Top teams. Names are capitals (teamNameOf), so "goats" is GOATS. Teams
 * that shared a name before this rule keep it, with a number on Top teams (`tag`).
 */
async function teamName(env: Env, value: unknown, id = 0): Promise<string> {
	const name = teamNameOf(value);
	if (!name) throw new HttpError(400, "Give your team a name.");
	if ((await isUnfriendly(env, name)) || (await env.DB.prepare("SELECT 1 FROM blocked_team_names WHERE name = ?").bind(name).first())) throw new HttpError(400, RUDE);
	// A made-up team called KINGS would look like the game's own on a jersey.
	if (OFFICIAL.has(name)) throw new HttpError(400, "That's one of the game's teams. Pick it from the teams, or give yours a new name.");
	if (await env.DB.prepare("SELECT 1 FROM community_teams WHERE name = ? AND status = 'ok' AND id != ?").bind(name, id).first())
		throw new HttpError(400, `There's already a team called ${name}. Try a different name.`);
	return name;
}

/**
 * Whether `name` is free to be listed: not an official team's, nor another listed team's. New names are
 * unique already (teamName); this is for teams that shared a name before that, like the two GOATS.
 */
async function listableName(env: Env, name: string, id: number): Promise<boolean> {
	if (OFFICIAL.has(name)) return false;
	return !(await env.DB.prepare("SELECT 1 FROM community_teams WHERE name = ? AND listing = 'listed' AND status = 'ok' AND id != ?").bind(name, id).first());
}

// ---------- Which team a game counts for ----------

/**
 * The team a game counts for, saved with it (an official name or "c<id>"), or null. `sent` is the team
 * the kid chose (an official name) and `sentId` its community team, if any: their own player's team, or
 * the device's team when they play as Orson or someone else's approved player. A community team counts
 * only if this device is on it; anything else is no team.
 */
export async function teamForScore(env: Env, sent: unknown, sentId: unknown, board: string): Promise<string | null> {
	const id = idOf(clean(sentId, 12));
	if (id !== null && (await isMember(env, board, id))) return keyOf(id);
	const name = teamNameOf(sent);
	return OFFICIAL.has(name) ? name : null;
}

// ---------- Counting ----------

type Face = { player: string; base: string | null; colours: unknown };
type Counted = Face & { score: number };
type Ranked = { key: string; name: string; tag?: number; kind: "official" | "community"; score: number; count: number; top: Face; kit: Kit };

// Each device's best game for each team, in one mode (and week). `who` is the device: one device counts
// once per team, whoever it played as. Games count from FEATURE_FROM.teams (?2).
const bestPerDevice = (week: boolean, order: string) => `
	WITH g AS (
	  SELECT id, team, score, player, base, colours, device
	  FROM scores
	  WHERE status = 'shown' AND mode = ?1 AND team IS NOT NULL AND created_at >= ?2
	    ${week ? "AND created_at > datetime('now', '-7 days')" : ""}
	), b AS (
	  SELECT *, ROW_NUMBER() OVER (PARTITION BY team, device ORDER BY score ${order}, id) AS k FROM g
	)`;

/**
 * Every team with games (official, and community ones that are ok), ranked best first. It's the same
 * for everyone, and members of teams below the top 10 ask for it often (their rank), so with `origin` it's kept
 * in the edge cache for 30 seconds under an address no request is served from (cleared with the mode's
 * board in cache.ts, like Top teams).
 */
async function rankAll(env: Env, mode: Mode, week: boolean, origin?: string): Promise<Ranked[]> {
	const cache = typeof caches !== "undefined" && typeof caches.default?.match === "function" && origin ? caches.default : null;
	const key = origin ? rankKey(origin, mode, !week) : "";
	const hit = cache ? await cache.match(key) : undefined;
	if (hit) return hit.json<Ranked[]>();
	const ranked = await countTeams(env, mode, week);
	if (cache) await cache.put(key, new Response(JSON.stringify(ranked), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=30" } }));
	return ranked;
}

async function countTeams(env: Env, mode: Mode, week: boolean): Promise<Ranked[]> {
	const low = lowWins(mode);
	const order = low ? "ASC" : "DESC";
	const [rows, community] = await env.DB.batch([
		env.DB.prepare(
			`${bestPerDevice(week, order)}, r AS (
			   SELECT *, ROW_NUMBER() OVER (PARTITION BY team ORDER BY score ${order}, id) AS n FROM b WHERE k = 1
			 )
			 SELECT team, score, player, base, colours FROM r WHERE n <= ?3 ORDER BY team, n`,
		).bind(mode, featureFrom("teams"), TEAM_COUNTS),
		env.DB.prepare(
			// earlier: how many other ok teams with the same name were made before this one (its tag).
			`SELECT id, name, home,
			   (SELECT COUNT(*) FROM community_teams o WHERE o.name = t.name AND o.status = 'ok' AND o.id < t.id) AS earlier
			 FROM community_teams t WHERE status = 'ok' AND id IN (
			   SELECT DISTINCT CAST(substr(team, 2) AS INTEGER) FROM scores WHERE mode = ?1 AND team GLOB 'c[0-9]*' AND created_at >= ?2
			 )`,
		).bind(mode, featureFrom("teams")),
	]);
	const teams = new Map((community.results as { id: number; name: string; home: string; earlier: number }[]).map((t) => [keyOf(t.id), t]));
	const grouped = new Map<string, Counted[]>();
	for (const r of rows.results as (Counted & { team: string; colours: string | null })[]) {
		if (!OFFICIAL.has(r.team) && !teams.has(r.team)) continue; // hidden, or not a team
		const list = grouped.get(r.team) ?? [];
		list.push({ player: r.player, base: r.base, colours: parseJson(r.colours), score: r.score });
		grouped.set(r.team, list);
	}
	const ranked: Ranked[] = [];
	for (const [key, players] of grouped) {
		const official = OFFICIAL.get(key);
		const c = teams.get(key);
		const name = official?.name ?? c!.name;
		if (!official && (await isUnfriendly(env, name))) continue; // a name Luke has since blocked
		const { score: _, ...top } = players[0];
		ranked.push({
			key,
			name,
			...(c?.earlier ? { tag: c.earlier + 1 } : {}),
			kind: official ? "official" : "community",
			score: players.reduce((sum, p) => sum + p.score, 0),
			count: players.length,
			top,
			kit: official ? { ...official.home } : (parseJson<Kit>(c!.home) ?? { jersey: "#2b2b2f", shorts: "#2b2b2f", trim: "#f2f2ef" }),
		});
	}
	return ranked.sort((a, b) => (low ? b.count - a.count || a.score - b.score : b.score - a.score) || a.name.localeCompare(b.name));
}

const boardRow = (t: Ranked, rank: number) => ({ rank, key: t.key, name: t.name, ...(t.tag ? { tag: t.tag } : {}), kind: t.kind, score: t.score, top: t.top, kit: t.kit });

/** One mode's Top teams: official and community teams, best first (at most 10). */
export async function teamRows(env: Env, mode: Mode, week: boolean, origin?: string) {
	return (await rankAll(env, mode, week, origin))
		.slice(0, SHOWN_TEAMS)
		.map((t, i) => boardRow(t, i + 1));
}

/**
 * A team's players, best first: each device once, at its best game (`id`, for the report flag), the top 3
 * marked as counting. Nicknames show only for players already on the players' board for that mode and
 * range (the rest are a face and a score), unless `everyone`: a code-to-join team's members see each other's.
 */
async function playerRows(env: Env, key: string, mode: Mode, week: boolean, everyone = false) {
	const order = lowWins(mode) ? "ASC" : "DESC";
	const [rows, named] = await Promise.all([
		env.DB.prepare(
			`${bestPerDevice(week, order)}
			 SELECT id, score, player, base, colours, device,
			   (SELECT x.nickname FROM scores x WHERE x.device = b.device AND x.player = b.player AND x.status = 'shown' ORDER BY x.id DESC LIMIT 1) AS nickname
			 FROM b WHERE k = 1 AND team = ?3 ORDER BY score ${order}, id LIMIT ${SHOWN_PLAYERS}`,
		)
			.bind(mode, featureFrom("teams"), key)
			.all<Counted & { id: number; device: string; nickname: string; colours: string | null }>(),
		everyone ? null : boardNames(env, mode, week),
	]);
	return rows.results.map((r, i) => ({
		rank: i + 1,
		id: r.id,
		nickname: !named || named.has(`${r.device} ${r.player}`) ? r.nickname : null,
		player: r.player,
		base: r.base,
		colours: parseJson(r.colours),
		score: r.score,
		counts: i < TEAM_COUNTS,
	}));
}

/** The mode and range asked for (This week unless "all"). */
const rangeOf = (get: (k: string) => unknown) => ({ mode: modeOf(get("mode")), week: get("range") !== "all" });

// ---------- Public, edge-cached reads ----------

/** GET /api/teams?mode=&range=week|all: { teams }. */
export async function teamBoard(env: Env, url: URL): Promise<Response> {
	const { mode, week } = rangeOf((k) => url.searchParams.get(k));
	return json({ teams: await teamRows(env, mode, week, url.origin) }, 200, 30);
}

/** GET /api/teams/list: community teams anyone can join, for the builder (name, kits, how many devices are on it). */
export async function listedTeams(env: Env): Promise<Response> {
	const rows = await env.DB.prepare(
		`SELECT t.id, t.name, t.home, t.away, t.owner, t.listing, t.status, (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS members
		 FROM community_teams t WHERE t.listing = 'listed' AND t.status = 'ok' ORDER BY members DESC, t.name LIMIT 100`,
	).all<TeamRecord & { members: number }>();
	const teams = [];
	for (const t of rows.results) if (!(await isUnfriendly(env, t.name))) teams.push({ ...teamView(t), members: t.members });
	return json({ teams }, 200, 60);
}

/** A team key from a URL: an official name (any case) or "c<id>". */
export const teamKeyOf = (raw: string) => {
	const key = decodeURIComponent(raw);
	const upper = key.toUpperCase();
	if (OFFICIAL.has(upper)) return upper;
	return /^c\d{1,10}$/i.test(key) ? key.toLowerCase() : null;
};

/** GET /api/teams/:key/players?mode=&range=: a team's players (official, or a community team that's ok). */
export async function teamPlayers(env: Env, rawKey: string, url: URL): Promise<Response> {
	const key = teamKeyOf(rawKey);
	const id = key ? idOf(key) : null;
	if (!key) throw new HttpError(404, "No such team.");
	if (id !== null) {
		const t = await findTeam(env, id);
		if (!t || t.status !== "ok") throw new HttpError(404, "No such team.");
	}
	const { mode, week } = rangeOf((k) => url.searchParams.get(k));
	return json({ players: await playerRows(env, key, mode, week) }, 200, 30);
}

// ---------- A device's own teams ----------

/** POST /api/teams/mine { device }: the teams this device made and is on. Not cached. */
export async function myTeams(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	await rateLimit(request, env, "teams-read", READS_PER_DAY, "That's a lot for one day! Try again tomorrow.");
	const board = await boardFrom(env, body);
	const rows = await env.DB.prepare(
		`SELECT id, name, home, away, owner, listing, status, EXISTS (SELECT 1 FROM team_members m WHERE m.board = ?1 AND m.team_id = t.id) AS member
		 FROM community_teams t WHERE status = 'ok' AND (owner = ?1 OR id IN (SELECT team_id FROM team_members WHERE board = ?1)) ORDER BY id`,
	)
		.bind(board)
		.all<TeamRecord & { member: number }>();
	return json({ teams: rows.results.map((t) => ({ ...teamView(t, board), member: !!t.member })), most: TEAMS_PER_DEVICE }, 200, 0);
}

/**
 * POST /api/teams/players { device, key, mode, range }: a team's rank on Top teams (below the top 10 too)
 * and its players. Members of a code-to-join team see every teammate's nickname.
 */
export async function teamStanding(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	await rateLimit(request, env, "teams-read", READS_PER_DAY, "That's a lot for one day! Try again tomorrow.");
	const board = await boardFrom(env, body);
	const key = teamKeyOf(clean(body.key, 12));
	const id = key ? idOf(key) : null;
	if (!key) throw new HttpError(404, "No such team.");
	let everyone = false;
	if (id !== null) {
		const t = await findTeam(env, id);
		if (!t || t.status !== "ok") throw new HttpError(404, "No such team.");
		everyone = t.listing !== "listed" && (await isMember(env, board, id));
	}
	const { mode, week } = rangeOf((k) => body[k]);
	const all = await rankAll(env, mode, week, new URL(request.url).origin);
	const team = all.find((t) => t.key === key);
	const rank = team ? all.indexOf(team) + 1 : null;
	return json({ rank, team: team ? boardRow(team, rank!) : null, players: await playerRows(env, key, mode, week, everyone) }, 200, 0);
}

// ---------- Making, joining and leaving ----------

/** POST /api/teams { device, name, home, away, turnstileToken }: a new code-to-join team, with this device on it. */
export async function makeTeam(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const name = await teamName(env, body.name);
	const [home, away] = [kitOf(body.home), kitOf(body.away)];
	await checkTurnstile(request, env, body.turnstileToken);
	await rateLimit(request, env, "team-new", NEW_PER_DAY, "That's a lot of teams for one day! Try again tomorrow.");
	const board = await boardFrom(env, body);
	const made = await env.DB.prepare("SELECT COUNT(*) AS n FROM community_teams WHERE owner = ?").bind(board).first<{ n: number }>();
	if ((made?.n ?? 0) >= TEAMS_PER_DEVICE) throw new HttpError(400, `You can make ${TEAMS_PER_DEVICE} teams on a device. Join a friend's team instead?`);
	const code = newCode();
	const row = await env.DB.prepare(
		"INSERT INTO community_teams (name, home, away, owner, code_hash, ip_hash) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, name, home, away, owner, listing, status",
	)
		.bind(name, JSON.stringify(home), JSON.stringify(away), board, await codeHash(env, code), await ipKey(request, env))
		.first<TeamRecord>();
	await env.DB.prepare("INSERT OR IGNORE INTO team_members (board, team_id) VALUES (?, ?)").bind(board, row!.id).run();
	return json({ team: { ...teamView(row!, board), member: true }, code: showCode(code) }, 200, 0);
}

const TOO_MANY_TRIES = "That's a lot of tries for one day! Try again tomorrow.";

/** How many times this IP has used `bucket` today (rateLimit), without counting this one. */
async function triedToday(request: Request, env: Env, bucket: string): Promise<number> {
	const row = await env.DB.prepare("SELECT count FROM rate_limits WHERE bucket = ? AND ip_hash = ? AND day = date('now')")
		.bind(bucket, await ipKey(request, env))
		.first<{ count: number }>();
	return row?.count ?? 0;
}

/**
 * POST /api/teams/join { device, code } or { device, id }: this device joins the team the code is for,
 * or a listed team (anyone can join those without a code).
 */
export async function joinTeam(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	// Only wrong codes count towards the guessing limit, so a class joining together isn't stopped.
	if (body.code !== undefined && (await triedToday(request, env, "team-guess")) >= WRONG_CODES_PER_DAY) throw new HttpError(429, TOO_MANY_TRIES);
	let team: TeamRecord | null;
	if (body.code === undefined) {
		team = await findTeam(env, Number(body.id) || 0);
		if (!team || team.status !== "ok" || team.listing !== "listed") throw new HttpError(404, "No such team.");
	} else {
		const code = typedCode(body.code);
		if (code.length !== 8) throw new HttpError(400, "A team code is a T and 8 letters and numbers.");
		team = await env.DB.prepare("SELECT id, name, home, away, owner, listing, status FROM community_teams WHERE code_hash = ? AND status = 'ok'")
			.bind(await codeHash(env, code))
			.first<TeamRecord>();
		if (!team) {
			await rateLimit(request, env, "team-guess", WRONG_CODES_PER_DAY, TOO_MANY_TRIES);
			throw new HttpError(400, "That code didn't work. Check it with your friend and try again.");
		}
	}
	await rateLimit(request, env, "team-join", JOINS_PER_DAY, TOO_MANY_TRIES);
	const board = await boardFrom(env, body);
	await env.DB.prepare("INSERT OR IGNORE INTO team_members (board, team_id) VALUES (?, ?)").bind(board, team.id).run();
	if (team.listing === "listed") await forgetTeams(new URL(request.url).origin); // its number of members
	return json({ team: { ...teamView(team, board), member: true } }, 200, 0);
}

/** POST /api/teams/leave { device, id }: this device leaves a team (its players wear an official one). */
export async function leaveTeam(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	await rateLimit(request, env, "team-leave", LEAVES_PER_DAY, "That's a lot for one day! Try again tomorrow.");
	const board = await boardFrom(env, body);
	await env.DB.prepare("DELETE FROM team_members WHERE board = ? AND team_id = ?").bind(board, Number(body.id) || 0).run();
	return json({ ok: true }, 200, 0);
}

/**
 * POST /api/teams/:id { device, action, … }: the maker's changes.
 *   code: a new code (the old one stops working)    list: ask Luke to let anyone join it
 *   unlist: back to code-to-join                     kit: { home, away }
 *   name: { name } (a listed team goes back to waiting for Luke's OK)
 */
export async function changeTeam(request: Request, env: Env, id: number, origin: string): Promise<Response> {
	const body = await readJson(request);
	await rateLimit(request, env, "team-change", CHANGES_PER_DAY, "That's a lot of changes for one day! Try again tomorrow.");
	const board = await boardFrom(env, body);
	const team = await findTeam(env, id);
	if (!team || team.status !== "ok" || team.owner !== board) throw new HttpError(404, "No such team.");
	const update = (sql: string, ...values: unknown[]) =>
		env.DB.prepare(`UPDATE community_teams SET ${sql}, updated_at = datetime('now') WHERE id = ?`)
			.bind(...values, id)
			.run();
	let code: string | undefined;
	switch (body.action) {
		case "code":
			code = newCode();
			await update("code_hash = ?", await codeHash(env, code));
			break;
		case "list":
			if (team.listing === "listed" || team.listing === "asked") break;
			// Luke said "Not this name": only a new name (which sets it back to private) can ask again.
			if (team.listing === "refused") throw new HttpError(400, "Try a different name so anyone can join.");
			await checkTurnstile(request, env, body.turnstileToken);
			if (!(await listableName(env, team.name, id))) throw new HttpError(400, "There's already a team anyone can join called that. Pick a different name.");
			await update("listing = 'asked'");
			break;
		case "unlist":
			await update("listing = 'private'");
			break;
		case "kit":
			await update("home = ?, away = ?", JSON.stringify(kitOf(body.home)), JSON.stringify(kitOf(body.away)));
			break;
		case "name": {
			if (teamNameOf(body.name) === team.name) break;
			const name = await teamName(env, body.name, id);
			await checkTurnstile(request, env, body.turnstileToken);
			await update("name = ?, listing = ?", name, team.listing === "listed" || team.listing === "asked" ? "asked" : "private");
			break;
		}
		default:
			throw new HttpError(400, "Unknown action.");
	}
	// Every team is on Top teams (its name and kit); a listed one is in the join list too.
	if (body.action !== "code" && body.action !== "list") await forgetTeams(origin);
	const now = (await findTeam(env, id))!;
	return json({ team: { ...teamView(now, board), member: await isMember(env, board, id) }, ...(code ? { code: showCode(code) } : {}) }, 200, 0);
}

/** Clears the cached Top teams and listed teams after a change to a team (cache.ts). */
async function forgetTeams(origin: string) {
	await forget(origin, { teams: true });
}

// ---------- Reporting a team's name ----------

/**
 * POST /api/teams/report { device, key }: someone thinks a community team's name on Top teams isn't
 * friendly. One report per team per IP (and day: the IP hash includes it), so repeats change nothing. A
 * device on the team reporting it is quietly ignored, as for a player's own row.
 */
export async function reportTeam(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	await rateLimit(request, env, "report", REPORTS_PER_DAY, "Thanks! That's plenty of reports for today.");
	const id = idOf(clean(body.key, 12));
	const team = id === null ? null : await findTeam(env, id);
	if (!team || team.status !== "ok") throw new HttpError(404, "That team isn't on the leaderboard.");
	const device = clean(body.device, 64);
	if (device.length >= 16 && (await isMember(env, await boardOf(env, device), team.id))) return json({ ok: true }, 200, 0);
	await env.DB.prepare("INSERT OR IGNORE INTO team_reports (team_id, ip_hash) VALUES (?, ?)")
		.bind(team.id, await ipKey(request, env))
		.run();
	return json({ ok: true }, 200, 0);
}

const clearTeamReports = (env: Env, id: number) => env.DB.prepare("UPDATE team_reports SET cleared = 1 WHERE team_id = ? AND cleared = 0").bind(id).run();

/**
 * A reported team Luke hides: nobody can make or rename a team to exactly its name again
 * (blocked_team_names, migration 0028). Only that exact name: unlike a player's blocked name it isn't
 * matched inside other names, and another team that already has it stays (it can be reported on its
 * own). Only while it has open reports (a team hidden for another reason isn't blocked).
 */
async function blockReportedTeam(env: Env, team: TeamRecord): Promise<void> {
	if (!(await env.DB.prepare("SELECT 1 FROM team_reports WHERE team_id = ? AND cleared = 0").bind(team.id).first())) return;
	await env.DB.prepare("INSERT OR IGNORE INTO blocked_team_names (name, team_id) VALUES (?, ?)").bind(team.name, team.id).run();
}

// ---------- Admin ----------

/** Every community team, for the admin page (reported ones, then ones asking to be listed, first). */
export async function adminTeams(env: Env) {
	const rows = await env.DB.prepare(
		`SELECT id, name, home, away, listing, status, created_at, (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS members,
		   (SELECT COUNT(*) FROM team_reports r WHERE r.team_id = t.id AND r.cleared = 0 AND t.status = 'ok') AS reports
		 FROM community_teams t ORDER BY reports > 0 DESC, listing = 'asked' DESC, id DESC LIMIT 500`,
	).all<Omit<TeamRecord, "owner"> & { created_at: string; members: number; reports: number }>();
	return rows.results.map((t) => ({ ...t, home: parseJson<Kit>(t.home), away: parseJson<Kit>(t.away) }));
}

/**
 * POST /api/admin/teams/:id { action: list | refuse | unlist | hide | show | rename | name-ok | code, name? }.
 * Hiding, renaming or name-ok ("Looks fine") deal with the team's reports.
 * `code` makes a new join code (the old one stops working) for Luke to give the maker in person, for
 * when the maker's device lost it.
 */
export async function editTeam(env: Env, id: number, body: Record<string, unknown>, origin: string): Promise<Response> {
	const team = await findTeam(env, id);
	if (!team) throw new HttpError(404, "No such team.");
	const update = (sql: string, ...values: unknown[]) =>
		env.DB.prepare(`UPDATE community_teams SET ${sql}, updated_at = datetime('now') WHERE id = ?`)
			.bind(...values, id)
			.run();
	switch (body.action) {
		case "list":
			if (!(await listableName(env, team.name, id))) throw new HttpError(400, "Another listed team (or an official one) already has that name.");
			await update("listing = 'listed'");
			break;
		case "refuse": // Not this name: it stays code-to-join, and the maker sees they need a different name to list it.
			await update("listing = 'refused'");
			break;
		case "unlist":
			await update("listing = 'private'");
			break;
		case "hide":
			await blockReportedTeam(env, team);
			await update("status = 'hidden'");
			await clearTeamReports(env, id);
			break;
		case "name-ok": // A reported name that looks fine: its reports leave the inbox. Nothing public changes.
			await clearTeamReports(env, id);
			return json({ ok: true }, 200, 0);
		case "show": // Shown again: its name isn't blocked any more either.
			await env.DB.prepare("DELETE FROM blocked_team_names WHERE name = ?").bind(team.name).run();
			await update("status = 'ok'");
			break;
		case "code": {
			const code = newCode();
			await update("code_hash = ?", await codeHash(env, code));
			return json({ ok: true, code: showCode(code) }, 200, 0);
		}
		case "rename": {
			const name = teamNameOf(body.name);
			if (!name) throw new HttpError(400, "Give the team a name.");
			// Like a kid's rename (teamName), never to a name another team (or an official one) has.
			if (OFFICIAL.has(name) || (await env.DB.prepare("SELECT 1 FROM community_teams WHERE name = ? AND status = 'ok' AND id != ?").bind(name, id).first()))
				throw new HttpError(400, "Another team (or an official one) already has that name.");
			await update("name = ?", name);
			await clearTeamReports(env, id);
			break;
		}
		default:
			throw new HttpError(400, "Unknown action.");
	}
	await forgetTeams(origin);
	return json({ ok: true }, 200, 0);
}

// ---------- Routes ----------

/** The public /api/teams… routes, or null if it isn't one. */
export function teamRoute(request: Request, env: Env, url: URL): Promise<Response> | null {
	const path = url.pathname;
	const get = request.method === "GET";
	const post = request.method === "POST";
	if (get && path === "/api/teams") return teamBoard(env, url);
	if (get && path === "/api/teams/list") return listedTeams(env);
	const players = path.match(/^\/api\/teams\/([^/]{1,40})\/players$/);
	if (get && players) return teamPlayers(env, players[1], url);
	if (post && path === "/api/teams") return makeTeam(request, env);
	if (post && path === "/api/teams/mine") return myTeams(request, env);
	if (post && path === "/api/teams/players") return teamStanding(request, env);
	if (post && path === "/api/teams/join") return joinTeam(request, env);
	if (post && path === "/api/teams/leave") return leaveTeam(request, env);
	if (post && path === "/api/teams/report") return reportTeam(request, env);
	const change = path.match(/^\/api\/teams\/(\d{1,10})$/);
	if (post && change) return changeTeam(request, env, Number(change[1]), url.origin);
	return null;
}
