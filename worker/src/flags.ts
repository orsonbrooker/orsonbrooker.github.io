// Feature flags: which unreleased things are switched on (the list is shared/flags.js; the `flags`
// table holds the ones Luke switched on or off on the admin page, and a flag with no row is off).
// GET /api/flags is public and edge-cached (cache.ts), so a page load never costs a database read;
// the Worker's own checks (a score for a hidden mode, a player with a hidden body) read it here,
// kept for a few seconds in this isolate.

import { FLAGS, FLAG_KEYS, flagForBody, flagForMode } from "../../shared/flags.js";
import { HttpError } from "./http.ts";
import { json } from "./util.ts";
import type { Env } from "./util.ts";

export type Flags = Record<string, boolean>;

const KEEP_FOR = 10_000; // ms: how long this isolate trusts what it read
let kept: { flags: Flags; at: number } | null = null;
/** Forgets what this isolate read (after a change, and for tests). */
export const forgetFlags = () => void (kept = null);

/** Every known flag, on or off. */
export async function readFlags(env: Env, now = Date.now()): Promise<Flags> {
	if (kept && now - kept.at < KEEP_FOR) return kept.flags;
	const rows = await env.DB.prepare("SELECT key, enabled FROM flags").all<{ key: string; enabled: number }>();
	const on = new Set(rows.results.filter((r) => r.enabled === 1).map((r) => r.key));
	const flags = Object.fromEntries(FLAG_KEYS.map((k) => [k, on.has(k)]));
	kept = { flags, at: now };
	return flags;
}

/** GET /api/flags: { flags: { key: true/false } } for every known flag. */
export async function publicFlags(env: Env): Promise<Response> {
	return json({ flags: await readFlags(env) }, 200, 30);
}

const NOT_OUT = "That isn't out yet.";

/** Throws unless flag `key` is on. */
export async function requireFlag(env: Env, key: string): Promise<void> {
	if (!(await readFlags(env))[key]) throw new HttpError(400, NOT_OUT);
}

/** Throws unless `mode` is out (its flag, if it has one, is on). */
export async function requireModeOut(env: Env, mode: string): Promise<void> {
	const key = flagForMode(mode);
	if (key) await requireFlag(env, key);
}

/** Throws unless the builder body `base` is out (its flag, if it has one, is on). */
export async function requireBodyOut(env: Env, base: string): Promise<void> {
	const key = flagForBody(base);
	if (key) await requireFlag(env, key);
}

/** The ideas whose flag is still off (linked on the admin page): the board says "Coming soon" on them. */
export async function comingSoon(env: Env): Promise<Set<number>> {
	const rows = await env.DB.prepare("SELECT key, idea_id FROM flags WHERE idea_id IS NOT NULL AND enabled = 0").all<{ key: string; idea_id: number }>();
	return new Set(rows.results.filter((r) => FLAG_KEYS.includes(r.key)).map((r) => r.idea_id));
}

/** GET /api/admin/flags: each flag with what it hides, whether it's on, its idea, and when it last changed. */
export async function adminFlags(env: Env): Promise<Response> {
	const rows = await env.DB.prepare("SELECT key, enabled, idea_id, updated_at FROM flags").all<{ key: string; enabled: number; idea_id: number | null; updated_at: string }>();
	const byKey = new Map(rows.results.map((r) => [r.key, r]));
	return json(
		{
			flags: FLAGS.map((f) => ({
				key: f.key,
				name: f.name,
				hides: f.hides,
				on: byKey.get(f.key)?.enabled === 1,
				idea_id: byKey.get(f.key)?.idea_id ?? null,
				updated_at: byKey.get(f.key)?.updated_at ?? null,
			})),
		},
		200,
		0,
	);
}

/**
 * POST /api/admin/flags { key, on?, ideaId? }: switches a flag on or off, and/or links it to the idea it
 * delivers (ideaId null unlinks it). Switching a linked flag on marks its idea done (once: an idea
 * already done keeps its date), so it moves to Done on the board as the feature comes out.
 */
export async function setFlag(env: Env, body: Record<string, unknown>): Promise<Response> {
	const key = String(body.key ?? "");
	if (!FLAG_KEYS.includes(key)) throw new HttpError(400, "Unknown flag.");
	const setOn = body.on !== undefined;
	const setIdea = body.ideaId !== undefined;
	if (setOn && typeof body.on !== "boolean") throw new HttpError(400, "Say on or off.");
	if (!setOn && !setIdea) throw new HttpError(400, "Say on or off.");
	const ideaId = body.ideaId === null ? null : Number(body.ideaId);
	if (setIdea && ideaId !== null) {
		if (!Number.isInteger(ideaId) || !(await env.DB.prepare("SELECT 1 FROM ideas WHERE id = ?").bind(ideaId).first())) throw new HttpError(400, "No such idea.");
	}
	const steps = [
		env.DB.prepare(
			`INSERT INTO flags (key, enabled, idea_id, updated_at) VALUES (?1, COALESCE(?2, 0), ?3, datetime('now'))
			 ON CONFLICT (key) DO UPDATE SET enabled = COALESCE(?2, enabled), idea_id = CASE WHEN ?4 THEN ?3 ELSE idea_id END, updated_at = datetime('now')`,
		).bind(key, setOn ? (body.on ? 1 : 0) : null, setIdea ? ideaId : null, setIdea ? 1 : 0),
	];
	if (body.on === true)
		steps.push(
			env.DB.prepare(
				`UPDATE ideas SET status = CASE WHEN status = 'hidden' THEN status ELSE 'done' END, done_at = COALESCE(done_at, datetime('now')), updated_at = datetime('now')
				 WHERE id = (SELECT idea_id FROM flags WHERE key = ?) AND (status != 'done' OR done_at IS NULL)`,
			).bind(key),
		);
	await env.DB.batch(steps);
	forgetFlags();
	return json({ ok: true }, 200, 0);
}
