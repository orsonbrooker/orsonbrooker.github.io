// Weekly nudge (the cron): a phone notification when there are ideas waiting to be checked.

import { ODD_UNCHECKED } from "./scores.ts";
import type { Env } from "./util.ts";

export async function notify(env: Env): Promise<void> {
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
}
