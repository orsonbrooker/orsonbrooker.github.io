// Public answers that are the same for everyone (the boards, score cards, players, config and the
// ideas list without a device) are kept in Cloudflare's edge cache for a short while, so a busy
// moment, or someone calling a URL over and over, doesn't read the database every time. A Worker's
// own Cache-Control doesn't do this; the Cache API does. Nothing personal or admin is ever cached.
//
// The key is the URL with only the parameters the handler reads, tidied the same way it tidies
// them, so made-up extra parameters can't skip the cache. Writes that change a board clear it.

import { modeOf } from "../../shared/rules.js";
import type { Mode } from "../../shared/rules.js";

type Cached = { key: string; ttl: number };

/** Where a public GET is cached, and for how many seconds, or null if it mustn't be. */
export function cacheKey(url: URL): Cached | null {
	const path = url.pathname;
	const q = url.searchParams;
	if (path === "/api/scores") return { key: boardKey(url.origin, modeOf(q.get("mode")), q.get("range") === "all"), ttl: 30 };
	const id = path.match(/^\/api\/scores\/(\d{1,10})$/);
	if (id) return { key: `${url.origin}/api/scores/${Number(id[1])}`, ttl: 60 };
	if (path === "/api/players" || path === "/api/config") return { key: url.origin + path, ttl: 60 };
	// With a device, the answer marks that device's own votes: never cached.
	if (path === "/api/ideas" && !q.has("device")) {
		const app = q.get("app");
		return { key: `${url.origin}/api/ideas${app ? `?app=${encodeURIComponent(app)}` : ""}`, ttl: 30 };
	}
	return null;
}

const boardKey = (origin: string, mode: Mode, all: boolean) => `${origin}/api/scores?mode=${mode}&range=${all ? "all" : "week"}`;

/**
 * The cached answer for `c`, or a fresh one from `make` (kept for next time if it's a 200). The
 * browser still gets the handler's own Cache-Control.
 */
export async function cached(c: Cached, ctx: ExecutionContext, make: () => Promise<Response>): Promise<Response> {
	const cache = caches.default;
	const key = new Request(c.key);
	const hit = await cache.match(key);
	if (hit) {
		const res = new Response(hit.body, hit);
		res.headers.set("Cache-Control", hit.headers.get("X-Browser-Cache-Control") ?? "no-store");
		res.headers.delete("X-Browser-Cache-Control");
		res.headers.set("X-Edge-Cache", "hit");
		return res;
	}
	const res = await make();
	if (res.status === 200) {
		const copy = new Response(res.clone().body, res);
		copy.headers.set("X-Browser-Cache-Control", res.headers.get("Cache-Control") ?? "no-store");
		copy.headers.set("Cache-Control", `public, max-age=${c.ttl}`);
		ctx.waitUntil(cache.put(key, copy));
	}
	res.headers.set("X-Edge-Cache", "miss");
	return res;
}

/** Clears cached answers after a change, so it shows straight away (in this data centre). */
export async function forget(origin: string, what: { boards?: Mode[]; score?: number; players?: boolean; ideas?: boolean }) {
	const keys: string[] = [];
	for (const mode of what.boards ?? []) keys.push(boardKey(origin, mode, false), boardKey(origin, mode, true));
	if (what.score) keys.push(`${origin}/api/scores/${what.score}`);
	if (what.players) keys.push(`${origin}/api/players`);
	if (what.ideas) keys.push(`${origin}/api/ideas`);
	await Promise.all(keys.map((k) => caches.default.delete(k)));
}
