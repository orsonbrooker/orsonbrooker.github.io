// Ideas board API for orsonbrooker.com.
//
// Public:  GET  /api/config         Turnstile site key and the list of games/apps
//          GET  /api/ideas          approved ideas (?app= to filter, &device= to mark own votes)
//          POST /api/submit         a visitor's idea; goes to the admin inbox, never straight to the board
//          POST /api/vote           upvote or un-upvote an idea
//          GET  /api/check?text=    is this text OK? (live checks while typing)
//          GET  /api/players        approved players made with the builder
//          POST /api/players        a new player; waits for approval before it's in the game
// Admin:   GET  /admin              triage page (behind Cloudflare Access)
//          GET  /api/admin/inbox    new submissions, all ideas and apps
//          POST /api/admin/submissions/:id   approve as a new idea, merge into an idea, or reject
//          POST /api/admin/ideas/:id         edit an idea or change its status
//          POST /api/admin/players/:id       approve, hide, rename or delete a player

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
		const ideas = row?.n ?? 0;
		const newPlayers = players?.n ?? 0;
		if (!ideas && !newPlayers) return;
		const waiting = [ideas && `${ideas} new idea${ideas === 1 ? "" : "s"}`, newPlayers && `${newPlayers} new player${newPlayers === 1 ? "" : "s"}`]
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
	}
	throw new HttpError(404, "Not found.");
}

async function listIdeas(env: Env, url: URL): Promise<Response> {
	const app = url.searchParams.get("app");
	const device = url.searchParams.get("device");
	const query = app
		? env.DB.prepare(
				"SELECT id, app, title, description, credit, status, votes FROM ideas WHERE status != 'hidden' AND app = ? ORDER BY votes DESC, id DESC",
			).bind(app)
		: env.DB.prepare(
				"SELECT id, app, title, description, credit, status, votes FROM ideas WHERE status != 'hidden' ORDER BY votes DESC, id DESC",
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
		const [submissions, ideas, apps, players] = await env.DB.batch([
			env.DB.prepare("SELECT id, app, text, nickname, created_at FROM submissions WHERE status = 'new' ORDER BY id"),
			env.DB.prepare("SELECT id, app, title, description, credit, status, votes FROM ideas ORDER BY app, votes DESC"),
			env.DB.prepare("SELECT slug, name FROM apps ORDER BY name"),
			env.DB.prepare(
				"SELECT id, name, base, skin, hair, jersey, team, shoes, number, team_name, status, created_at FROM players ORDER BY status = 'new' DESC, id DESC",
			),
		]);
		return json({ submissions: submissions.results, ideas: ideas.results, apps: apps.results, players: players.results }, 200, 0);
	}
	if (request.method === "POST" && parts[2] === "submissions") return triage(env, Number(parts[3]), await readJson(request));
	if (request.method === "POST" && parts[2] === "ideas") return editIdea(env, Number(parts[3]), await readJson(request));
	if (request.method === "POST" && parts[2] === "players") return editPlayer(env, Number(parts[3]), await readJson(request));
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
		"UPDATE ideas SET title = ?, description = ?, credit = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
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
