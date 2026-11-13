// The weekly digest (the Monday cron, next to notify.ts): one list, at the top of the admin inbox, of
// the odd-looking games and reported names still waiting for a look, and how many of each are new
// this week. It only makes a list; nothing on the board changes. Stays in the database (digests table),
// so no email or other service is involved.

import { ODD_UNCHECKED, REPORTED } from "./scores.ts";
import type { Env } from "./util.ts";

const MAX_ITEMS = 50; // per list; the Scores tab has the rest

export type DigestOdd = { id: number; nickname: string; mode: string; score: number; flags: string[]; day: string };
export type DigestName = { id: number; nickname: string; mode: string; reports: number; day: string };
export type Digest = { odd: DigestOdd[]; names: DigestName[]; newOdd: number; newNames: number };

/** What's waiting right now. Dates only (day), never times. */
export async function collectDigest(env: Env): Promise<Digest> {
	const [odd, names, newOdd, newNames] = await env.DB.batch([
		env.DB.prepare(
			`SELECT id, nickname, mode, score, flags, date(created_at) AS day FROM scores WHERE ${ODD_UNCHECKED} ORDER BY id DESC LIMIT ${MAX_ITEMS}`,
		),
		env.DB.prepare(
			`SELECT s.id, s.nickname, s.mode, COUNT(*) AS reports, date(MIN(r.created_at)) AS day
			 FROM reports r JOIN scores s ON s.id = r.score_id WHERE r.cleared = 0 AND s.status = 'shown'
			 GROUP BY s.id ORDER BY reports DESC, s.id DESC LIMIT ${MAX_ITEMS}`,
		),
		env.DB.prepare(`SELECT COUNT(*) AS n FROM scores WHERE ${ODD_UNCHECKED} AND created_at > datetime('now', '-7 days')`),
		env.DB.prepare(
			`SELECT COUNT(DISTINCT r.score_id) AS n FROM reports r WHERE r.score_id IN (${REPORTED}) AND r.cleared = 0 AND r.created_at > datetime('now', '-7 days')`,
		),
	]);
	return {
		odd: (odd.results as (Omit<DigestOdd, "flags"> & { flags: string })[]).map((s) => ({ ...s, flags: JSON.parse(s.flags) as string[] })),
		names: names.results as DigestName[],
		newOdd: (newOdd.results[0] as { n: number } | undefined)?.n ?? 0,
		newNames: (newNames.results[0] as { n: number } | undefined)?.n ?? 0,
	};
}

/** The cron: saves this week's digest (once per day, a re-run replaces it) when anything is waiting. */
export async function weeklyDigest(env: Env): Promise<Digest | null> {
	const digest = await collectDigest(env);
	if (!digest.odd.length && !digest.names.length) return null;
	await env.DB.batch([
		// Last week's, if it was never looked at, is out of date now.
		env.DB.prepare("UPDATE digests SET seen_at = datetime('now') WHERE seen_at IS NULL AND week < date('now')"),
		env.DB.prepare(
			"INSERT INTO digests (week, items) VALUES (date('now'), ?) ON CONFLICT (week) DO UPDATE SET items = excluded.items, created_at = datetime('now'), seen_at = NULL",
		).bind(JSON.stringify(digest)),
	]);
	return digest;
}

/** The digest the admin inbox shows: the newest one not marked seen, or null. */
export async function openDigest(env: Env): Promise<(Digest & { id: number; week: string }) | null> {
	const row = await env.DB.prepare("SELECT id, week, items FROM digests WHERE seen_at IS NULL ORDER BY week DESC LIMIT 1").first<{
		id: number;
		week: string;
		items: string;
	}>();
	return row ? { id: row.id, week: row.week, ...(JSON.parse(row.items) as Digest) } : null;
}

/** "Got it": it leaves the inbox. */
export async function seeDigest(env: Env, id: number): Promise<boolean> {
	const result = await env.DB.prepare("UPDATE digests SET seen_at = datetime('now') WHERE id = ? AND seen_at IS NULL").bind(id).run();
	return result.meta.changes > 0;
}
