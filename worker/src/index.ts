// The API for orsonbrooker.com: this file is the entry point and router; each area has its own file.
//
// Public:  GET  /api/config         Turnstile site key and the list of games/apps          ideas.ts
//          GET  /api/ideas          approved ideas (?app= to filter; an X-Device header marks own votes)
//          POST /api/submit         a visitor's idea; goes to the admin inbox, never straight to the board
//          POST /api/vote           upvote or un-upvote an idea
//          GET  /api/check?text=    is this text OK? (live checks while typing)              util.ts
//          GET  /api/players        approved players made with the builder                  players.ts
//          POST /api/players        a new player; waits for approval before it's in the game
//          POST /api/games          a signed start token for a new game of Shootaround     scores.ts
//          GET  /api/scores         the leaderboard (?range=week or all, ?mode=timed, survival or around)
//          GET  /api/scores/:id     one game's card
//          POST /api/scores         a finished game's score, with its shot log (checked, see postScore)
//          POST /api/scores/preview where a game would land, as it ends (nothing saved)
// Admin:   GET  /admin              triage page (behind Cloudflare Access)                 admin.ts
//          GET  /api/admin/inbox    new submissions, all ideas and apps
//          POST /api/admin/submissions/:id   approve as a new idea, merge into an idea, or reject
//          POST /api/admin/ideas/:id         edit an idea or change its status
//          POST /api/admin/players/:id       approve, hide, rename or delete a player
//          POST /api/admin/scores/:id        show or hide a leaderboard score, or rename its player
// Cron:    weekly phone notification of things to check                                  notify.ts

import { admin, adminHtml } from "./admin.ts";
import { cacheKey, cached } from "./cache.ts";
import { HttpError } from "./http.ts";
import { config, listIdeas, submit, vote } from "./ideas.ts";
import { notify } from "./notify.ts";
import { createPlayer, listPlayers } from "./players.ts";
import { gameToken, leaderboard, postScore, previewScore, scoreDetail } from "./scores.ts";
import { cors, isRude, json } from "./util.ts";
import type { Env } from "./util.ts";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		try {
			if (url.pathname === "/admin" || url.pathname === "/admin/") return await adminHtml(request, env);
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

	async scheduled(_controller, env): Promise<void> {
		// Daily rate-limit counts are only needed on the day.
		await env.DB.prepare("DELETE FROM rate_limits WHERE day < date('now', '-1 day')").run();
		await notify(env);
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
			return json({ ok: !isRude(text) });
		}
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
	}
	throw new HttpError(404, "Not found.");
}
