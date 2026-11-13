// The API for orsonbrooker.com: this file is the entry point and router; each area has its own file.
//
// Public:  GET  /api/config         Turnstile site key and the list of games/apps          ideas.ts
//          GET  /api/ideas          approved ideas (?app= to filter; an X-Device header marks own votes)
//          POST /api/submit         a visitor's idea; goes to the admin inbox, never straight to the board
//          POST /api/vote           upvote or un-upvote an idea
//          GET  /api/check?text=    is this text OK? (live checks while typing)              util.ts
//          GET  /api/flags          which unreleased features are switched on                flags.ts
//          GET  /api/players        approved players made with the builder                  players.ts
//          POST /api/players        a new player; waits for approval before it's in the game
//          POST /api/games          a signed start token for a new game of Shootaround     scores.ts
//          GET  /api/scores         the leaderboard (?range=week or all, ?mode=timed, survival or around)
//          GET  /api/scores/:id     one game's card
//          POST /api/scores         a finished game's score, with its shot log (checked, see postScore)
//          POST /api/scores/preview where a game would land, as it ends (nothing saved)
//          POST /api/reports        report a leaderboard row's name as unfriendly (to the admin inbox)
//          POST /api/progress       a device's coins and ball styles (its key in the body)    progress.ts
//          POST /api/progress/games a finished game earns its coins (checked like a score)
//          POST /api/progress/buy   spend coins on a ball style
//          POST /api/progress/ball  use a ball style they own
//          POST /api/progress/pair  a code to carry progress to another device (10 minutes)
//          POST /api/progress/join  type that code on the other device
// Admin:   GET  /admin              triage page (behind Cloudflare Access)                 admin.ts
//          GET  /admin/ideas, /admin/players, /admin/scores, /admin/words, /admin/stats   the same page, open on that section
//          GET  /api/admin/inbox    new submissions, all ideas and apps
//          GET  /api/admin/stats    usage and feature adoption, last 30 days               stats.ts
//          GET  /api/admin/flags    every feature flag, what it hides and whether it's on    flags.ts
//          POST /api/admin/flags    switch a flag on or off
//          POST /api/admin/submissions/:id   approve as a new idea, merge into an idea, reject, or keep as kind words
//          POST /api/admin/ideas/:id         edit an idea or change its status
//          POST /api/admin/players/:id       approve, hide, rename or delete a player
//          POST /api/admin/scores/:id        show or hide a leaderboard score, rename its player, or clear its reports
//                                            (hiding a reported one blocks its name)
//          POST /api/admin/blocked/remove    let a blocked name be used again
// Cron:    weekly phone notification of things to check                                  notify.ts

import { admin, adminHtml } from "./admin.ts";
import { copyPageViews } from "./stats.ts";
import { cacheKey, cached } from "./cache.ts";
import { HttpError } from "./http.ts";
import { publicFlags } from "./flags.ts";
import { config, deviceOf, listIdeas, submit, vote } from "./ideas.ts";
import { notify } from "./notify.ts";
import { createPlayer, listPlayers } from "./players.ts";
import { buy, claimGame, getProgress, joinCode, pairCode, useBall } from "./progress.ts";
import { gameToken, leaderboard, postScore, previewScore, reportScore, scoreDetail } from "./scores.ts";
import { cors, isAdminPage, isUnfriendly, json } from "./util.ts";
import type { Env } from "./util.ts";

const DAILY = "30 0 * * *"; // the daily cron in cloudflare.config.ts (the other is the weekly notification)

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		try {
			if (isAdminPage(url.pathname)) return await adminHtml(request, env);
			if (url.pathname.startsWith("/api/admin/")) return await admin(request, env, url);
			if (request.method === "OPTIONS") return cors(request, new Response(null, { status: 204 }));
			// The same for everyone: kept in the edge cache for a short while (cache.ts).
			const shared = request.method === "GET" ? cacheKey(request, url) : null;
			if (shared) return cors(request, await cached(shared, ctx, () => publicApi(request, env, url)));
			return cors(request, await publicApi(request, env, url));
		} catch (err) {
			if (err instanceof HttpError) return cors(request, json({ error: err.message }, err.status));
			console.error(err);
			return cors(request, json({ error: "Something went wrong." }, 500));
		}
	},

	async scheduled(controller, env): Promise<void> {
		// Daily rate-limit counts are only needed on the day.
		await env.DB.prepare("DELETE FROM rate_limits WHERE day < date('now', '-1 day')").run();
		await env.DB.prepare("DELETE FROM pair_codes WHERE expires_at < datetime('now')").run();
		if (controller.cron === DAILY) await copyPageViews(env);
		else await notify(env); // the weekly one
	},
} satisfies ExportedHandler<Env>;

async function publicApi(request: Request, env: Env, url: URL): Promise<Response> {
	const route = `${request.method} ${url.pathname}`;
	const scoreId = route.match(/^GET \/api\/scores\/(\d{1,10})$/);
	if (scoreId) return scoreDetail(env, Number(scoreId[1]));
	switch (route) {
		case "GET /api/config":
			return config(env);
		case "GET /api/ideas":
			return listIdeas(request, env, url);
		case "POST /api/submit":
			return submit(request, env);
		case "POST /api/vote":
			return vote(request, env);
		case "GET /api/check": {
			const text = (url.searchParams.get("text") ?? "").slice(0, 600);
			return json({ ok: !(await isUnfriendly(env, text)) });
		}
		case "GET /api/flags":
			return publicFlags(env);
		case "GET /api/players":
			return listPlayers(env);
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
		case "POST /api/reports":
			return reportScore(request, env, deviceOf(request, url));
		case "POST /api/progress":
			return getProgress(request, env);
		case "POST /api/progress/games":
			return claimGame(request, env);
		case "POST /api/progress/buy":
			return buy(request, env);
		case "POST /api/progress/ball":
			return useBall(request, env);
		case "POST /api/progress/pair":
			return pairCode(request, env);
		case "POST /api/progress/join":
			return joinCode(request, env);
	}
	throw new HttpError(404, "Not found.");
}
