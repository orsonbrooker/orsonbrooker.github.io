// HORSE coins (a flat amount for a finished match) and the admin page's stats (worker/src/stats.ts).
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { HORSE_MATCH } from "../../shared/rules.js";
import { claimGame, pairCode, joinCode } from "../src/progress.ts";
import { copyPageViews, stats } from "../src/stats.ts";
import { hash } from "../src/util.ts";
import type { Env } from "../src/util.ts";
import { fakeEnv } from "./fake-d1.ts";

type Out = { key?: string; got?: number; coins: number; code?: string; error?: string };
const call = async (route: (r: Request, e: Env) => Promise<Response>, env: Env, body: unknown, ip = "203.0.113.5"): Promise<Out> => {
	const request = new Request("http://localhost/api/progress", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });
	try {
		return (await (await route(request, env)).json()) as Out;
	} catch (err) {
		return { coins: 0, error: (err as Error).message };
	}
};
let nonce = 0;
async function token(env: Env, secondsAgo: number) {
	const started = Date.now() - secondsAgo * 1000;
	const n = `t${++nonce}`.padEnd(8, "0");
	return `${started}.${n}.${await hash(env, `game:${started}.${n}`)}`;
}
const survival = async (env: Env) => ({ token: await token(env, 20), mode: "survival", score: 4, shots: [[0.5, 0, 1, 0, 0], [2, 0, 1, 0, 0], [3.5, 0, 0, 0, 0]] });

test("a finished HORSE match earns a flat amount, once, and not if it was impossibly quick", async () => {
	const { env, db } = fakeEnv();
	const t = await token(env, 120);
	const out = await call(claimGame, env, { token: t, mode: "horse" });
	assert.equal(out.got, HORSE_MATCH.coins);
	assert.equal(out.coins, HORSE_MATCH.coins);
	assert.equal((db.prepare("SELECT mode FROM progress_games").get() as { mode: string }).mode, "horse");
	assert.match((await call(claimGame, env, { key: out.key, token: t, mode: "horse" })).error ?? "", /already in/);
	assert.match((await call(claimGame, env, { key: out.key, token: await token(env, 5), mode: "horse" })).error ?? "", /too fast/);
	// A made-up score or shots change nothing.
	const more = await call(claimGame, env, { key: out.key, token: await token(env, 120), mode: "horse", score: 9999, shots: [] });
	assert.equal(more.got, HORSE_MATCH.coins);
});

test("stats count games, saves and features from what's saved, and page views once copied", async () => {
	const { env, db } = fakeEnv();
	const a = await call(claimGame, env, { ...(await survival(env)), device: "a".repeat(32) });
	await call(claimGame, env, { key: a.key, ...(await survival(env)), device: "a".repeat(32) });
	await call(claimGame, env, { key: a.key, token: await token(env, 60), mode: "horse", device: "a".repeat(32) });
	const b = await call(claimGame, env, { ...(await survival(env)), device: "b".repeat(32) }, "198.51.100.7");
	// A third device joins a's save with a code: still one save.
	const { code } = await call(pairCode, env, { key: a.key });
	await call(joinCode, env, { code, device: "c".repeat(32) }, "198.51.100.9");
	// An old save that played again a week after it started, and one that didn't.
	db.exec("INSERT INTO progress (id, created_at) VALUES (90, datetime('now', '-20 days')), (91, datetime('now', '-20 days'))");
	db.exec("INSERT INTO progress_games (token, progress_id, mode, coins, ip_hash, created_at) VALUES ('old1', 90, 'timed', 3, 'x', datetime('now', '-20 days')), ('old2', 90, 'timed', 3, 'x', datetime('now', '-2 days')), ('old3', 91, 'timed', 3, 'x', datetime('now', '-20 days'))");
	assert.ok(b.key);
	// a's save sent a score: its row is on the save's board id.
	db.exec(`INSERT INTO scores (nickname, score, player, shots, made, threes, real_seconds, log, token, device, ip_hash)
		SELECT 'Ace', 4, 'orson', 3, 2, 0, 20, '[]', 'sent1', board, 'x' FROM progress WHERE board IS NOT NULL ORDER BY id LIMIT 1`);

	const s = (await stats(env)) as Record<string, any>;
	assert.equal(s.days.length, 30);
	assert.equal(s.days.at(-1), new Date().toISOString().slice(0, 10));
	assert.equal(total(s.games.survival), 3);
	assert.equal(total(s.games.horse), 1);
	assert.equal(total(s.games.timed), 3);
	assert.deepEqual(s.active, { today: 2, week: 3, month: 4 });
	assert.equal(s.cameBack, 1); // save 90: two different days
	assert.deepEqual({ ...s.weekLater }, { made: 2, back: 1 });
	assert.equal(s.adoption.saves, 4);
	assert.equal(s.adoption.paired, 1);
	assert.equal(s.adoption.horse, 1);
	assert.equal(s.adoption.shop, 0);
	assert.equal(s.adoption.leaderboard, 1);
	assert.deepEqual(s.characters.map((c: { name: string; n: number }) => ({ ...c })), [{ name: "orson", n: 1 }]);
	assert.equal(s.pageViewsReady, false);

	// Page views: copied from Cloudflare's GraphQL API into page_views, and shown.
	const realFetch = globalThis.fetch;
	const today = new Date().toISOString().slice(0, 10);
	let asked: { variables: { from: string; paths: string[] } } | null = null;
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		asked = JSON.parse(String(init.body));
		const groups = [
			{ count: 40, sum: { visits: 20 }, dimensions: { date: today, clientRequestPath: "/" } },
			{ count: 25, sum: { visits: 6 }, dimensions: { date: today, clientRequestPath: "/games/shootaround/" } },
		];
		return new Response(JSON.stringify({ data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: groups }] } }, errors: null }));
	}) as typeof fetch;
	try {
		const withToken = { ...env, CF_ANALYTICS_TOKEN: "t", CF_ZONE_ID: "z" } as Env;
		assert.equal(await copyPageViews(env), 0); // no token: nothing asked
		assert.equal(asked, null);
		assert.equal(await copyPageViews(withToken), 2);
		assert.deepEqual(asked!.variables.paths, ["/", "/games/shootaround/", "/players/", "/ideas/"]);
		assert.equal(await copyPageViews(withToken), 2); // again: replaced, not added
		assert.equal((db.prepare("SELECT SUM(views) AS n FROM page_views").get() as { n: number }).n, 65);
		assert.equal(asked!.variables.from, today); // carries on from the last day copied
		const s2 = (await stats(withToken)) as Record<string, any>;
		assert.equal(s2.pages["/games/shootaround/"].views.at(-1), 25);
		assert.equal(s2.pageViewsReady, true);
	} finally {
		globalThis.fetch = realFetch;
	}
});

const total = (a: number[] = []) => a.reduce((x, y) => x + y, 0);
