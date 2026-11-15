// The leaderboard: start tokens, sending a finished game, the preview as a game ends, each mode's
// board and the card for one game.
//
// The game runs in the browser, so a score can't be fully trusted. Instead each score comes with
// its shot log, and the server checks it hangs together by the game's own rules (shared/rules.js).
// What's rejected and what's flagged is in scoring.ts. Here: the start token (signed, used once, and
// old enough for the game it claims), test mode, the robot check and the daily limit.
// (Nicknames don't matter: a device's row is per player, whatever name it's sent with.)
// Devices joined by a pairing code (saved progress, progress.ts) share their rows: see boardOf.

import { AROUND_SPOTS, FIRE_RULES, MONEY, RAINBOW, THREE_POINT_CONTEST, lowWins, modeOf } from "../../shared/rules.js";
import type { Mode, Shot } from "../../shared/rules.js";
import { forget } from "./cache.ts";
import { requireModeOut } from "./flags.ts";
import { HttpError } from "./http.ts";
import { MAX_PLAYER_NAME, PLAYER_PARTS, isNickname, lookJson } from "./players.ts";
import { checkGame, oddFlags } from "./scoring.ts";
import { teamForScore } from "./teams.ts";
import { checkTurnstile, clean, forgetBlockedNames, hash, ipKey, isUnfriendly, json, MIN_BLOCKED, rateLimit, readJson, RUDE, squash } from "./util.ts";
import type { Env } from "./util.ts";

const SCORES_PER_DAY = 40;
const AROUND_PER_DAY = 1000; // a board opened from a device outside the top 10 (the edge cache answers repeats)
const PREVIEWS_PER_DAY = 1000; // one per game, plus one per pause while typing a name; a class shares an IP

// On the leaderboard each device has one row per player it plays as (a built-in one, or one made
// in the builder), at its best, whatever nicknames it was sent with. The row shows its latest one.
const WEEK = "created_at > datetime('now', '-7 days')";
const order = (mode: Mode) => (lowWins(mode) ? "ASC" : "DESC");

/**
 * Whose rows a device's games go on (the scores table's `device`): its own hashed id, or, once it's
 * joined other devices with a pairing code, the one they share (`progress.board`). Joining moves its
 * earlier rows across (joinCode in progress.ts), so each player shows once for all their devices.
 */
export async function boardOf(env: Env, device: string): Promise<string> {
	const own = await hash(env, `device:${device}`);
	const shared = await env.DB.prepare(
		"SELECT p.board FROM progress_devices d JOIN progress p ON p.id = d.progress_id WHERE d.device_hash = ? AND p.board IS NOT NULL LIMIT 1",
	)
		.bind(own)
		.first<{ board: string }>();
	return shared?.board ?? own;
}
// Odd-looking scores Orson hasn't looked at yet: they're in the admin inbox.
export const ODD_UNCHECKED = "status = 'shown' AND flags != '[]' AND checked = 0";
// When each scoring feature arrived in the game (UTC, like created_at). A leaderboard card only
// shows a feature's stats for games played after it, since older games didn't have it (before
// supernova, purple fire just carried on past 10 in a row). Add each new feature that changes
// scoring or shows on the card here, with the time it went live.
const FEATURE_FROM = {
	supernova: "2026-11-05 20:47:00",
	bonusBalls: "2026-11-05 20:47:00",
	// The green part of the jump bar moves from shot to shot in Sudden death (from a run of 5), Around
	// the World and the 3-point contest. Sudden death squeezes it more slowly to make up for it. Older
	// games on those boards were played with it still.
	movingGreen: "2026-11-07 00:53:00",
	// The 3-point contest (racks of five, a money ball last in each).
	threePointContest: "2026-11-07 00:53:00",
	// Top teams (teams.ts): only games from here on count for a team.
	teams: "2026-11-14 10:42:00",
};
export const hadFeature = (createdAt: unknown, feature: keyof typeof FEATURE_FROM) => String(createdAt) >= FEATURE_FROM[feature];
export const featureFrom = (feature: keyof typeof FEATURE_FROM) => FEATURE_FROM[feature];

// A start token says when the game started, signed so it can't be made up. The score must come
// at least a game's length later (or, in sudden death, after its last shot), and each token only
// counts once.
export async function gameToken(env: Env): Promise<string> {
	const started = Date.now();
	const nonce = crypto.randomUUID().slice(0, 8);
	return `${started}.${nonce}.${await hash(env, `game:${started}.${nonce}`)}`;
}

export async function checkGameToken(env: Env, token: unknown, minSeconds: number): Promise<number> {
	const parts = typeof token === "string" ? token.split(".") : [];
	if (parts.length !== 3 || parts[2] !== (await hash(env, `game:${parts[0]}.${parts[1]}`))) throw new HttpError(400, "That game can't be checked.");
	const seconds = (Date.now() - Number(parts[0])) / 1000;
	if (!(seconds >= minSeconds)) throw new HttpError(400, "That game finished too fast.");
	if (seconds > 6 * 3600) throw new HttpError(400, "That game was too long ago to count.");
	return seconds;
}

export async function postScore(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	if (body.debug) throw new HttpError(400, "Scores from test mode don't count.");
	const mode = modeOf(body.mode);
	await requireModeOut(env, mode); // a mode that isn't out yet (flags.ts) has no board
	const nickname = await scoreNickname(env, body);
	const device = clean(body.device, 64);
	if (device.length < 16) throw new HttpError(400, "Bad request.");
	const player = clean(body.player, 40) || "orson";
	const base = /^[a-z0-9-]{1,30}$/.test(String(body.base ?? "")) ? String(body.base) : null;
	// A player made on their device: its colours, so others see the same face. Hex colours only.
	const sent = body.colours && typeof body.colours === "object" ? (body.colours as Record<string, unknown>) : null;
	const colours =
		base && sent && PLAYER_PARTS.every((p) => /^#[0-9a-f]{6}$/i.test(String(sent[p])))
			? lookJson(sent)
			: null;

	// The shot log and score, by the game's rules (scoring.ts), then the token: signed, unused, old enough.
	const score = Number(body.score);
	const game = checkGame(mode, score, body.shots, body.token);
	const { shots, made } = game;
	const realSeconds = await checkGameToken(env, body.token, game.minSeconds);
	await checkTurnstile(request, env, body.turnstileToken);

	const ipHash = await ipKey(request, env);
	const deviceHash = await boardOf(env, device);
	const team = await teamForScore(env, body.team, body.teamId, deviceHash); // for Top teams (teams.ts)
	const [today, history, standing] = await env.DB.batch([
		env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ?").bind(ipHash),
		env.DB.prepare(`SELECT ${lowWins(mode) ? "MIN" : "MAX"}(score) AS best FROM scores WHERE device = ? AND mode = ?`).bind(deviceHash, mode),
		// Where it would land on this week's board (ties go after, as on the board).
		env.DB.prepare(
			`SELECT COUNT(*) + 1 AS rank FROM (SELECT ${lowWins(mode) ? "MIN" : "MAX"}(score) AS best FROM scores WHERE status = 'shown' AND mode = ?1 AND ${WEEK} GROUP BY device, player)
			 WHERE best ${lowWins(mode) ? "<=" : ">="} ?2`,
		).bind(mode, score),
	]);
	if (((today.results[0] as { n: number }).n ?? 0) >= SCORES_PER_DAY) throw new HttpError(429, "That's a lot of games for one day! Try again tomorrow.");
	const past = history.results[0] as { best: number | null };
	const weekRank = (standing.results[0] as { rank: number }).rank;

	// Odd but possible: it still goes on the board, flagged for Orson to look at.
	const flags = oddFlags(mode, score, game, past.best, weekRank);
	const status = "shown";

	const inserted = await env.DB.prepare(
		`INSERT OR IGNORE INTO scores (nickname, score, player, base, colours, shots, made, threes, real_seconds, input, hidden_tab, version, log, flags, status, token, device, ip_hash, mode, team)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
	)
		.bind(
			nickname,
			score,
			player,
			base,
			colours,
			shots.length,
			made,
			shots.filter((s) => s[1] && s[2]).length,
			Math.round(realSeconds),
			clean(body.input, 10) || null,
			body.hiddenTab ? 1 : 0,
			clean(body.version, 20) || null,
			JSON.stringify(shots),
			JSON.stringify(flags),
			status,
			String(body.token),
			deviceHash,
			ipHash,
			mode,
			team,
		)
		.first<{ id: number }>();
	if (!inserted) throw new HttpError(400, "That game's score is already in.");
	// So the board shows it straight away, not after the edge cache runs out (cache.ts).
	await forget(new URL(request.url).origin, { boards: [mode] });
	// Their own player's earlier scores get its latest look too (including ones from before colours were sent).
	if (colours)
		await env.DB.prepare("UPDATE scores SET colours = ?, base = ? WHERE device = ? AND player = ? AND id != ?")
			.bind(colours, base, deviceHash, player, inserted.id)
			.run();

	// Where their row sits this week: at its best, which may be an earlier game.
	const rank = await env.DB.prepare(
		`WITH g AS (SELECT device AS d, player AS p, ${lowWins(mode) ? "MIN" : "MAX"}(score) AS best FROM scores WHERE status = 'shown' AND mode = ?3 AND ${WEEK} GROUP BY 1, 2)
		 SELECT COUNT(*) + 1 AS rank, (SELECT best FROM g WHERE d = ?1 AND p = ?2) AS best FROM g
		 WHERE best ${lowWins(mode) ? "<=" : ">="} (SELECT best FROM g WHERE d = ?1 AND p = ?2) AND NOT (d = ?1 AND p = ?2)`, // ties go after: the board lists earlier games first
	)
		.bind(deviceHash, player, mode)
		.first<{ rank: number; best: number }>();
	return json({ id: inserted.id, status, rank: rank?.rank ?? null, best: rank?.best ?? score });
}

// A leaderboard nickname: checked the same way for the preview and the real thing.
export async function scoreNickname(env: Env, body: Record<string, unknown>): Promise<string> {
	const nickname = clean(body.nickname, MAX_PLAYER_NAME);
	if (!isNickname(nickname)) throw new HttpError(400, "Pick a nickname with letters and numbers.");
	if (await isUnfriendly(env, nickname)) throw new HttpError(400, RUDE);
	return nickname;
}

const REPORTS_PER_DAY = 30;
// Shown scores someone has reported that the admin hasn't acted on yet: they're in the admin inbox.
export const REPORTED = "SELECT r.score_id FROM reports r JOIN scores s ON s.id = r.score_id WHERE r.cleared = 0 AND s.status = 'shown'";

/**
 * Someone reports a leaderboard row's name as unfriendly. One report per score per IP (and day: the
 * IP hash includes it), so repeats change nothing. A device reporting its own row is quietly ignored.
 */
export async function reportScore(request: Request, env: Env, header: string): Promise<Response> {
	const body = await readJson(request);
	const device = header || clean(body.device, 64); // the X-Device header, like the ideas board, or in the body
	await rateLimit(request, env, "report", REPORTS_PER_DAY, "Thanks! That's plenty of reports for today.");
	const scoreId = body.scoreId;
	if (typeof scoreId !== "number" || !Number.isSafeInteger(scoreId) || scoreId < 1) throw new HttpError(400, "Bad request.");
	const score = await env.DB.prepare("SELECT device FROM scores WHERE id = ? AND status = 'shown'").bind(scoreId).first<{ device: string }>();
	if (!score) throw new HttpError(404, "That score isn't on the leaderboard.");
	if (device.length >= 16 && score.device === (await boardOf(env, device))) return json({ ok: true });
	await env.DB.prepare("INSERT OR IGNORE INTO reports (score_id, ip_hash) VALUES (?, ?)")
		.bind(scoreId, await ipKey(request, env))
		.run();
	return json({ ok: true });
}

/**
 * The admin has dealt with a reported name (renamed it, or it looks fine): every open report on that
 * device and player's games is cleared, since the board shows one row (and one name) for them.
 */
export async function clearReports(env: Env, id: number): Promise<void> {
	await env.DB.prepare(
		`UPDATE reports SET cleared = 1
		 WHERE cleared = 0 AND score_id IN (SELECT o.id FROM scores o, scores s WHERE s.id = ? AND o.device = s.device AND o.player = s.player)`,
	)
		.bind(id)
		.run();
}

/**
 * A reported name Luke hides is one nobody should use again: it joins blocked_names, so the name check
 * (util.ts isUnfriendly) turns it away from then on, wherever it's typed. Only while the game has open
 * reports (a name he said "Looks fine" to, or a game hidden for an odd score, isn't blocked). Call it
 * before the reports are cleared. Returns the name if it was blocked.
 */
export async function blockReportedName(env: Env, id: number): Promise<string | null> {
	const row = await env.DB.prepare(
		"SELECT nickname FROM scores WHERE id = ? AND EXISTS (SELECT 1 FROM reports WHERE score_id = scores.id AND cleared = 0)",
	)
		.bind(id)
		.first<{ nickname: string }>();
	const squashed = row ? squash(row.nickname) : "";
	if (squashed.length < MIN_BLOCKED) return null;
	await env.DB.prepare("INSERT OR IGNORE INTO blocked_names (squashed, name, score_id) VALUES (?, ?, ?)").bind(squashed, row!.nickname, id).run();
	forgetBlockedNames();
	return row!.nickname;
}

// Card caches cleared after a rename: the newest games' (older cards are rarely open, and only
// cached for a minute), so a long history doesn't mean hundreds of cache calls.
const RENAME_FORGETS = 40;

/**
 * The admin renames a leaderboard nickname: every game by the same device and player as score `id`
 * (the board shows one row for them, with their latest nickname), checked like a player's own.
 * Returns the modes whose boards changed and the games whose cards should be cleared.
 */
export async function renameScores(env: Env, id: number, nickname: unknown): Promise<{ modes: Mode[]; ids: number[] }> {
	const name = await scoreNickname(env, { nickname });
	const rows = await env.DB.prepare(
		`UPDATE scores SET nickname = ?1
		 WHERE id = ?2 OR (device, player) = (SELECT device, player FROM scores WHERE id = ?2)
		 RETURNING id, mode`,
	)
		.bind(name, id)
		.all<{ id: number; mode: string }>();
	if (!rows.results.length) throw new HttpError(404, "No such score.");
	const ids = rows.results.map((r) => r.id).sort((a, b) => b - a);
	return { modes: [...new Set(rows.results.map((r) => modeOf(r.mode)))], ids: ids.slice(0, RENAME_FORGETS) };
}

// One mode's board: each player on a device appears once, with its best game and its latest
// nickname.
type BoardRow = { id: number | null; nickname: string; score: number; player?: string; base?: string | null; colours: unknown; rank?: number; you?: boolean; mine?: number };
async function boardRows(env: Env, mode: Mode, week: boolean, limit: number) {
	const rows = await env.DB.prepare(
		`SELECT id, score, player, base, colours,
		   (SELECT x.nickname FROM scores x WHERE x.device = t.device AND x.player = t.player AND x.status = 'shown' ORDER BY x.id DESC LIMIT 1) AS nickname
		 FROM (
		   SELECT id, score, player, base, colours, device,
		     ROW_NUMBER() OVER (PARTITION BY device, player ORDER BY score ${order(mode)}, id) AS n
		   FROM scores WHERE status = 'shown' AND mode = ?1 ${week ? `AND ${WEEK}` : ""}
		 ) t WHERE n = 1 ORDER BY score ${order(mode)}, id LIMIT ${limit}`,
	)
		.bind(mode)
		.all<BoardRow & { colours: string | null }>();
	return rows.results.map((r) => ({ ...r, colours: r.colours ? JSON.parse(r.colours) : null }));
}

/** Who's on one mode's players' board (its top 10), as "device player": Top teams' rankings only name them. */
export async function boardNames(env: Env, mode: Mode, week: boolean): Promise<Set<string>> {
	const rows = await env.DB.prepare(
		`SELECT device, player FROM (
		   SELECT id, score, device, player, ROW_NUMBER() OVER (PARTITION BY device, player ORDER BY score ${order(mode)}, id) AS n
		   FROM scores WHERE status = 'shown' AND mode = ?1 ${week ? `AND ${WEEK}` : ""}
		 ) t WHERE n = 1 ORDER BY score ${order(mode)}, id LIMIT ${BOARD_SIZE}`,
	)
		.bind(mode)
		.all<{ device: string; player: string }>();
	return new Set(rows.results.map((r) => `${r.device} ${r.player}`));
}

const BOARD_SIZE = 10;

export async function leaderboard(env: Env, url: URL): Promise<Response> {
	const scores = await boardRows(env, modeOf(url.searchParams.get("mode")), url.searchParams.get("range") !== "all", BOARD_SIZE);
	return json({ scores }, 200, 30);
}

// Where a score lands on one mode's board, without reading the board: how many players have a better best (its
// place is one more), and up to `n` players each side of it, each with their best and latest nickname. It reads in
// score order on the scores_mode_score index: the players better than it (a count), the nearest few dozen scores
// each way, then those players' bests (on the scores_device index). `skip` leaves one device's player out (the one
// asking, at game over). Further down than NEAR_COUNT better scores, it doesn't say: rank null, no rows.
// Players level with the score count below it.
type Near = { rank: number | null; above: BoardRow[]; below: BoardRow[] }; // rank null: too far down to work out
async function nearScore(env: Env, mode: Mode, week: boolean, score: number, n: number, skip?: { device: string; player: string }): Promise<Near> {
	const low = lowWins(mode);
	const better = low ? "<" : ">";
	const worse = low ? ">" : "<";
	const when = week ? `AND ${WEEK}` : "";
	const notSkipped = skip ? "AND NOT (device = ?3 AND player = ?4)" : "";
	const binds = [mode, score, ...(skip ? [skip.device, skip.player] : [])];
	const nearest = (op: string, way: string) =>
		env.DB.prepare(`SELECT device, player FROM scores WHERE mode = ?1 AND status = 'shown' AND score ${op} ?2 ${when} ${notSkipped} ORDER BY score ${way} LIMIT ${NEAR_ROWS}`)
			.bind(...binds)
			.all<{ device: string; player: string }>();
	const [count, up, down] = await Promise.all([
		// (at most NEAR_COUNT scores better than it are read: further down than that, its place isn't worked out)
		env.DB.prepare(
			`SELECT COUNT(DISTINCT k) AS n, COUNT(*) AS seen FROM (SELECT device || ' ' || player AS k FROM scores WHERE mode = ?1 AND status = 'shown' AND score ${better} ?2 ${when} ${notSkipped} LIMIT ${NEAR_COUNT})`,
		)
			.bind(...binds)
			.first<{ n: number; seen: number }>(),
		nearest(better, low ? "DESC" : "ASC"),
		nearest(worse, low ? "ASC" : "DESC"),
	]);
	if ((count?.seen ?? 0) >= NEAR_COUNT) return { rank: null, above: [], below: [] };
	const players = [...new Map([...up.results, ...down.results].map((r) => [`${r.device} ${r.player}`, r])).values()];
	const rank = (count?.n ?? 0) + 1;
	if (!players.length) return { rank, above: [], below: [] };
	// those players' bests (on the scores_device index), as the board shows them
	const devices = [...new Set(players.map((r) => r.device))];
	const bests = await env.DB.prepare(
		`SELECT id, score, player, base, colours, device,
		   (SELECT x.nickname FROM scores x WHERE x.device = t.device AND x.player = t.player AND x.status = 'shown' ORDER BY x.id DESC LIMIT 1) AS nickname
		 FROM (
		   SELECT id, score, player, base, colours, device,
		     ROW_NUMBER() OVER (PARTITION BY device, player ORDER BY score ${order(mode)}, id) AS n
		   FROM scores INDEXED BY scores_device WHERE status = 'shown' AND mode = ?1 ${when} AND device IN (${devices.map((_, i) => `?${i + 2}`).join(", ")})
		 ) t WHERE n = 1`,
	)
		.bind(mode, ...devices)
		.all<BoardRow & { device: string; colours: string | null }>();
	const wanted = new Set(players.map((r) => `${r.device} ${r.player}`));
	const rows = bests.results
		.filter((r) => wanted.has(`${r.device} ${r.player}`))
		.map(({ device: _device, ...r }) => ({ ...r, colours: r.colours ? JSON.parse(r.colours) : null }));
	const isBetter = (a: number) => (low ? a < score : a > score);
	const isWorse = (a: number) => (low ? a > score : a < score);
	const boardOrder = (a: BoardRow, b: BoardRow) => (low ? a.score - b.score : b.score - a.score) || (a.id ?? 0) - (b.id ?? 0);
	const above = rows.filter((r) => isBetter(r.score)).sort(boardOrder).slice(-n);
	const below = rows.filter((r) => isWorse(r.score)).sort(boardOrder).slice(0, n);
	return {
		rank,
		above: above.map((r, i) => ({ ...r, rank: rank - above.length + i })),
		below: below.map((r, i) => ({ ...r, rank: rank + 1 + i })),
	};
}
const NEAR_ROWS = 30; // scores read each way from the one asked about (a player's lower scores can take some)
const NEAR_COUNT = 2000; // the most scores better than it that are counted for its place

// As a game ends: where it would land this week, or that their earlier best this week stays, so
// the game only offers the leaderboard for a new best. Nothing is saved.
export async function previewScore(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	// Asked once or twice a game, so it's limited per IP too.
	await rateLimit(request, env, "preview", PREVIEWS_PER_DAY, "That's a lot of games for one day! Try again tomorrow.");
	const nickname = await scoreNickname(env, body);
	const device = clean(body.device, 64);
	if (device.length < 16) throw new HttpError(400, "Bad request.");
	const score = Number(body.score);
	const mode = modeOf(body.mode);
	if (!Number.isInteger(score) || score < 0 || score > (mode === "around" ? 6 * 36000 : 1000)) throw new HttpError(400, "Bad request.");
	await requireModeOut(env, mode);
	const player = clean(body.player, 40) || "orson";
	const deviceHash = await boardOf(env, device);
	// Their scores already on the board this week, best first: for their own list (the device's id stays private),
	// and whether their earlier best this week stays.
	const sent = await env.DB.prepare(`SELECT id, score, created_at FROM scores WHERE device = ? AND player = ? AND mode = ? AND status = 'shown' AND ${WEEK} ORDER BY score ${order(mode)}, id LIMIT 10`)
		.bind(deviceHash, player, mode)
		.all<{ id: number; score: number; created_at: string }>();
	const old = sent.results[0];
	const better = (a: number, b: number) => (lowWins(mode) ? a < b : a > b);
	const kept = !!old && !better(score, old.score); // their earlier best this week stays
	if (kept) return json({ sent: sent.results, kept, best: old.score, rank: 0, board: [] });
	// Them with the two above and two below (five rows near the top or bottom of the board).
	const near = await nearScore(env, mode, true, score, 4, { device: deviceHash, player });
	if (near.rank === null) return json({ sent: sent.results, kept, best: score, rank: 0, board: [] }); // far down the board
	const up = Math.min(near.above.length, Math.max(2, 4 - near.below.length));
	const down = Math.min(near.below.length, 4 - up);
	const you: BoardRow = { id: null, nickname, score, colours: null, rank: near.rank, you: true };
	return json({ sent: sent.results, kept, best: score, rank: near.rank, board: [...near.above.slice(near.above.length - up), you, ...near.below.slice(0, down)] });
}

// The leaderboard screen shows the top 10; a player further down also sees their place there, with the two above
// and two below. The game asks with its own best score on that board (kept on the device: no device id is sent),
// so the answer is the same for everyone asking about that score, and is cached (cache.ts). Limited per IP too.
export async function aroundScore(request: Request, env: Env, url: URL): Promise<Response> {
	await rateLimit(request, env, "around", AROUND_PER_DAY, "That's a lot of looking for one day! Try again tomorrow.");
	const mode = modeOf(url.searchParams.get("mode"));
	const score = Number(url.searchParams.get("score"));
	if (!Number.isInteger(score) || score < 0 || score > (mode === "around" ? 6 * 36000 : 1000)) throw new HttpError(400, "Bad request.");
	const near = await nearScore(env, mode, url.searchParams.get("range") !== "all", score, 2);
	return json(near, 200, 30);
}

// One leaderboard game, for the card shown when someone's row is tapped. Stats come from the shot
// log; the log itself and anything about the device stay private.
export async function scoreDetail(env: Env, id: number): Promise<Response> {
	const row = await env.DB.prepare(
		`SELECT s.id, s.nickname, s.score, s.player, s.base, s.colours, s.shots, s.made, s.threes, s.log, s.created_at, s.mode,
		   (SELECT COUNT(*) FROM scores o WHERE o.device = s.device AND o.player = s.player AND o.mode = s.mode AND o.status = 'shown') AS games
		 FROM scores s WHERE s.id = ? AND s.status = 'shown'`,
	)
		.bind(id)
		.first<{ log: string; colours: string | null } & Record<string, unknown>>();
	if (!row) throw new HttpError(404, "That score isn't on the leaderboard.");
	// Their top 10 games in this mode, this week and all time (the same device and player).
	const top = (week: boolean) =>
		env.DB.prepare(
			`SELECT o.id, o.score, o.created_at FROM scores o, scores s
			 WHERE s.id = ? AND o.device = s.device AND o.player = s.player AND o.mode = s.mode AND o.status = 'shown'
			 ${week ? `AND o.${WEEK}` : ""} ORDER BY CASE WHEN s.mode = 'around' THEN o.score ELSE -o.score END, o.id LIMIT 10`, // around the world: fastest first
		).bind(id);
	const [week, all] = await env.DB.batch([top(true), top(false)]);
	const { log, colours, ...rest } = row;
	const { green, ...stats } = cardStats(JSON.parse(log) as Shot[], rest.mode as Mode, Number(rest.score), rest.created_at);
	// Only the day each game was played is public, not the time (which would show when a kid plays).
	const days = (games: unknown[]) => (games as Record<string, unknown>[]).map((g) => ({ ...g, created_at: publicDay(g.created_at) }));
	return json(
		{
			...rest,
			created_at: publicDay(rest.created_at),
			colours: colours ? JSON.parse(colours) : null,
			...stats,
			top: { week: days(week.results), all: days(all.results) },
			green,
		},
		200,
		60,
	);
}

/**
 * A saved time ("YYYY-MM-DD HH:MM:SS", UTC) as just the day it was played, in the same format so the
 * game reads it as before: the day in Melbourne (UTC+10, where the players are), at 12:00 UTC, which
 * every timezone from UTC-11 to UTC+11 shows as that same day.
 */
export function publicDay(createdAt: unknown): string | null {
	const at = Date.parse(`${String(createdAt).replace(" ", "T")}Z`);
	if (Number.isNaN(at)) return null;
	return `${new Date(at + 10 * 3600_000).toISOString().slice(0, 10)} 12:00:00`;
}

/**
 * The stats on a game's card, from its shot log. `score` is the saved score (fire bonuses come from
 * it, so older games keep what they really got) and `createdAt` decides which features it had.
 */
export function cardStats(log: Shot[], mode: Mode, score: number, createdAt: unknown) {
	const fireAt = FIRE_RULES[0].streak;
	let streak = 0;
	let bestStreak = 0;
	let onFire = 0;
	let supernova = 0;
	const supernovaAt = FIRE_RULES[FIRE_RULES.length - 1].streak;
	// Bonus balls: how many came up, and how many went in.
	const money = { seen: 0, made: 0 };
	const rainbow = { seen: 0, made: 0 };
	let plainPoints = 0; // 2 or 3 a basket, before fire and bonus balls
	for (const [, three, made, , kind] of log) {
		streak = made ? streak + 1 : 0;
		bestStreak = Math.max(bestStreak, streak);
		if (streak === fireAt) onFire++;
		if (streak === supernovaAt) supernova++;
		const ball = kind === MONEY ? money : kind === RAINBOW ? rainbow : null;
		if (ball) {
			ball.seen++;
			if (made) ball.made++;
		}
		if (made) plainPoints += three ? 3 : 2;
	}
	// Points from being on fire and from bonus balls (around the world's score is a time, so none).
	// From the score itself, so older games keep the fire bonus they really got.
	const bonusPoints = mode === "around" ? 0 : Math.max(0, score - plainPoints);
	// Sudden death: the hottest fire the run reached (0 none, 1 on fire, 2 purple, 3 supernova), and
	// how the shot that ended it was let go (timing in green-zone widths: under 0 early, over 0 late).
	const levels = FIRE_RULES.filter((f) => f.streak < supernovaAt || hadFeature(createdAt, "supernova"));
	const hottestFire = levels.filter((f) => bestStreak >= f.streak).length;
	const last = log.at(-1);
	const missTiming = mode === "survival" && last && !last[2] ? last[3] : null;
	// Around the world: tries at each spot, until the last one went in.
	const tries: number[] = [];
	if (mode === "around") {
		let spot = 0;
		for (const [, , made] of log) {
			if (spot >= AROUND_SPOTS) break;
			tries[spot] = (tries[spot] ?? 0) + 1;
			if (made) spot++;
		}
	}
	// 3-point contest: baskets made from each rack, in order.
	const racks: number[] = [];
	if (mode === "threes" && hadFeature(createdAt, "threePointContest"))
		log.forEach(([, , made], i) => {
			const rack = Math.floor(i / THREE_POINT_CONTEST.balls);
			racks[rack] = (racks[rack] ?? 0) + (made ? 1 : 0);
		});
	return {
		bestStreak,
		onFire,
		racks,
		// Whether the green part of the jump bar was moving (it does in some modes, for newer games).
		movingGreen: mode !== "timed" && hadFeature(createdAt, "movingGreen"),
		// Left out for games from before these existed.
		supernova: hadFeature(createdAt, "supernova") ? supernova : null,
		money: hadFeature(createdAt, "bonusBalls") ? money : null,
		rainbow: hadFeature(createdAt, "bonusBalls") ? rainbow : null,
		bonusPoints,
		hottestFire,
		missTiming,
		tries,
		// Let go in the green part of the jump bar (timing is in green-zone widths from the apex).
		green: log.filter((shot) => Math.abs(shot[3]) <= 0.5).length,
	};
}
