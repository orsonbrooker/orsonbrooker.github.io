// Ideas board API for orsonbrooker.com.
//
// Public:  GET  /api/config         Turnstile site key and the list of games/apps
//          GET  /api/ideas          approved ideas (?app= to filter, &device= to mark own votes)
//          POST /api/submit         a visitor's idea; goes to the admin inbox, never straight to the board
//          POST /api/vote           upvote or un-upvote an idea
//          GET  /api/check?text=    is this text OK? (live checks while typing)
//          GET  /api/players        approved players made with the builder
//          POST /api/players        a new player; waits for approval before it's in the game
//          POST /api/games          a signed start token for a new game of Shootaround
//          GET  /api/scores         the leaderboard (?range=week or all, ?mode=timed, survival or around)
//          POST /api/scores         a finished game's score, with its shot log (checked, see postScore)
// Admin:   GET  /admin              triage page (behind Cloudflare Access)
//          GET  /api/admin/inbox    new submissions, all ideas and apps
//          POST /api/admin/submissions/:id   approve as a new idea, merge into an idea, or reject
//          POST /api/admin/ideas/:id         edit an idea or change its status
//          POST /api/admin/players/:id       approve, hide, rename or delete a player
//          POST /api/admin/scores/:id        show or hide a leaderboard score

import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";
import adminPage from "./admin.html?raw";

// Rude-word check for everything people type. It sees through tricks like "a$$" and spacing,
// without blocking innocent words that happen to contain rude ones.
const rudeWords = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
const isRude = (...texts: (string | null | undefined)[]) => texts.some((t) => !!t && rudeWords.hasMatch(t));
const RUDE = "Let's keep it friendly. Try different words.";

interface Env {
	DB: D1Database;
	SITE_URL: string;
	TURNSTILE_SITE_KEY: string;
	TURNSTILE_SECRET: string;
	HASH_SECRET: string;
	ACCESS_TEAM_DOMAIN?: string;
	ACCESS_AUD?: string;
	NTFY_TOPIC?: string;
	DEV_ADMIN?: string; // local development only: skips the Access check
}

const STATUSES = ["idea", "planned", "building", "done", "hidden"];
const MAX_TEXT = 500;
const MAX_NICKNAME = 20;
const SUBMISSIONS_PER_HOUR = 5;
const PLAYERS_PER_HOUR = 3;
const MAX_PLAYER_NAME = 12;
const MAX_TEAM_NAME = 10;
const PLAYER_PARTS = ["skin", "hair", "jersey", "team", "shoes"] as const;
const VOTES_PER_DAY = 60;
const SCORES_PER_DAY = 40;

// On the leaderboard each device has one row per player it plays as (a built-in one, or one made
// in the builder), at its best, whatever nicknames it was sent with. The row shows its latest one.
const WEEK = "created_at > datetime('now', '-7 days')";

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		try {
			if (url.pathname === "/admin" || url.pathname === "/admin/") return await adminHtml(request, env);
			if (url.pathname.startsWith("/api/admin/")) return await admin(request, env, url);
			if (request.method === "OPTIONS") return cors(request, new Response(null, { status: 204 }));
			return cors(request, await publicApi(request, env, url));
		} catch (err) {
			if (err instanceof HttpError) return cors(request, json({ error: err.message }, err.status));
			console.error(err);
			return cors(request, json({ error: "Something went wrong." }, 500));
		}
	},

	// Weekly nudge: a phone notification when there are ideas waiting to be checked.
	async scheduled(_controller, env): Promise<void> {
		if (!env.NTFY_TOPIC) return;
		const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'new'").first<{ n: number }>();
		const players = await env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE status = 'new'").first<{ n: number }>();
		const votes = await env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE created_at > datetime('now', '-7 days')").first<{ n: number }>();
		const odd = await env.DB.prepare(`SELECT COUNT(*) AS n FROM scores WHERE ${ODD_UNCHECKED}`).first<{ n: number }>();
		const ideas = row?.n ?? 0;
		const newPlayers = players?.n ?? 0;
		const oddScores = odd?.n ?? 0;
		if (!ideas && !newPlayers && !oddScores) return;
		const waiting = [
			ideas && `${ideas} new idea${ideas === 1 ? "" : "s"}`,
			newPlayers && `${newPlayers} new player${newPlayers === 1 ? "" : "s"}`,
			oddScores && `${oddScores} odd-looking score${oddScores === 1 ? "" : "s"}`,
		]
			.filter(Boolean)
			.join(" and ");
		await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
			method: "POST",
			headers: { Title: "Things to check", Click: `${env.SITE_URL}/admin`, Tags: "basketball" },
			body: `${waiting} waiting, and ${votes?.n ?? 0} votes this week.`,
		});
	},
} satisfies ExportedHandler<Env>;

// ---------- Public API ----------

async function publicApi(request: Request, env: Env, url: URL): Promise<Response> {
	const route = `${request.method} ${url.pathname}`;
	const scoreId = route.match(/^GET \/api\/scores\/(\d{1,10})$/);
	if (scoreId) return scoreDetail(env, Number(scoreId[1]));
	switch (route) {
		case "GET /api/config": {
			const apps = await env.DB.prepare("SELECT slug, name FROM apps ORDER BY name").all();
			return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY, apps: apps.results }, 200, 300);
		}
		case "GET /api/ideas":
			return listIdeas(env, url);
		case "POST /api/submit":
			return submit(request, env);
		case "POST /api/vote":
			return vote(request, env);
		case "GET /api/check": {
			const text = (url.searchParams.get("text") ?? "").slice(0, 600);
			return json({ ok: !isRude(text) });
		}
		case "GET /api/players": {
			const players = await env.DB.prepare(
				"SELECT id, name, base, skin, hair, jersey, team, shoes, number, team_name FROM players WHERE status = 'approved' ORDER BY name COLLATE NOCASE",
			).all();
			return json({ players: players.results }, 200, 60);
		}
		case "POST /api/players":
			return createPlayer(request, env);
		case "POST /api/games":
			return json({ token: await gameToken(env) });
		case "GET /api/scores":
			return leaderboard(env, url);
		case "POST /api/scores":
			return postScore(request, env);
		case "POST /api/scores/preview":
			return previewScore(request, env);
	}
	throw new HttpError(404, "Not found.");
}

async function listIdeas(env: Env, url: URL): Promise<Response> {
	const app = url.searchParams.get("app");
	const device = url.searchParams.get("device");
	const query = app
		? env.DB.prepare(
				"SELECT id, app, title, description, credit, status, votes, done_at FROM ideas WHERE status != 'hidden' AND app = ? ORDER BY votes DESC, id DESC",
			).bind(app)
		: env.DB.prepare(
				"SELECT id, app, title, description, credit, status, votes, done_at FROM ideas WHERE status != 'hidden' ORDER BY votes DESC, id DESC",
			);
	const ideas = (await query.all()).results;
	let voted: number[] = [];
	if (device) {
		const voter = await hash(env, `device:${device}`);
		voted = (await env.DB.prepare("SELECT idea_id FROM votes WHERE voter = ?").bind(voter).all<{ idea_id: number }>()).results.map(
			(r) => r.idea_id,
		);
	}
	return json({ ideas, voted });
}

async function submit(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const app = clean(body.app, 40);
	const text = clean(body.text, MAX_TEXT);
	const nickname = clean(body.nickname, MAX_NICKNAME) || null;
	if (!text || text.length < 3) throw new HttpError(400, "Please write your idea first.");
	if (/https?:|www\.|\.(com|net|org|io)\b/i.test(`${text} ${nickname ?? ""}`)) {
		throw new HttpError(400, "Please leave out web links.");
	}
	if (isRude(text, nickname)) throw new HttpError(400, RUDE);
	const known = await env.DB.prepare("SELECT 1 FROM apps WHERE slug = ?").bind(app).first();
	if (!known) throw new HttpError(400, "Unknown game.");
	await checkTurnstile(request, env, body.turnstileToken);

	const ipHash = await ipKey(request, env);
	const recent = await env.DB.prepare(
		"SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')",
	)
		.bind(ipHash)
		.first<{ n: number }>();
	if ((recent?.n ?? 0) >= SUBMISSIONS_PER_HOUR) throw new HttpError(429, "That's a lot of ideas! Try again in a bit.");

	await env.DB.prepare("INSERT INTO submissions (app, text, nickname, ip_hash) VALUES (?, ?, ?, ?)")
		.bind(app, text, nickname, ipHash)
		.run();
	return json({ ok: true });
}

async function vote(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const ideaId = Number(body.ideaId);
	const device = clean(body.device, 64);
	if (!Number.isInteger(ideaId) || device.length < 16) throw new HttpError(400, "Bad vote.");
	const idea = await env.DB.prepare("SELECT id FROM ideas WHERE id = ? AND status != 'hidden'").bind(ideaId).first();
	if (!idea) throw new HttpError(404, "That idea isn't on the board.");

	const voter = await hash(env, `device:${device}`);
	const ipHash = await ipKey(request, env);
	if (body.up) {
		const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE ip_hash = ?").bind(ipHash).first<{ n: number }>();
		if ((today?.n ?? 0) >= VOTES_PER_DAY) throw new HttpError(429, "That's a lot of votes for one day!");
		await env.DB.batch([
			env.DB.prepare("INSERT OR IGNORE INTO votes (idea_id, voter, ip_hash) VALUES (?, ?, ?)").bind(ideaId, voter, ipHash),
			recount(env, ideaId),
		]);
	} else {
		await env.DB.batch([env.DB.prepare("DELETE FROM votes WHERE idea_id = ? AND voter = ?").bind(ideaId, voter), recount(env, ideaId)]);
	}
	const row = await env.DB.prepare("SELECT votes FROM ideas WHERE id = ?").bind(ideaId).first<{ votes: number }>();
	return json({ votes: row?.votes ?? 0, up: !!body.up });
}

// A player from the builder: a base body, four colours and a nickname. Waits for approval.
async function createPlayer(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const name = clean(body.name, MAX_PLAYER_NAME);
	if (!/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(name)) throw new HttpError(400, "Pick a nickname with letters and numbers.");
	const base = clean(body.base, 30);
	if (!/^[a-z0-9-]+$/.test(base)) throw new HttpError(400, "Pick a body.");
	const colours = (body.colours ?? {}) as Record<string, unknown>;
	for (const part of PLAYER_PARTS) {
		if (typeof colours[part] !== "string" || !/^#[0-9a-f]{6}$/i.test(colours[part] as string)) throw new HttpError(400, "Pick all the colours.");
	}
	const number = body.number === undefined || body.number === null || body.number === "" ? null : String(body.number);
	if (number !== null && !/^\d{1,2}$/.test(number)) throw new HttpError(400, "Numbers go from 0 to 99.");
	const teamName = clean(body.teamName, MAX_TEAM_NAME).toUpperCase();
	if (teamName && !/^[A-Z0-9 ]+$/.test(teamName)) throw new HttpError(400, "Team names use letters and numbers.");
	if (isRude(name, teamName)) throw new HttpError(400, RUDE);
	await checkTurnstile(request, env, body.turnstileToken);

	const ipHash = await ipKey(request, env);
	const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')")
		.bind(ipHash)
		.first<{ n: number }>();
	if ((recent?.n ?? 0) >= PLAYERS_PER_HOUR) throw new HttpError(429, "That's a lot of players! Try again in a bit.");

	await env.DB.prepare(
		"INSERT INTO players (name, base, skin, hair, jersey, team, shoes, number, team_name, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(name, base, ...PLAYER_PARTS.map((p) => (colours[p] as string).toLowerCase()), number, teamName || "KINGS", ipHash)
		.run();

	// If they've played as this player on their device, its leaderboard scores get this look.
	const localId = String(body.localId ?? "");
	const device = clean(body.device, 64);
	if (/^me\d{1,15}$/.test(localId) && device.length >= 16) {
		const look = JSON.stringify(Object.fromEntries(PLAYER_PARTS.map((p) => [p, (colours[p] as string).toLowerCase()])));
		await env.DB.prepare("UPDATE scores SET colours = ?, base = ? WHERE device = ? AND player = ?")
			.bind(look, base, await hash(env, `device:${device}`), localId)
			.run();
	}
	return json({ ok: true });
}

function recount(env: Env, ideaId: number) {
	return env.DB.prepare("UPDATE ideas SET votes = (SELECT COUNT(*) FROM votes WHERE idea_id = ?1) WHERE id = ?1").bind(ideaId);
}

async function checkTurnstile(request: Request, env: Env, token: unknown) {
	if (typeof token !== "string" || !token) throw new HttpError(400, "Please finish the robot check.");
	const form = new FormData();
	form.append("secret", env.TURNSTILE_SECRET);
	form.append("response", token);
	const ip = request.headers.get("CF-Connecting-IP");
	if (ip) form.append("remoteip", ip);
	const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
	const outcome = await res.json<{ success: boolean; hostname?: string }>();
	if (!outcome.success) throw new HttpError(400, "The robot check didn't work. Please try again.");
	// On the live site, only accept checks passed on this site (local test keys report another host).
	if (env.ACCESS_AUD && outcome.hostname !== new URL(env.SITE_URL).hostname) {
		throw new HttpError(400, "The robot check didn't work. Please try again.");
	}
}

// ---------- Leaderboard ----------
//
// The game runs in the browser, so a score can't be fully trusted. Instead each score comes with
// its shot log and the server checks it hangs together:
//   rejected  impossible: a bad or reused start token, sent too soon after the game started, the
//             score doesn't match its shots, more shots than fit in a minute, or test (?debug) mode.
//             A sudden death game must end on its first miss, with nothing made after it. An around
//             the world time must come just after its last spot went in.
//   flagged   odd but possible: machine-like timing, a perfect game of 30+ shots, a huge jump on the
//             device's best. On the board straight away, and in Orson's admin inbox so he can hide it.
//             (Nicknames don't matter: a device's row is per player, whatever name it's sent with.)
//   shown     everything else, straight away.

const GAME_SECONDS = 60;
// Three modes, each with its own leaderboard: 60 seconds, sudden death (shoot until the first miss),
// or around the world (all 7 spots, against the clock).
type Mode = "timed" | "survival" | "around";
const modeOf = (value: unknown): Mode => (value === "survival" || value === "around" ? value : "timed");
// Around the world's "score" is its time in tenths of a second, so lower is better.
const AROUND_SPOTS = 7;
const lowWins = (mode: Mode) => mode === "around";
const order = (mode: Mode) => (lowWins(mode) ? "ASC" : "DESC");
// Odd-looking scores Orson hasn't looked at yet: they're in the admin inbox.
const ODD_UNCHECKED = "status = 'shown' AND flags != '[]' AND checked = 0";
const MIN_SHOT_GAP = 1.0; // seconds: release, flight, moving spot and jumping again take longer than this
// The game's fire levels (FIRE_LEVELS in game.js), biggest first.
const FIRE_BONUS = [
	{ streak: 10, bonus: 3 },
	{ streak: 6, bonus: 2 },
	{ streak: 3, bonus: 1 },
];
// When each scoring feature arrived in the game (UTC, like created_at). A leaderboard card only
// shows a feature's stats for games played after it, since older games didn't have it (before
// supernova, purple fire just carried on past 10 in a row). Add each new feature that changes
// scoring or shows on the card here, with the time it went live.
const FEATURE_FROM = {
	supernova: "2026-11-05 20:47:00",
	bonusBalls: "2026-11-05 20:47:00",
};
const hadFeature = (createdAt: unknown, feature: keyof typeof FEATURE_FROM) => String(createdAt) >= FEATURE_FROM[feature];
// seconds in, 3-pointer (1/0), made (1/0), release timing, bonus ball (0 normal, 1 money, 2 rainbow)
type Shot = [number, number, number, number, number];

// Bonus balls, the same as bonus.js in the game: which shots get one comes from the start token.
const MONEY = 1;
const RAINBOW = 2;
function ballKind(token: string, index: number): number {
	let h = 0x811c9dc5;
	const text = `${token}#${index}`;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h = (h ^ (h >>> 16)) >>> 0;
	const roll = h / 2 ** 32;
	return roll < 1 / 40 ? RAINBOW : roll < 1 / 40 + 1 / 8 ? MONEY : 0;
}
function ballPoints(kind: number, three: number, fireBonus: number): number {
	if (kind === RAINBOW) return 5 + fireBonus;
	const points = (three ? 3 : 2) + fireBonus;
	return kind === MONEY ? points * 2 : points;
}

// A start token says when the game started, signed so it can't be made up. The score must come
// at least a game's length later (or, in sudden death, after its last shot), and each token only
// counts once.
async function gameToken(env: Env): Promise<string> {
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

// The game's own rules: 2 or 3 points, plus a bonus while on fire (3, 6 or 10 makes in a row).
function recountScore(shots: Shot[]): number {
	let score = 0;
	let streak = 0;
	for (const [, three, made, , kind] of shots) {
		if (!made) {
			streak = 0;
			continue;
		}
		score += ballPoints(kind, three, FIRE_BONUS.find((f) => streak >= f.streak)?.bonus ?? 0);
		streak++;
	}
	return score;
}

const spread = (values: number[]) => {
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
};

async function postScore(request: Request, env: Env): Promise<Response> {
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

	// The shot log, and the score it adds up to.
	const raw = Array.isArray(body.shots) ? body.shots : [];
	if (raw.length > (mode === "timed" ? 80 : 500)) throw new HttpError(400, "That's more shots than fit in a game.");
	const shots: Shot[] = raw.map((s: unknown, i: number) => {
		if (!Array.isArray(s) || (s.length !== 4 && s.length !== 5) || !s.every((n) => typeof n === "number" && Number.isFinite(n))) throw new HttpError(400, "Bad shot log.");
		// A bonus ball only counts if this game's token really gave that shot one.
		const kind = s[4] ?? 0;
		if (kind !== 0 && kind !== ballKind(String(body.token), i)) throw new HttpError(400, "Bad shot log.");
		return [Math.round(s[0] * 100) / 100, s[1] ? 1 : 0, s[2] ? 1 : 0, Math.round(s[3] * 1000) / 1000, kind];
	});
	const score = Number(body.score);
	if (mode === "around") {
		// The time: once the last spot goes in, just after that shot was let go. No bonus balls here.
		const lastSpot = shots.reduce((found, s, i) => (found.made < AROUND_SPOTS && s[2] ? { made: found.made + 1, at: i } : found), { made: 0, at: -1 });
		const seconds = score / 10;
		if (!Number.isInteger(score) || lastSpot.made < AROUND_SPOTS || shots.some((s) => s[4]) || seconds < shots[lastSpot.at][0] || seconds > shots[lastSpot.at][0] + 5)
			throw new HttpError(400, "That time doesn't match its shots.");
	} else if (!Number.isInteger(score) || score < 1 || score !== recountScore(shots)) throw new HttpError(400, "That score doesn't match its shots.");
	const times = shots.map((s) => s[0]);
	const maxTime = mode === "timed" ? GAME_SECONDS + 0.5 : 6 * 3600;
	if (times.some((t, i) => t < 0 || t > maxTime || (i > 0 && t < times[i - 1]))) throw new HttpError(400, "Bad shot log.");
	if (mode === "survival") {
		// It ends on the first miss. A shot already in the air then doesn't count, so nothing after it is made.
		const miss = shots.findIndex((s) => !s[2]);
		if (miss < 0 || shots.slice(miss).some((s) => s[2])) throw new HttpError(400, "A sudden death game ends on its first miss.");
	}
	const realSeconds = await checkGameToken(env, body.token, mode === "timed" ? GAME_SECONDS - 1 : Math.max(times.at(-1) ?? 0, mode === "around" ? score / 10 : 0) - 1);
	const gaps = times.slice(1).map((t, i) => t - times[i]);
	if (gaps.some((g) => g < MIN_SHOT_GAP)) throw new HttpError(400, "Those shots came too quickly.");
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
	const made = shots.filter((s) => s[2]).length;
	const flags: string[] = [];
	if (shots.length >= 10 && spread(shots.map((s) => s[3])) < 0.03) flags.push("Every release timed the same, like a script");
	if (gaps.length >= 9 && spread(gaps) < 0.05) flags.push("Shots taken at a machine-like steady rhythm");
	// Great players really do make almost everything (Orson went 28 of 29), so only a long perfect game is odd.
	if (mode === "timed" && shots.length >= 30 && made === shots.length) flags.push(`All ${made} shots made`);
	// In sudden death every shot but the last goes in, so only a very long run is odd.
	if (mode === "survival" && made >= 50) flags.push(`${made} in a row before missing`);
	if (mode === "around") {
		if ((past.best ?? 0) > 0 && score * 2 < past.best!) flags.push(`Twice as fast as this device's best (${past.best! / 10}s)`);
	} else if ((past.best ?? 0) >= 10 && score > past.best! * 2.5) flags.push(`${Math.round(score / past.best!)}x this device's best (${past.best})`);
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

async function leaderboard(env: Env, url: URL): Promise<Response> {
	const scores = await boardRows(env, modeOf(url.searchParams.get("mode")), url.searchParams.get("range") !== "all", 10);
	return json({ scores }, 200, 30);
}

// As a game ends: where it would land this week, or that their earlier best this week stays, so
// the game only offers the leaderboard for a new best. Nothing is saved.
async function previewScore(request: Request, env: Env): Promise<Response> {
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
async function scoreDetail(env: Env, id: number): Promise<Response> {
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
	const fireAt = Math.min(...FIRE_BONUS.map((f) => f.streak));
	let streak = 0;
	let bestStreak = 0;
	let onFire = 0;
	let supernova = 0;
	const supernovaAt = Math.max(...FIRE_BONUS.map((f) => f.streak));
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
	const levels = [...FIRE_BONUS].reverse().filter((f) => f.streak < supernovaAt || hadFeature(row.created_at, "supernova"));
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

// ---------- Admin ----------

async function adminHtml(request: Request, env: Env): Promise<Response> {
	await requireAdmin(request, env);
	return new Response(adminPage, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Robots-Tag": "noindex",
			// Never shown inside another site's frame, so buttons can't be click-jacked.
			"Content-Security-Policy": "frame-ancestors 'none'",
			"X-Frame-Options": "DENY",
			"Referrer-Policy": "no-referrer",
		},
	});
}

async function admin(request: Request, env: Env, url: URL): Promise<Response> {
	await requireAdmin(request, env);
	const parts = url.pathname.split("/").filter(Boolean); // api, admin, ...
	if (request.method === "GET" && parts[2] === "inbox") {
		const [submissions, ideas, apps, players, scores] = await env.DB.batch([
			env.DB.prepare("SELECT id, app, text, nickname, created_at, title, description, note, merge_into FROM submissions WHERE status = 'new' ORDER BY id"),
			env.DB.prepare("SELECT id, app, title, description, credit, status, votes FROM ideas ORDER BY app, votes DESC"),
			env.DB.prepare("SELECT slug, name FROM apps ORDER BY name"),
			env.DB.prepare(
				"SELECT id, name, base, skin, hair, jersey, team, shoes, number, team_name, status, created_at FROM players ORDER BY status = 'new' DESC, id DESC",
			),
			env.DB.prepare(
				`SELECT id, nickname, score, player, shots, made, threes, real_seconds, input, hidden_tab, log, flags, status, checked, device, mode, created_at
				 FROM scores WHERE (${ODD_UNCHECKED}) OR created_at > datetime('now', '-14 days') ORDER BY (${ODD_UNCHECKED}) DESC, id DESC LIMIT 200`,
			),
		]);
		return json(
			{ submissions: submissions.results, ideas: ideas.results, apps: apps.results, players: players.results, scores: scores.results },
			200,
			0,
		);
	}
	if (request.method === "POST" && parts[2] === "submissions") return triage(env, Number(parts[3]), await readJson(request));
	if (request.method === "POST" && parts[2] === "ideas") return editIdea(env, Number(parts[3]), await readJson(request));
	if (request.method === "POST" && parts[2] === "players") return editPlayer(env, Number(parts[3]), await readJson(request));
	if (request.method === "POST" && parts[2] === "scores") return editScore(env, Number(parts[3]), await readJson(request));
	throw new HttpError(404, "Not found.");
}

async function triage(env: Env, id: number, body: Record<string, unknown>): Promise<Response> {
	const sub = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<{ app: string; nickname: string | null }>();
	if (!sub) throw new HttpError(404, "No such submission.");
	if (body.action === "reject") {
		await env.DB.prepare("UPDATE submissions SET status = 'rejected' WHERE id = ?").bind(id).run();
	} else if (body.action === "approve") {
		const title = clean(body.title, 80);
		if (!title) throw new HttpError(400, "Give the idea a title.");
		const app = clean(body.app, 40) || sub.app;
		const credit = body.credit ? sub.nickname : null;
		const created = await env.DB.prepare("INSERT INTO ideas (app, title, description, credit) VALUES (?, ?, ?, ?) RETURNING id")
			.bind(app, title, clean(body.description, MAX_TEXT), credit)
			.first<{ id: number }>();
		await env.DB.prepare("UPDATE submissions SET status = 'approved', idea_id = ? WHERE id = ?").bind(created!.id, id).run();
	} else if (body.action === "merge") {
		const ideaId = Number(body.ideaId);
		const idea = await env.DB.prepare("SELECT id FROM ideas WHERE id = ?").bind(ideaId).first();
		if (!idea) throw new HttpError(400, "Pick an idea to merge into.");
		await env.DB.prepare("UPDATE submissions SET status = 'merged', idea_id = ? WHERE id = ?").bind(ideaId, id).run();
	} else {
		throw new HttpError(400, "Unknown action.");
	}
	return json({ ok: true }, 200, 0);
}

async function editIdea(env: Env, id: number, body: Record<string, unknown>): Promise<Response> {
	const status = String(body.status);
	if (!STATUSES.includes(status)) throw new HttpError(400, "Unknown status.");
	const title = clean(body.title, 80);
	if (!title) throw new HttpError(400, "Give the idea a title.");
	const result = await env.DB.prepare(
		// done_at is when it was released: set the first time it's marked done, cleared if it's moved back.
		`UPDATE ideas SET title = ?1, description = ?2, credit = ?3, status = ?4, updated_at = datetime('now'),
		   done_at = CASE WHEN ?4 = 'done' THEN COALESCE(done_at, datetime('now')) ELSE NULL END
		 WHERE id = ?5`,
	)
		.bind(title, clean(body.description, MAX_TEXT), clean(body.credit, MAX_NICKNAME) || null, status, id)
		.run();
	if (!result.meta.changes) throw new HttpError(404, "No such idea.");
	return json({ ok: true }, 200, 0);
}

async function editPlayer(env: Env, id: number, body: Record<string, unknown>): Promise<Response> {
	if (body.action === "delete") {
		await env.DB.prepare("DELETE FROM players WHERE id = ?").bind(id).run();
		return json({ ok: true }, 200, 0);
	}
	const status = body.action === "approve" ? "approved" : body.action === "hide" ? "hidden" : null;
	const name = clean(body.name, MAX_PLAYER_NAME);
	if (!name) throw new HttpError(400, "Players need a name.");
	const result = await env.DB.prepare(
		"UPDATE players SET name = ?, status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?",
	)
		.bind(name, status, id)
		.run();
	if (!result.meta.changes) throw new HttpError(404, "No such player.");
	return json({ ok: true }, 200, 0);
}

async function editScore(env: Env, id: number, body: Record<string, unknown>): Promise<Response> {
	// "show" keeps it on the board (it looked fine), "hide" takes it off. Either way it's been checked.
	const status = body.action === "show" ? "shown" : body.action === "hide" ? "hidden" : null;
	if (!status) throw new HttpError(400, "Unknown action.");
	const result = await env.DB.prepare("UPDATE scores SET status = ?, checked = 1 WHERE id = ?").bind(status, id).run();
	if (!result.meta.changes) throw new HttpError(404, "No such score.");
	return json({ ok: true }, 200, 0);
}

// Cloudflare Access sits in front of /admin and signs every request it lets through.
// Check that signature too, so the admin API stays locked even if a route is misconfigured.
let accessKeys: { keys: (JsonWebKey & { kid: string })[]; fetched: number } | null = null;

async function requireAdmin(request: Request, env: Env): Promise<string> {
	// "1" only when running locally with `cf dev` (see cloudflare.config.ts). Never honoured once
	// Access is configured, so even a development-mode deploy can't open the admin page.
	if (env.DEV_ADMIN === "1" && !env.ACCESS_AUD) return "dev";
	if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new HttpError(503, "Admin isn't set up yet.");
	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token) throw new HttpError(403, "Sign in through Cloudflare Access.");
	const [head, payload, signature] = token.split(".");
	const header = JSON.parse(b64urlText(head));
	const claims = JSON.parse(b64urlText(payload));

	if (!accessKeys || Date.now() - accessKeys.fetched > 3600_000) {
		const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
		accessKeys = { keys: (await res.json<{ keys: (JsonWebKey & { kid: string })[] }>()).keys, fetched: Date.now() };
	}
	const jwk = accessKeys.keys.find((k) => k.kid === header.kid);
	if (!jwk) throw new HttpError(403, "Unknown sign-in key.");
	const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
	const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(signature), new TextEncoder().encode(`${head}.${payload}`));
	const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (!valid || !audiences.includes(env.ACCESS_AUD) || claims.exp * 1000 < Date.now() || claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) {
		throw new HttpError(403, "Sign-in check failed.");
	}
	return claims.email;
}

// ---------- Helpers ----------

class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

function json(data: unknown, status = 200, maxAge = 0): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
	});
}

// The live site calls the API from the same domain. Allow local previews to call it too.
function cors(request: Request, response: Response): Response {
	const origin = request.headers.get("Origin");
	if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
		response.headers.set("Access-Control-Allow-Origin", origin);
		response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		response.headers.set("Access-Control-Allow-Headers", "Content-Type");
	}
	return response;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
	try {
		const body = await request.json();
		if (body && typeof body === "object") return body as Record<string, unknown>;
	} catch {
		// fall through
	}
	throw new HttpError(400, "Bad request.");
}

function clean(value: unknown, max: number): string {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

async function hash(env: Env, value: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.HASH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
	return [...new Uint8Array(sig)]
		.slice(0, 16)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// IP + today's date, hashed: enough to rate limit, never the address itself.
function ipKey(request: Request, env: Env): Promise<string> {
	const ip = request.headers.get("CF-Connecting-IP") ?? "local";
	return hash(env, `ip:${ip}:${new Date().toISOString().slice(0, 10)}`);
}

function b64urlBytes(s: string): Uint8Array {
	const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlText(s: string): string {
	return new TextDecoder().decode(b64urlBytes(s));
}
