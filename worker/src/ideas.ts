// The ideas board: the list of ideas, votes, and ideas people send in (which wait in the admin inbox).

import { HttpError } from "./http.ts";
import { checkTurnstile, clean, hash, ipKey, isRude, json, readJson, RUDE } from "./util.ts";
import type { Env } from "./util.ts";

export const STATUSES = ["idea", "planned", "building", "done", "hidden"];
export const MAX_TEXT = 500;
const MAX_NICKNAME = 20;
export const MAX_CREDIT = 60; // an idea can credit several people, like "Moni, Jude"
const SUBMISSIONS_PER_HOUR = 5;
const VOTES_PER_DAY = 60;

export async function config(env: Env): Promise<Response> {
	const apps = await env.DB.prepare("SELECT slug, name FROM apps ORDER BY name").all();
	return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY, apps: apps.results }, 200, 300);
}

export async function listIdeas(env: Env, url: URL): Promise<Response> {
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

export async function submit(request: Request, env: Env): Promise<Response> {
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

export async function vote(request: Request, env: Env): Promise<Response> {
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

/**
 * An idea's credit once a merged submission's sender joins it ("Moni, Jude"): unchanged if they're
 * already there (any case), if there's no nickname, or if it wouldn't fit in MAX_CREDIT.
 */
export function mergeCredit(credit: string | null, nickname: string | null | undefined): string | null {
	const names = (credit ?? "").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
	const name = nickname?.trim();
	if (!name || names.includes(name.toLowerCase())) return credit;
	const joined = credit ? `${credit}, ${name}` : name;
	return joined.length <= MAX_CREDIT ? joined : credit;
}

/** Sets an idea's vote count from its votes. */
export function recount(env: Env, ideaId: number) {
	return env.DB.prepare("UPDATE ideas SET votes = (SELECT COUNT(*) FROM votes WHERE idea_id = ?1) WHERE id = ?1").bind(ideaId);
}
