// The private admin page and its API: the inbox, triaging ideas people sent, and editing ideas,
// players and scores. Cloudflare Access guards it, and requireAdmin checks Access's signature too.

import adminPage from "./admin.html?raw";
import { modeOf } from "../../shared/rules.js";
import type { Mode } from "../../shared/rules.js";
import { verifyAccessToken } from "./access.ts";
import { forget } from "./cache.ts";
import { HttpError } from "./http.ts";
import { MAX_CREDIT, MAX_TEXT, STATUSES, mergeCredit, recount } from "./ideas.ts";
import { MAX_PLAYER_NAME, MAX_TEAM_NAME, parsePronoun, PLAYER_PARTS } from "./players.ts";
import { stats } from "./stats.ts";
import { blockReportedName, clearReports, ODD_UNCHECKED, REPORTED, renameScores } from "./scores.ts";
import { clean, forgetBlockedNames, isLocalHost, json, readJson, requireSameOriginJson } from "./util.ts";
import type { Env } from "./util.ts";

// The page's own inline <script> and <style> blocks, by hash, so nothing else inline can run.
let inlineHashes: Promise<{ scripts: string[]; styles: string[] }> | null = null;
const sha256 = async (text: string) =>
	`'sha256-${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))))}'`;
const blocks = (tag: string) =>
	[...adminPage.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].filter((m) => !/\ssrc=/.test(m[1] ?? "")).map((m) => m[2]);

/**
 * What the admin page may load: its own inline script and styles, the pixel font, player pictures and
 * the recolouring code from the main site (another port when testing locally), and the admin API. Images include data: and blob: (faces are drawn on a canvas).
 */
export async function adminCsp(site: string): Promise<string> {
	inlineHashes ??= Promise.all([Promise.all(blocks("script").map(sha256)), Promise.all(blocks("style").map(sha256))]).then(([scripts, styles]) => ({
		scripts,
		styles,
	}));
	const { scripts, styles } = await inlineHashes;
	const own = site ? `'self' ${site}` : "'self'";
	return [
		"default-src 'none'",
		`script-src ${own} ${scripts.join(" ")}`,
		`style-src ${styles.join(" ")}`,
		`font-src ${own}`,
		`img-src ${own} data: blob:`,
		`connect-src ${own}`,
		"base-uri 'none'",
		"form-action 'none'",
		// Never shown inside another site's frame, so buttons can't be click-jacked.
		"frame-ancestors 'none'",
	].join("; ");
}

export async function adminHtml(request: Request, env: Env): Promise<Response> {
	await requireAdmin(request, env);
	// The page loads pictures and code from the main site: the local one on port 5173 when testing.
	const site = new URL(request.url).hostname === "localhost" ? "http://localhost:5173" : new URL(env.SITE_URL).origin;
	return new Response(adminPage, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Robots-Tag": "noindex",
			"Content-Security-Policy": await adminCsp(site),
			"X-Frame-Options": "DENY",
			"Referrer-Policy": "no-referrer",
		},
	});
}

export async function admin(request: Request, env: Env, url: URL): Promise<Response> {
	await requireAdmin(request, env);
	// Changes only come from the admin page itself, never a form or script on another site.
	if (request.method !== "GET") requireSameOriginJson(request, env);
	const parts = url.pathname.split("/").filter(Boolean); // api, admin, ...
	if (request.method === "GET" && parts[2] === "stats") return json(await stats(env), 200, 0);
	if (request.method === "GET" && parts[2] === "inbox") {
		const [submissions, ideas, apps, players, scores, blocked] = await env.DB.batch([
			env.DB.prepare("SELECT id, app, text, nickname, created_at, title, description, note, merge_into FROM submissions WHERE status = 'new' ORDER BY id"),
			env.DB.prepare("SELECT id, app, title, description, credit, status, votes FROM ideas ORDER BY app, votes DESC"),
			env.DB.prepare("SELECT slug, name FROM apps ORDER BY name"),
			env.DB.prepare(
				"SELECT id, name, base, skin, hair, jersey, team, shoes, number, team_name, pronoun, status, created_at FROM players ORDER BY status = 'new' DESC, id DESC",
			),
			env.DB.prepare(
				// Reported ones (with how many open reports) and odd ones not yet looked at first, then the last two weeks.
				`SELECT id, nickname, score, player, shots, made, threes, real_seconds, input, hidden_tab, log, flags, status, checked, device, mode, created_at,
				   (SELECT COUNT(*) FROM reports r WHERE r.score_id = scores.id AND r.cleared = 0 AND scores.status = 'shown') AS reports
				 FROM scores WHERE id IN (${REPORTED}) OR (${ODD_UNCHECKED}) OR created_at > datetime('now', '-14 days')
				 ORDER BY id IN (${REPORTED}) DESC, (${ODD_UNCHECKED}) DESC, id DESC LIMIT 200`,
			),
			env.DB.prepare("SELECT squashed, name, created_at FROM blocked_names ORDER BY created_at DESC"),
		]);
		return json(
			{ submissions: submissions.results, ideas: ideas.results, apps: apps.results, players: players.results, scores: scores.results, blocked: blocked.results },
			200,
			0,
		);
	}
	const id = Number(parts[3]);
	if (request.method !== "POST") throw new HttpError(404, "Not found.");
	// Each change also clears what it changes from the public edge cache (cache.ts).
	let res: Response;
	if (parts[2] === "submissions") {
		res = await triage(env, id, await readJson(request));
		await forget(url.origin, { ideas: true });
	} else if (parts[2] === "ideas") {
		res = await editIdea(env, id, await readJson(request));
		await forget(url.origin, { ideas: true });
	} else if (parts[2] === "players") {
		res = await editPlayer(env, id, await readJson(request));
		await forget(url.origin, { players: true });
	} else if (parts[2] === "scores") {
		const body = await readJson(request);
		if (body.action === "rename") {
			const { modes, ids } = await renameScores(env, id, body.nickname);
			await clearReports(env, id); // a new name: reports about the old one are dealt with
			await forget(url.origin, { boards: modes, scores: ids });
		} else if (body.action === "name-ok") {
			// A reported name that looks fine: its reports leave the inbox. Nothing public changes.
			await clearReports(env, id);
		} else {
			const mode = await editScore(env, id, body);
			await forget(url.origin, { boards: [mode], score: id });
		}
		res = json({ ok: true }, 200, 0);
	} else if (parts[2] === "blocked") {
		// Takes a name off the blocked list (one hidden by mistake): people can use it again.
		const body = await readJson(request);
		if (body.action !== "remove" || typeof body.squashed !== "string") throw new HttpError(400, "Unknown action.");
		await env.DB.prepare("DELETE FROM blocked_names WHERE squashed = ?").bind(body.squashed).run();
		forgetBlockedNames();
		res = json({ ok: true }, 200, 0);
	} else throw new HttpError(404, "Not found.");
	return res;
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
		// Any name the admin typed (empty for none). An older page sends true to credit their nickname.
		const credit = typeof body.credit === "string" ? clean(body.credit, MAX_CREDIT) || null : body.credit ? sub.nickname : null;
		const created = await env.DB.prepare("INSERT INTO ideas (app, title, description, credit) VALUES (?, ?, ?, ?) RETURNING id")
			.bind(app, title, clean(body.description, MAX_TEXT), credit)
			.first<{ id: number }>();
		await env.DB.prepare("UPDATE submissions SET status = 'approved', idea_id = ? WHERE id = ?").bind(created!.id, id).run();
	} else if (body.action === "merge") {
		// Adding it to an existing idea can also: update that idea's title and description, count as
		// an upvote (once per submission, so merging twice can't vote twice), and credit the sender.
		const ideaId = Number(body.ideaId);
		const idea = await env.DB.prepare("SELECT id, title, description, credit FROM ideas WHERE id = ?")
			.bind(ideaId)
			.first<{ id: number; title: string; description: string; credit: string | null }>();
		if (!idea) throw new HttpError(400, "Pick an idea to merge into.");
		const title = body.title === undefined ? idea.title : clean(body.title, 80);
		if (!title) throw new HttpError(400, "Give the idea a title.");
		const description = body.description === undefined ? idea.description : clean(body.description, MAX_TEXT);
		const credit = body.credit ? mergeCredit(idea.credit, sub.nickname) : idea.credit;
		const steps = [
			env.DB.prepare("UPDATE ideas SET title = ?, description = ?, credit = ?, updated_at = datetime('now') WHERE id = ?").bind(title, description, credit, ideaId),
			env.DB.prepare("UPDATE submissions SET status = 'merged', idea_id = ? WHERE id = ?").bind(ideaId, id),
		];
		if (body.upvote)
			steps.push(
				env.DB.prepare("INSERT OR IGNORE INTO votes (idea_id, voter, ip_hash) VALUES (?, ?, 'admin')").bind(ideaId, `submission:${id}`),
				recount(env, ideaId),
			);
		await env.DB.batch(steps);
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
	// It can move to another game or app (say from the website to new games). Left out, it stays put.
	const app = body.app === undefined ? null : clean(body.app, 40);
	if (app !== null && !(await env.DB.prepare("SELECT 1 FROM apps WHERE slug = ?").bind(app).first())) throw new HttpError(400, "Unknown game or app.");
	const result = await env.DB.prepare(
		// done_at is when it was released: set the first time it's marked done, cleared if it's moved back.
		`UPDATE ideas SET title = ?1, description = ?2, credit = ?3, status = ?4, app = COALESCE(?6, app), updated_at = datetime('now'),
		   done_at = CASE WHEN ?4 = 'done' THEN COALESCE(done_at, datetime('now')) ELSE NULL END
		 WHERE id = ?5`,
	)
		.bind(title, clean(body.description, MAX_TEXT), clean(body.credit, MAX_CREDIT) || null, status, id, app)
		.run();
	if (!result.meta.changes) throw new HttpError(404, "No such idea.");
	return json({ ok: true }, 200, 0);
}

async function editPlayer(env: Env, id: number, body: Record<string, unknown>): Promise<Response> {
	if (body.action === "delete") {
		await env.DB.prepare("DELETE FROM players WHERE id = ?").bind(id).run();
		return json({ ok: true }, 200, 0);
	}
	const status =
		body.action === "approve" ? "approved" : body.action === "hide" ? "hidden" : body.action === "unapprove" ? "new" : null;
	const name = clean(body.name, MAX_PLAYER_NAME);
	if (!name) throw new HttpError(400, "Players need a name.");
	// Anything else about them can be changed too; whatever isn't sent stays as it is.
	const base = body.base === undefined ? null : clean(body.base, 30);
	if (base !== null && !/^[a-z0-9-]+$/.test(base)) throw new HttpError(400, "Pick a body.");
	const sent = body.colours && typeof body.colours === "object" ? (body.colours as Record<string, unknown>) : null;
	if (sent && !PLAYER_PARTS.every((p) => /^#[0-9a-f]{6}$/i.test(String(sent[p])))) throw new HttpError(400, "Pick all the colours.");
	const colours = sent ? PLAYER_PARTS.map((p) => String(sent[p]).toLowerCase()) : [null, null, null, null, null];
	const setNumber = body.number !== undefined;
	const number = body.number === null || body.number === "" ? null : String(body.number ?? "");
	if (setNumber && number !== null && !/^\d{1,2}$/.test(number)) throw new HttpError(400, "Numbers go from 0 to 99.");
	const teamName = body.teamName === undefined ? null : clean(body.teamName, MAX_TEAM_NAME).toUpperCase() || "KINGS";
	if (teamName !== null && !/^[A-Z0-9 ]+$/.test(teamName)) throw new HttpError(400, "Team names use letters and numbers.");
	// "he", "she", or anything else (like "") for not set.
	const setPronoun = body.pronoun !== undefined;
	const result = await env.DB.prepare(
		`UPDATE players SET name = ?, status = COALESCE(?, status), base = COALESCE(?, base),
		   skin = COALESCE(?, skin), hair = COALESCE(?, hair), jersey = COALESCE(?, jersey), team = COALESCE(?, team), shoes = COALESCE(?, shoes),
		   number = CASE WHEN ? THEN ? ELSE number END, team_name = COALESCE(?, team_name),
		   pronoun = CASE WHEN ? THEN ? ELSE pronoun END, updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(name, status, base, ...colours, setNumber ? 1 : 0, number, teamName, setPronoun ? 1 : 0, parsePronoun(body.pronoun), id)
		.run();
	if (!result.meta.changes) throw new HttpError(404, "No such player.");
	return json({ ok: true }, 200, 0);
}

async function editScore(env: Env, id: number, body: Record<string, unknown>): Promise<Mode> {
	// "show" keeps it on the board (it looked fine), "hide" takes it off. Either way it's been checked.
	const status = body.action === "show" ? "shown" : body.action === "hide" ? "hidden" : null;
	if (!status) throw new HttpError(400, "Unknown action.");
	const row = await env.DB.prepare("UPDATE scores SET status = ?, checked = 1 WHERE id = ? RETURNING mode").bind(status, id).first<{ mode: string }>();
	if (!row) throw new HttpError(404, "No such score.");
	// Hidden: a reported name is blocked from then on, and reports on this game are dealt with (if their
	// next best game is reported too, it shows up on its own).
	if (status === "hidden") await blockReportedName(env, id);
	if (status === "hidden") await env.DB.prepare("UPDATE reports SET cleared = 1 WHERE score_id = ?").bind(id).run();
	return modeOf(row.mode);
}

// Cloudflare Access sits in front of /admin and signs every request it lets through. Check that
// signature too (access.ts), so the admin API stays locked even if a route is misconfigured.
async function requireAdmin(request: Request, env: Env): Promise<string> {
	// "1" only when running locally with `cf dev` (see cloudflare.config.ts). Never honoured once
	// Access is configured, so even a development-mode deploy can't open the admin page, and only
	// for this machine: a local Worker started with --host doesn't open it to the whole network.
	if (env.DEV_ADMIN === "1" && !env.ACCESS_AUD && isLocalHost(request)) return "dev";
	if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new HttpError(503, "Admin isn't set up yet.");
	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token) throw new HttpError(403, "Sign in through Cloudflare Access.");
	return verifyAccessToken(token, env);
}
