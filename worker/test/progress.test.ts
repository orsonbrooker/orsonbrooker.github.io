// Saved progress (worker/src/progress.ts): claiming a game's coins, buying and using ball styles, and
// pairing another device with a code, against a real SQLite database built from the migrations.
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "../src/http.ts";
import { buy, claimGame, getProgress, joinCode, pairCode, useBall } from "../src/progress.ts";
import { hash } from "../src/util.ts";
import type { Env } from "../src/util.ts";
import { ballStyle } from "../../shared/shop.js";
import { fakeEnv } from "./fake-d1.ts";

type Out = Record<string, unknown> & { key?: string; coins: number; earned: number; ball: string; items: string[]; got?: number; code?: string };

const call = async (route: (r: Request, e: Env) => Promise<Response>, env: Env, body: unknown, ip = "203.0.113.5"): Promise<Out> => {
	const request = new Request("http://localhost/api/progress", {
		method: "POST",
		headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
		body: JSON.stringify(body),
	});
	return (await route(request, env)).json() as Promise<Out>;
};

// Fails with this status (and, if given, a message containing `words`).
async function refused(promise: Promise<unknown>, status: number, words?: string) {
	await assert.rejects(promise, (err: unknown) => {
		assert.ok(err instanceof HttpError, String(err));
		assert.equal(err.status, status, err.message);
		if (words) assert.match(err.message, new RegExp(words, "i"));
		return true;
	});
}

// A start token signed like gameToken's, from `ago` seconds back (a game has to take real time).
let nonce = 0;
async function token(env: Env, ago = 20): Promise<string> {
	const started = Date.now() - ago * 1000;
	const n = `n${++nonce}`.padEnd(8, "0");
	return `${started}.${n}.${await hash(env, `game:${started}.${n}`)}`;
}

// Sudden death: two makes then a miss (2 coins, score 4), 3.5 seconds in.
const SHOTS = [
	[0.5, 0, 1, 0, 0],
	[2, 0, 1, 0, 0],
	[3.5, 0, 0, 0, 0],
];
const game = async (env: Env, extra: Record<string, unknown> = {}) => ({ token: await token(env), mode: "survival", score: 4, shots: SHOTS, ...extra });
const setCoins = (db: ReturnType<typeof fakeEnv>["db"], coins: number) => db.prepare("UPDATE progress SET coins = ?").run(coins);

test("a game's coins: the first makes a progress and a key, kept only as a hash", async () => {
	const { env, db } = fakeEnv();
	const out = await call(claimGame, env, await game(env));
	assert.equal(out.got, 2);
	assert.equal(out.coins, 2);
	assert.equal(out.earned, 2);
	assert.deepEqual(out.items, ["classic"]);
	assert.match(out.key ?? "", /^[0-9a-f]{48}$/);
	const stored = db.prepare("SELECT key_hash FROM progress_devices").all() as { key_hash: string }[];
	assert.equal(stored.length, 1);
	assert.notEqual(stored[0].key_hash, out.key);
	// The next game adds to the same progress, without a new key.
	const next = await call(claimGame, env, { ...(await game(env)), key: out.key });
	assert.equal(next.key, undefined);
	assert.equal(next.coins, 4);
});

test("each game earns coins once", async () => {
	const { env } = fakeEnv();
	const g = await game(env);
	const first = await call(claimGame, env, g);
	await refused(call(claimGame, env, { ...g, key: first.key }), 400, "already in");
});

test("only real, finished games earn coins", async () => {
	const { env, db } = fakeEnv();
	await refused(call(claimGame, env, await game(env, { debug: true })), 400, "test mode");
	await refused(call(claimGame, env, await game(env, { score: 40 })), 400); // doesn't match its shots
	await refused(call(claimGame, env, { ...(await game(env)), token: await token(env, 1) }), 400, "too fast");
	await refused(call(claimGame, env, { ...(await game(env)), token: "1.2.3" }), 400);
	// A game with no baskets has no coins (and makes no progress).
	await refused(call(claimGame, env, { token: await token(env), mode: "survival", score: 0, shots: [[1, 0, 0, 0, 0]] }), 400);
	assert.equal((db.prepare("SELECT COUNT(*) AS n FROM progress").get() as { n: number }).n, 0);
});

test("buying a ball: enough coins, once, and it's put on", async () => {
	const { env, db } = fakeEnv();
	const { key } = await call(claimGame, env, await game(env));
	const lava = ballStyle("lava")!;
	await refused(call(buy, env, { key, item: "lava" }), 400, "more coins");
	setCoins(db, lava.price + 10);
	const out = await call(buy, env, { key, item: "lava" });
	assert.equal(out.coins, 10);
	assert.equal(out.ball, "lava");
	assert.deepEqual(out.items, ["classic", "lava"]);
	await refused(call(buy, env, { key, item: "lava" }), 400, "already got");
	await refused(call(buy, env, { key, item: "classic" }), 400, "not in the shop"); // free, never bought
	await refused(call(buy, env, { key, item: "gold" }), 400, "not in the shop");
	await refused(call(buy, env, { key: "f".repeat(48), item: "ice" }), 404);
});

test("a double tap on Buy only pays once", async () => {
	const { env, db } = fakeEnv();
	const { key } = await call(claimGame, env, await game(env));
	setCoins(db, 1000);
	const results = await Promise.allSettled([call(buy, env, { key, item: "ice" }), call(buy, env, { key, item: "ice" })]);
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
	const after = await call(getProgress, env, { key });
	assert.equal(after.coins, 1000 - ballStyle("ice")!.price);
});

test("using a ball: only ones they own, and Classic always", async () => {
	const { env, db } = fakeEnv();
	const { key } = await call(claimGame, env, await game(env));
	await refused(call(useBall, env, { key, ball: "grape" }), 400, "shop first");
	await refused(call(useBall, env, { key, ball: "nope" }), 400);
	setCoins(db, 1000);
	await call(buy, env, { key, item: "grape" });
	assert.equal((await call(useBall, env, { key, ball: "classic" })).ball, "classic");
	assert.equal((await call(useBall, env, { key, ball: "grape" })).ball, "grape");
});

test("a code brings another device in: once, and only for 10 minutes", async () => {
	const { env, db } = fakeEnv();
	const { key } = await call(claimGame, env, await game(env));
	const { code } = await call(pairCode, env, { key });
	assert.match(code ?? "", /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
	// A new device (no key yet), typing it in lower case without the dash.
	const joined = await call(joinCode, env, { code: code!.toLowerCase().replace("-", "") }, "198.51.100.7");
	assert.match(joined.key ?? "", /^[0-9a-f]{48}$/);
	assert.notEqual(joined.key, key);
	assert.equal(joined.coins, 2);
	// Both devices now share it: coins earned on one show on the other.
	await call(claimGame, env, { ...(await game(env)), key: joined.key });
	assert.equal((await call(getProgress, env, { key })).coins, 4);
	// Used once.
	await refused(call(joinCode, env, { code }, "198.51.100.8"), 400, "didn't work");
	// Run out.
	const late = await call(pairCode, env, { key });
	db.prepare("UPDATE pair_codes SET expires_at = datetime('now', '-1 minute')").run();
	await refused(call(joinCode, env, { code: late.code }, "198.51.100.8"), 400, "didn't work");
	await refused(call(joinCode, env, { code: "ABCD" }, "198.51.100.8"), 400, "8 letters");
	await refused(call(pairCode, env, { key: "f".repeat(48) }), 404);
});

test("joining from a device with its own coins and balls: nothing is lost", async () => {
	const { env, db } = fakeEnv();
	const a = await call(claimGame, env, await game(env));
	const b = await call(claimGame, env, await game(env), "198.51.100.7");
	setCoins(db, 500); // both
	await call(buy, env, { key: a.key, item: "lava" }); // a: 350
	await call(buy, env, { key: b.key, item: "ice" }); // b: 300
	await call(buy, env, { key: b.key, item: "lava" }); // b: 150, and owns lava too
	const { code } = await call(pairCode, env, { key: a.key });
	const out = await call(joinCode, env, { key: b.key, code }, "198.51.100.7");
	assert.equal(out.key, b.key); // b keeps its key
	assert.equal(out.coins, 350 + 150);
	assert.equal(out.earned, 4);
	assert.deepEqual(out.items, ["classic", "lava", "ice"]);
	assert.equal(out.ball, "lava"); // a's ball
	// One progress left, with both devices and both games.
	assert.equal((db.prepare("SELECT COUNT(*) AS n FROM progress").get() as { n: number }).n, 1);
	assert.equal((db.prepare("SELECT COUNT(DISTINCT progress_id) AS n FROM progress_devices").get() as { n: number }).n, 1);
	assert.equal((db.prepare("SELECT COUNT(DISTINCT progress_id) AS n FROM progress_games").get() as { n: number }).n, 1);
	assert.deepEqual(await call(getProgress, env, { key: a.key }), await call(getProgress, env, { key: b.key }));
});

test("a code from the same progress changes nothing", async () => {
	const { env } = fakeEnv();
	const { key } = await call(claimGame, env, await game(env));
	const { code } = await call(pairCode, env, { key });
	const out = await call(joinCode, env, { key, code });
	assert.equal(out.coins, 2);
	assert.equal(out.key, undefined);
});

test("guessing codes runs out after 15 tries a day", async () => {
	const { env } = fakeEnv();
	for (let i = 0; i < 15; i++) await refused(call(joinCode, env, { code: "ABCD-EFGH" }), 400);
	await refused(call(joinCode, env, { code: "ABCD-EFGH" }), 429);
});
