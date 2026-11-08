// Weekly nudge (the cron): a phone notification when there are ideas, players, odd scores or reported
// names waiting to be checked.

import { ODD_UNCHECKED, REPORTED } from "./scores.ts";
import type { Env } from "./util.ts";

export async function notify(env: Env): Promise<void> {
	if (!env.NTFY_TOPIC) return;
	const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'new'").first<{ n: number }>();
	const players = await env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE status = 'new'").first<{ n: number }>();
	const votes = await env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE created_at > datetime('now', '-7 days')").first<{ n: number }>();
	const odd = await env.DB.prepare(`SELECT COUNT(*) AS n FROM scores WHERE ${ODD_UNCHECKED}`).first<{ n: number }>();
	const reported = await env.DB.prepare(`SELECT COUNT(DISTINCT score_id) AS n FROM (${REPORTED})`).first<{ n: number }>();
	const message = notifyMessage({ ideas: row?.n ?? 0, players: players?.n ?? 0, oddScores: odd?.n ?? 0, reported: reported?.n ?? 0, votes: votes?.n ?? 0 });
	if (!message) return;
	await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
		method: "POST",
		headers: { Title: "Things to check", Click: `${env.SITE_URL}/admin`, Tags: "basketball" },
		body: message,
	});
}

/** The notification's text, or null when nothing is waiting (votes alone don't need a look). */
export function notifyMessage(counts: { ideas: number; players: number; oddScores: number; reported?: number; votes: number }): string | null {
	const { ideas, players, oddScores, reported = 0, votes } = counts;
	if (!ideas && !players && !oddScores && !reported) return null;
	const waiting = [
		ideas && `${ideas} new idea${ideas === 1 ? "" : "s"}`,
		players && `${players} new player${players === 1 ? "" : "s"}`,
		oddScores && `${oddScores} odd-looking score${oddScores === 1 ? "" : "s"}`,
		reported && `${reported} reported name${reported === 1 ? "" : "s"}`,
	]
		.filter(Boolean)
		.join(" and ");
	return `${waiting} waiting, and ${votes} votes this week.`;
}
