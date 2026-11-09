// The admin page's stats: how much the site and game are used, and which features are catching on.
//
// Worked out from what's already saved (finished games' coins, saves, leaderboard sends, builder
// players, ideas), plus Cloudflare's own page view counts, copied in once a day. Nothing new is
// collected from players, nothing goes to another service, and only totals are shown: never one
// save's history. Only the admin page reads it (behind Access), and the answer is kept for a few
// minutes, so however busy the game gets the cost stays a few queries an admin visit.
//
// A "save" is one saved progress: a device, or several joined with a pairing code. It's the closest
// thing to a player there is (no accounts), so active saves stand in for active players.

import { HttpError } from "./http.ts";
import type { Env } from "./util.ts";

const DAYS = 30; // the window for the charts and adoption
const KEEP_MS = 5 * 60 * 1000; // how long an answer is reused (per Worker)

/** The pages whose views are copied from Cloudflare. */
export const PAGES = ["/", "/games/shootaround/", "/players/", "/ideas/"];

const sinceDay = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

// The last answer, per database (so tests, each with their own, don't share it).
const keptFor = new WeakMap<object, { at: number; body: unknown }>();

/** GET /api/admin/stats */
export async function stats(env: Env): Promise<unknown> {
	const kept = keptFor.get(env.DB);
	if (kept && Date.now() - kept.at < KEEP_MS) return kept.body;
	// Page views are copied each night, and again here, so the first days show straight away and today
	// stays current. A failure only leaves the copy as it was (and says why on the page).
	let pageViewsError: string | null = null;
	try {
		await copyPageViews(env);
	} catch (err) {
		pageViewsError = (err as Error).message;
	}
	const since = sinceDay(DAYS - 1); // 30 days, today included
	const q = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds);
	const [games, saves, sends, players, ideas, votes, views, active, back, weekLater, adoption, balls, inputs, characters, versions] = await env.DB.batch([
		// By day.
		q("SELECT date(created_at) AS day, mode, COUNT(*) AS n FROM progress_games WHERE created_at >= ?1 GROUP BY day, mode", since),
		q("SELECT date(created_at) AS day, COUNT(*) AS n FROM progress WHERE created_at >= ?1 GROUP BY day", since),
		q("SELECT date(created_at) AS day, COUNT(*) AS n FROM scores WHERE created_at >= ?1 GROUP BY day", since),
		q("SELECT date(created_at) AS day, COUNT(*) AS n FROM players WHERE created_at >= ?1 GROUP BY day", since),
		q("SELECT date(created_at) AS day, COUNT(*) AS n FROM submissions WHERE created_at >= ?1 GROUP BY day", since),
		q("SELECT date(created_at) AS day, COUNT(*) AS n FROM votes WHERE created_at >= ?1 GROUP BY day", since),
		q("SELECT day, path, views, visits FROM page_views WHERE day >= ?1", since),
		q(
			`SELECT date(created_at) AS day, COUNT(DISTINCT progress_id) AS n FROM progress_games WHERE created_at >= ?1 GROUP BY day
			 UNION ALL SELECT 'week', COUNT(DISTINCT progress_id) FROM progress_games WHERE created_at >= ?2
			 UNION ALL SELECT 'month', COUNT(DISTINCT progress_id) FROM progress_games WHERE created_at >= ?1`,
			since,
			sinceDay(6),
		),
		// Coming back: saves that played on two or more days of the 30, and saves made 7 to 37 days
		// ago that played again at least a week after their first game.
		q(
			`SELECT COUNT(*) AS n FROM (SELECT progress_id FROM progress_games WHERE created_at >= ?1
			 GROUP BY progress_id HAVING COUNT(DISTINCT date(created_at)) >= 2)`,
			since,
		),
		q(
			`SELECT COUNT(*) AS made, COALESCE(SUM(EXISTS (SELECT 1 FROM progress_games g WHERE g.progress_id = p.id AND g.created_at >= datetime(p.created_at, '+7 days'))), 0) AS back
			 FROM progress p WHERE p.created_at >= datetime('now', '-37 days') AND p.created_at < datetime('now', '-7 days')`,
		),
		// Of the saves that played in the 30 days, how many used each feature.
		q(
			`WITH a AS (SELECT DISTINCT progress_id AS id FROM progress_games WHERE created_at >= ?1)
			 SELECT COUNT(*) AS saves,
			   COALESCE(SUM(EXISTS (SELECT 1 FROM progress_items i WHERE i.progress_id = p.id)), 0) AS shop,
			   COALESCE(SUM(p.ball <> 'classic'), 0) AS ball,
			   COALESCE(SUM((SELECT COUNT(*) FROM progress_devices d WHERE d.progress_id = p.id) > 1), 0) AS paired,
			   COALESCE(SUM(EXISTS (SELECT 1 FROM scores s WHERE s.device = p.board AND s.created_at >= ?1)), 0) AS leaderboard,
			   COALESCE(SUM(COALESCE(json_array_length(p.save, '$.players'), 0) > 0), 0) AS builder,
			   COALESCE(SUM(COALESCE(json_extract(p.save, '$.daily.done'), '') >= ?1), 0) AS daily,
			   COALESCE(SUM(EXISTS (SELECT 1 FROM progress_games g WHERE g.progress_id = p.id AND g.mode = 'horse' AND g.created_at >= ?1)), 0) AS horse
			 FROM a JOIN progress p ON p.id = a.id`,
			since,
		),
		q(
			`SELECT p.ball AS name, COUNT(*) AS n FROM progress p
			 WHERE p.id IN (SELECT progress_id FROM progress_games WHERE created_at >= ?1) GROUP BY p.ball ORDER BY n DESC`,
			since,
		),
		// Leaderboard sends: how they played, who as, and on which version of the game.
		q("SELECT COALESCE(input, 'unknown') AS name, COUNT(*) AS n FROM scores WHERE created_at >= ?1 GROUP BY name ORDER BY n DESC", since),
		q(
			`SELECT CASE WHEN player LIKE 'me%' THEN 'own' ELSE player END AS name, COUNT(*) AS n FROM scores
			 WHERE created_at >= ?1 GROUP BY name ORDER BY n DESC LIMIT 10`,
			since,
		),
		q("SELECT COALESCE(version, 'unknown') AS name, COUNT(*) AS n FROM scores WHERE created_at >= ?1 GROUP BY name ORDER BY n DESC LIMIT 6", sinceDay(6)),
	]);

	const days = Array.from({ length: DAYS }, (_, i) => sinceDay(DAYS - 1 - i));
	const byDay = (rows: unknown[]) => {
		const m = new Map((rows as { day: string; n: number }[]).map((r) => [r.day, r.n]));
		return days.map((d) => m.get(d) ?? 0);
	};
	const modes: Record<string, number[]> = {};
	for (const r of games.results as { day: string; mode: string; n: number }[]) {
		modes[r.mode] ??= days.map(() => 0);
		const i = days.indexOf(r.day);
		if (i >= 0) modes[r.mode][i] = r.n;
	}
	const pages: Record<string, { views: number[]; visits: number[] }> = {};
	for (const r of views.results as { day: string; path: string; views: number; visits: number }[]) {
		pages[r.path] ??= { views: days.map(() => 0), visits: days.map(() => 0) };
		const i = days.indexOf(r.day);
		if (i >= 0) {
			pages[r.path].views[i] = r.views;
			pages[r.path].visits[i] = r.visits;
		}
	}
	const activeRows = active.results as { day: string; n: number }[];
	const total = (key: string) => activeRows.find((r) => r.day === key)?.n ?? 0;
	const today = days[days.length - 1];

	const body = {
		days,
		games: modes, // finished games, by mode
		activeSaves: byDay(activeRows),
		newSaves: byDay(saves.results),
		leaderboardSends: byDay(sends.results),
		builderPlayers: byDay(players.results),
		ideasSent: byDay(ideas.results),
		votes: byDay(votes.results),
		pages,
		pageViewsReady: !!env.CF_ANALYTICS_TOKEN,
		pageViewsError,
		active: { today: total(today), week: total("week"), month: total("month") },
		cameBack: (back.results[0] as { n: number }).n,
		weekLater: weekLater.results[0],
		adoption: adoption.results[0],
		balls: balls.results,
		inputs: inputs.results,
		characters: characters.results,
		versions: versions.results,
	};
	keptFor.set(env.DB, { at: Date.now(), body });
	return body;
}

/**
 * Copies Cloudflare's page views for the site's pages into page_views, day by day, from the last day
 * copied (or as far back as Cloudflare keeps) up to today so far. Run by the daily cron, and when the
 * stats are worked out (at most every few minutes, admin only).
 * Needs CF_ANALYTICS_TOKEN: an API token that can only read this zone's analytics.
 */
export async function copyPageViews(env: Env): Promise<number> {
	if (!env.CF_ANALYTICS_TOKEN || !env.CF_ZONE_ID) return 0;
	const last = (await env.DB.prepare("SELECT MAX(day) AS day FROM page_views").first<{ day: string | null }>())?.day;
	// Re-copy the last day already copied too: it may have been part-way through.
	const from = last && last > sinceDay(29) ? last : sinceDay(29);
	const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
		method: "POST",
		headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			query: `query ($zone: String!, $from: Date!, $paths: [String!]) { viewer { zones(filter: { zoneTag: $zone }) {
				httpRequestsAdaptiveGroups(limit: 1000, filter: { date_geq: $from, requestSource: "eyeball", edgeResponseStatus: 200,
					edgeResponseContentTypeName: "html", clientRequestPath_in: $paths }) {
					count sum { visits } dimensions { date clientRequestPath }
				} } } }`,
			variables: { zone: env.CF_ZONE_ID, from, paths: PAGES },
		}),
	});
	const out = (await res.json()) as {
		data?: { viewer: { zones: { httpRequestsAdaptiveGroups: { count: number; sum: { visits: number }; dimensions: { date: string; clientRequestPath: string } }[] }[] } };
		errors?: { message: string }[] | null;
	};
	if (!res.ok || out.errors?.length || !out.data) throw new HttpError(502, `Page views: ${out.errors?.[0]?.message ?? res.status}`);
	const rows = out.data.viewer.zones[0]?.httpRequestsAdaptiveGroups ?? [];
	if (!rows.length) return 0;
	await env.DB.batch(
		rows.map((r) =>
			env.DB.prepare(
				"INSERT INTO page_views (day, path, views, visits) VALUES (?, ?, ?, ?) ON CONFLICT (day, path) DO UPDATE SET views = excluded.views, visits = excluded.visits",
			).bind(r.dimensions.date, r.dimensions.clientRequestPath, r.count, r.sum.visits),
		),
	);
	keptFor.delete(env.DB);
	return rows.length;
}
