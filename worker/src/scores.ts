// The leaderboard: start tokens, sending a finished game, the preview as a game ends, each mode's
// board and the card for one game.
//
// The game runs in the browser, so a score can't be fully trusted. Instead each score comes with
// its shot log, and the server checks it hangs together by the game's own rules (shared/rules.js).
// What's rejected and what's flagged is in scoring.ts. Here: the start token (signed, used once, and
// old enough for the game it claims), test mode, the robot check and the daily limit.
// (Nicknames don't matter: a device's row is per player, whatever name it's sent with.)

import { AROUND_SPOTS, FIRE_RULES, MONEY, RAINBOW, lowWins, modeOf } from "../../shared/rules.js";
import type { Mode, Shot } from "../../shared/rules.js";
import { HttpError } from "./http.ts";
import { MAX_PLAYER_NAME, PLAYER_PARTS } from "./players.ts";
import { checkGame, oddFlags } from "./scoring.ts";
import { checkTurnstile, clean, hash, ipKey, isRude, json, readJson, RUDE } from "./util.ts";
import type { Env } from "./util.ts";

const SCORES_PER_DAY = 40;

// On the leaderboard each device has one row per player it plays as (a built-in one, or one made
// in the builder), at its best, whatever nicknames it was sent with. The row shows its latest one.
const WEEK = "created_at > datetime('now', '-7 days')";
const order = (mode: Mode) => (lowWins(mode) ? "ASC" : "DESC");
// Odd-looking scores Orson hasn't looked at yet: they're in the admin inbox.
export const ODD_UNCHECKED = "status = 'shown' AND flags != '[]' AND checked = 0";
// When each scoring feature arrived in the game (UTC, like created_at). A leaderboard card only
// shows a feature's stats for games played after it, since older games didn't have it (before
// supernova, purple fire just carried on past 10 in a row). Add each new feature that changes
// scoring or shows on the card here, with the time it went live.
const FEATURE_FROM = {
	supernova: "2026-11-05 20:47:00",
	bonusBalls: "2026-11-05 20:47:00",
};
const hadFeature = (createdAt: unknown, feature: keyof typeof FEATURE_FROM) => String(createdAt) >= FEATURE_FROM[feature];

// A start token says when the game started, signed so it can't be made up. The score must come
// at least a game's length later (or, in sudden death, after its last shot), and each token only
// counts once.
export async function gameToken(env: Env): Promise<string> {
	const started = Date.now();
	const nonce = crypto.randomUUID().slice(0, 8);
	return `${started}.${nonce}.${await hash(env, `game:${started}.${nonce}`)}`;
}

async function checkGameToken(env: Env, token: unknown, minSeconds: number): Promise<number> {
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
	const nickname = scoreNickname(body);
	const device = clean(body.device, 64);
	if (device.length < 16) throw new HttpError(400, "Bad request.");
	const player = clean(body.player, 40) || "orson";
	const base = /^[a-z0-9-]{1,30}$/.test(String(body.base ?? "")) ? String(body.base) : null;
	// A player made on their device: its colours, so others see the same face. Hex colours only.
	const sent = body.colours && typeof body.colours === "object" ? (body.colours as Record<string, unknown>) : null;
	const colours =
		base && sent && PLAYER_PARTS.every((p) => /^#[0-9a-f]{6}$/i.test(String(sent[p])))
			? JSON.stringify(Object.fromEntries(PLAYER_PARTS.map((p) => [p, String(sent[p]).toLowerCase()])))
			: null;

	// The shot log and score, by the game's rules (scoring.ts), then the token: signed, unused, old enough.
	const score = Number(body.score);
	const game = checkGame(mode, score, body.shots, body.token);
	const { shots, made } = game;
	const realSeconds = await checkGameToken(env, body.token, game.minSeconds);
	await checkTurnstile(request, env, body.turnstileToken);

	const ipHash = await ipKey(request, env);
	const deviceHash = await hash(env, `device:${device}`);
	const [today, history] = await env.DB.batch([
		env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ?").bind(ipHash),
		env.DB.prepare(`SELECT ${lowWins(mode) ? "MIN" : "MAX"}(score) AS best FROM scores WHERE device = ? AND mode = ?`).bind(deviceHash, mode),
	]);
	if (((today.results[0] as { n: number }).n ?? 0) >= SCORES_PER_DAY) throw new HttpError(429, "That's a lot of games for one day! Try again tomorrow.");
	const past = history.results[0] as { best: number | null };

	// Odd but possible: it still goes on the board, flagged for Orson to look at.
	const flags = oddFlags(mode, score, game, past.best);
	const status = "shown";

	const inserted = await env.DB.prepare(
		`INSERT OR IGNORE INTO scores (nickname, score, player, base, colours, shots, made, threes, real_seconds, input, hidden_tab, version, log, flags, status, token, device, ip_hash, mode)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
		)
		.first<{ id: number }>();
	if (!inserted) throw new HttpError(400, "That game's score is already in.");
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
function scoreNickname(body: Record<string, unknown>): string {
	const nickname = clean(body.nickname, MAX_PLAYER_NAME);
	if (!/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(nickname)) throw new HttpError(400, "Pick a nickname with letters and numbers.");
	if (isRude(nickname)) throw new HttpError(400, RUDE);
	return nickname;
}

// One mode's board: each player on a device appears once, with its best game and its latest
// nickname. `mine` marks the row for one device and player.
type BoardRow = { id: number | null; nickname: string; score: number; player?: string; base?: string | null; colours: unknown; rank?: number; you?: boolean; mine?: number };
async function boardRows(env: Env, mode: Mode, week: boolean, limit: number, mine?: { device: string; player: string }) {
	const rows = await env.DB.prepare(
		`SELECT id, score, player, base, colours${mine ? ", (device = ?2 AND player = ?3) AS mine" : ""},
		   (SELECT x.nickname FROM scores x WHERE x.device = t.device AND x.player = t.player AND x.status = 'shown' ORDER BY x.id DESC LIMIT 1) AS nickname
		 FROM (
		   SELECT id, score, player, base, colours, device,
		     ROW_NUMBER() OVER (PARTITION BY device, player ORDER BY score ${order(mode)}, id) AS n
		   FROM scores WHERE status = 'shown' AND mode = ?1 ${week ? `AND ${WEEK}` : ""}
		 ) t WHERE n = 1 ORDER BY score ${order(mode)}, id LIMIT ${limit}`,
	)
		.bind(mode, ...(mine ? [mine.device, mine.player] : []))
		.all<BoardRow & { colours: string | null }>();
	return rows.results.map((r) => ({ ...r, colours: r.colours ? JSON.parse(r.colours) : null }));
}

export async function leaderboard(env: Env, url: URL): Promise<Response> {
	const scores = await boardRows(env, modeOf(url.searchParams.get("mode")), url.searchParams.get("range") !== "all", 10);
	return json({ scores }, 200, 30);
}

// As a game ends: where it would land this week, or that their earlier best this week stays, so
// the game only offers the leaderboard for a new best. Nothing is saved.
export async function previewScore(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const nickname = scoreNickname(body);
	const device = clean(body.device, 64);
	if (device.length < 16) throw new HttpError(400, "Bad request.");
	const score = Number(body.score);
	const mode = modeOf(body.mode);
	if (!Number.isInteger(score) || score < 0 || score > (mode === "around" ? 6 * 36000 : 1000)) throw new HttpError(400, "Bad request.");
	const player = clean(body.player, 40) || "orson";
	const deviceHash = await hash(env, `device:${device}`);
	const [rows, sent] = await Promise.all([
		boardRows(env, mode, true, 500, { device: deviceHash, player }),
		// Their scores already on the board this week, for their own list (the device's id stays private).
		env.DB.prepare(`SELECT id, score, created_at FROM scores WHERE device = ? AND player = ? AND mode = ? AND status = 'shown' AND ${WEEK} ORDER BY score ${order(mode)}, id LIMIT 10`)
			.bind(deviceHash, player, mode)
			.all(),
	]);

	const old = rows.find((r) => r.mine);
	const better = (a: number, b: number) => (lowWins(mode) ? a < b : a > b);
	const kept = !!old && !better(score, old.score); // their earlier best this week stays
	let board: BoardRow[] = rows.filter((r) => !r.mine || kept);
	if (!kept) {
		const at = board.findIndex((r) => better(score, r.score));
		board.splice(at < 0 ? board.length : at, 0, { id: null, nickname, score, colours: null });
	}
	board = board.map((r, i) => ({ ...r, rank: i + 1, you: r.mine ? true : r.id === null, mine: undefined }));
	// Them with the two above and two below (five rows near the top or bottom of the board).
	const at = board.findIndex((r) => r.you);
	const end = Math.min(board.length, Math.max(0, at - 2) + 5);
	return json({
		sent: sent.results,
		kept,
		best: kept ? old.score : score,
		rank: at + 1,
		board: board.slice(Math.max(0, end - 5), end),
	});
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
	const log = JSON.parse(row.log) as Shot[];
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
	const bonusPoints = row.mode === "around" ? 0 : Math.max(0, Number(row.score) - plainPoints);
	// Sudden death: the hottest fire the run reached (0 none, 1 on fire, 2 purple, 3 supernova), and
	// how the shot that ended it was let go (timing in green-zone widths: under 0 early, over 0 late).
	const levels = FIRE_RULES.filter((f) => f.streak < supernovaAt || hadFeature(row.created_at, "supernova"));
	const hottestFire = levels.filter((f) => bestStreak >= f.streak).length;
	const last = log.at(-1);
	const missTiming = row.mode === "survival" && last && !last[2] ? last[3] : null;
	// Around the world: tries at each spot, until the last one went in.
	const tries: number[] = [];
	if (row.mode === "around") {
		let spot = 0;
		for (const [, , made] of log) {
			if (spot >= AROUND_SPOTS) break;
			tries[spot] = (tries[spot] ?? 0) + 1;
			if (made) spot++;
		}
	}
	const { log: _log, colours, ...rest } = row;
	return json(
		{
			...rest,
			colours: colours ? JSON.parse(colours) : null,
			bestStreak,
			onFire,
			// Left out for games from before these existed.
			supernova: hadFeature(row.created_at, "supernova") ? supernova : null,
			money: hadFeature(row.created_at, "bonusBalls") ? money : null,
			rainbow: hadFeature(row.created_at, "bonusBalls") ? rainbow : null,
			bonusPoints,
			hottestFire,
			missTiming,
			tries,
			top: { week: week.results, all: all.results },
			// Let go in the green part of the jump bar (timing is in green-zone widths from the apex).
			green: log.filter((shot) => Math.abs(shot[3]) <= 0.5).length,
		},
		200,
		60,
	);
}
