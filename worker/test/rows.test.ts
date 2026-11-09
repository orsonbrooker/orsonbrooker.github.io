// Leaderboard rows following saved progress (boardOf in worker/src/scores.ts, joinCode in
// worker/src/progress.ts): once devices are joined with a pairing code, each player has one row for all
// of them, including games from before they joined.
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { claimGame, getProgress, joinCode, pairCode } from "../src/progress.ts";
import { boardOf, previewScore, reportScore } from "../src/scores.ts";
import { hash } from "../src/util.ts";
import type { Env } from "../src/util.ts";
import { fakeEnv } from "./fake-d1.ts";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);

function addScore(db: DatabaseSync, device: string, score: number, player = "orson"): number {
	const row = db
		.prepare(
			`INSERT INTO scores (nickname, score, player, shots, made, threes, real_seconds, log, flags, status, token, device, ip_hash, mode)
			 VALUES ('Ace', ?, ?, 10, 5, 0, 60, '[]', '[]', 'shown', ?, ?, 'ip', 'timed') RETURNING id`,
		)
		.get(score, player, `token-${Math.random()}`, device) as { id: number };
	return row.id;
}

type Out = { key?: string; code?: string };
const post = async (route: (r: Request, e: Env) => Promise<Response>, env: Env, body: unknown, ip = "203.0.113.5") =>
	(await route(new Request("http://localhost/api/progress", { method: "POST", headers: { "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), env)).json() as Promise<Out>;

let nonce = 0;
async function game(env: Env) {
	const started = Date.now() - 20000;
	const n = `r${++nonce}`.padEnd(8, "0");
	const token = `${started}.${n}.${await hash(env, `game:${started}.${n}`)}`;
	return { token, mode: "survival", score: 4, shots: [[0.5, 0, 1, 0, 0], [2, 0, 1, 0, 0], [3.5, 0, 0, 0, 0]] };
}

const devices = (db: DatabaseSync) => new Set((db.prepare("SELECT DISTINCT device FROM scores").all() as { device: string }[]).map((r) => r.device));

test("a device on its own keeps its own rows", async () => {
	const { env } = fakeEnv();
	assert.equal(await boardOf(env, A), await hash(env, `device:${A}`));
	const first = await post(claimGame, env, { ...(await game(env)), device: A });
	assert.ok(first.key);
	assert.equal(await boardOf(env, A), await hash(env, `device:${A}`)); // its progress's rows are its own
});

test("joining moves the new device's rows onto the shared ones, and later games land there too", async () => {
	const { env, db } = fakeEnv();
	const hA = await hash(env, `device:${A}`);
	const hB = await hash(env, `device:${B}`);
	addScore(db, hA, 30);
	addScore(db, hB, 45);
	addScore(db, hB, 12, "me100");
	const a = await post(claimGame, env, { ...(await game(env)), device: A });
	const { code } = await post(pairCode, env, { key: a.key });
	await post(joinCode, env, { code, device: B }, "198.51.100.7"); // B had no coins yet
	assert.deepEqual(devices(db), new Set([hA]));
	assert.equal(await boardOf(env, B), hA);
	// One row for Orson across both, at the best (B's 45), so a 40 from B doesn't beat it.
	const preview = (await (
		await previewScore(new Request("http://localhost/api/scores/preview", { method: "POST", headers: { "CF-Connecting-IP": "198.51.100.7" }, body: JSON.stringify({ nickname: "Ace", score: 40, mode: "timed", player: "orson", device: B }) }), env)
	).json()) as { kept: boolean };
	assert.equal(preview.kept, true);
	// Reporting your own row (now from either device) is quietly ignored.
	const own = addScore(db, hA, 5);
	await reportScore(new Request("http://localhost/api/reports", { method: "POST", headers: { "CF-Connecting-IP": "198.51.100.7" }, body: JSON.stringify({ scoreId: own }) }), env, B);
	assert.equal((db.prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number }).n, 0);
});

test("joining with progress of its own brings that progress's other devices' rows too", async () => {
	const { env, db } = fakeEnv();
	const [hA, hB, hC] = await Promise.all([A, B, C].map((d) => hash(env, `device:${d}`)));
	const a = await post(claimGame, env, { ...(await game(env)), device: A });
	// B and C are already joined to each other (B's progress, rows on B's id).
	const b = await post(claimGame, env, { ...(await game(env)), device: B }, "198.51.100.7");
	const { code: bc } = await post(pairCode, env, { key: b.key }, "198.51.100.7");
	await post(joinCode, env, { code: bc, device: C }, "198.51.100.9");
	addScore(db, hB, 20);
	addScore(db, hC, 25); // from before C joined B (an old row on C's own id)
	addScore(db, hA, 10);
	// Then B joins A: B's and C's rows all move to A's.
	const { code } = await post(pairCode, env, { key: a.key });
	await post(joinCode, env, { key: b.key, code, device: B }, "198.51.100.7");
	assert.deepEqual(devices(db), new Set([hA]));
	assert.equal(await boardOf(env, C), hA);
	assert.equal(await boardOf(env, B), hA);
});

test("a device's id is noted on any progress call, without writing again when nothing changed", async () => {
	const { env, db } = fakeEnv();
	const a = await post(claimGame, env, { ...(await game(env)) }); // no device sent (an older game)
	assert.equal((db.prepare("SELECT board FROM progress").get() as { board: string | null }).board, null);
	await post(getProgress, env, { key: a.key, device: A });
	const hA = await hash(env, `device:${A}`);
	assert.equal((db.prepare("SELECT board FROM progress").get() as { board: string }).board, hA);
	assert.equal((db.prepare("SELECT device_hash FROM progress_devices").get() as { device_hash: string }).device_hash, hA);
	// Another device can't take over a progress's rows by sending its id with someone else's key.
	await post(getProgress, env, { key: a.key, device: B });
	assert.equal((db.prepare("SELECT board FROM progress").get() as { board: string }).board, hA);
});

// ---------- Races and odd cases ----------

type Failed = Error & { status?: number };
const coinsOf = async (env: Env, key: string | undefined) => ((await post(getProgress, env, { key })) as unknown as { coins: number }).coins;
const count = (db: DatabaseSync, sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const ORPHANS = "SELECT COUNT(*) AS n FROM progress_devices WHERE progress_id NOT IN (SELECT id FROM progress)";

test("a score saved on the device's own row while it was joining moves across next time the game opens", async () => {
	const { env, db } = fakeEnv();
	const [hA, hB] = await Promise.all([A, B].map((d) => hash(env, `device:${d}`)));
	const a = await post(claimGame, env, { ...(await game(env)), device: A });
	const { code } = await post(pairCode, env, { key: a.key });
	const b = await post(joinCode, env, { code, device: B }, "198.51.100.7");
	addScore(db, hB, 50); // sent mid-join: it worked out its row just before the join landed
	await post(getProgress, env, { key: b.key, device: B });
	assert.deepEqual(devices(db), new Set([hA]));
});

test("a device that starts a new progress (its key was reset) goes on the new one's rows, not the old", async () => {
	const { env, db } = fakeEnv();
	const hB = await hash(env, `device:${B}`);
	const a = await post(claimGame, env, { ...(await game(env)), device: A });
	const { code } = await post(pairCode, env, { key: a.key });
	await post(joinCode, env, { code, device: B }, "198.51.100.7");
	assert.notEqual(await boardOf(env, B), hB);
	await post(claimGame, env, { ...(await game(env)), device: B }, "198.51.100.7"); // no key: a new progress
	assert.equal(await boardOf(env, B), hB);
	assert.equal(count(db, "SELECT COUNT(*) AS n FROM progress_devices WHERE device_hash = ?", hB), 1);
});

test("two devices typing each other's codes at once: the second join changes nothing and asks to try again", async () => {
	const { env, db } = fakeEnv();
	const a = await post(claimGame, env, { ...(await game(env)), device: A });
	const b = await post(claimGame, env, { ...(await game(env)), device: B }, "198.51.100.7");
	const { code: fromA } = await post(pairCode, env, { key: a.key });
	const { code: fromB } = await post(pairCode, env, { key: b.key }, "198.51.100.7");
	const total = (await coinsOf(env, a.key)) + (await coinsOf(env, b.key));
	// B's join has used A's code; just then A's join (with B's code) merges A into B.
	const batch = env.DB.batch.bind(env.DB);
	env.DB.batch = (async (stmts: Parameters<typeof batch>[0]) => {
		env.DB.batch = batch;
		await post(joinCode, env, { key: a.key, code: fromB, device: A });
		return batch(stmts);
	}) as typeof batch;
	await assert.rejects(post(joinCode, env, { key: b.key, code: fromA, device: B }, "198.51.100.7"), (err: Failed) => err.status === 409);
	// One progress left, both keys find it, with both devices' coins, and no device pointing at nothing.
	assert.equal(count(db, "SELECT COUNT(*) AS n FROM progress"), 1);
	assert.equal(await coinsOf(env, a.key), total);
	assert.equal(await coinsOf(env, b.key), total);
	assert.equal(count(db, ORPHANS), 0);
});

test("a new device joining a progress that was merged away a moment ago is asked to try again", async () => {
	const { env, db } = fakeEnv();
	const a = await post(claimGame, env, { ...(await game(env)), device: A });
	const { code } = await post(pairCode, env, { key: a.key });
	const prepare = env.DB.prepare.bind(env.DB);
	env.DB.prepare = ((sql: string) => {
		// Just before: A's progress is merged into another one (as joinCode does) and is gone.
		if (sql.startsWith("INSERT INTO progress_devices (key_hash, progress_id) SELECT"))
			db.exec("INSERT INTO progress (id) VALUES (99); UPDATE progress_devices SET progress_id = 99; DELETE FROM progress WHERE id != 99;");
		return prepare(sql);
	}) as typeof prepare;
	await assert.rejects(post(joinCode, env, { code, device: C }, "198.51.100.9"), (err: Failed) => err.status === 409);
	assert.equal(count(db, "SELECT COUNT(*) AS n FROM progress_devices"), 1); // only A's: the new device wasn't added
	assert.equal(count(db, ORPHANS), 0);
});
