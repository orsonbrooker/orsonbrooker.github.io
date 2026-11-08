// Reporting a leaderboard name (reportScore and clearReports in worker/src/scores.ts), run against a
// real SQLite database built from the migrations (Node's built-in node:sqlite, standing in for D1).
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { clearReports, REPORTED, reportScore } from "../src/scores.ts";
import { hash } from "../src/util.ts";
import type { Env } from "../src/util.ts";

// Just enough of D1's prepare().bind().all()/first()/run() for the code under test.
function fakeEnv(): { env: Env; db: DatabaseSync } {
	const db = new DatabaseSync(":memory:");
	const dir = new URL("../migrations/", import.meta.url);
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, dir), "utf8"));
	const prepare = (sql: string) => {
		let args: unknown[] = [];
		const stmt = {
			bind: (...values: unknown[]) => ((args = values), stmt),
			all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
			first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
			run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
		};
		return stmt;
	};
	return { env: { DB: { prepare }, HASH_SECRET: "test-secret" } as unknown as Env, db };
}

function addScore(db: DatabaseSync, device: string, player = "orson", status = "shown"): number {
	const row = db
		.prepare(
			`INSERT INTO scores (nickname, score, player, shots, made, threes, real_seconds, log, flags, status, token, device, ip_hash, mode)
			 VALUES ('Rudey', 10, ?, 10, 5, 0, 60, '[]', '[]', ?, ?, ?, 'ip', 'timed') RETURNING id`,
		)
		.get(player, status, `token-${Math.random()}`, device) as { id: number };
	return row.id;
}

type Failed = Error & { status?: number };
const OTHER_DEVICE = "b".repeat(32);
const report = (env: Env, body: unknown, ip = "203.0.113.5", device = OTHER_DEVICE) =>
	reportScore(
		new Request("http://localhost/api/reports", { method: "POST", headers: { "CF-Connecting-IP": ip, "X-Device": device }, body: JSON.stringify(body) }),
		env,
		device,
	);
const count = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number }).n;
const open = (db: DatabaseSync) => (db.prepare(REPORTED).all() as { score_id: number }[]).map((r) => r.score_id);

test("a report needs a whole-number id of a score that's on the board", async () => {
	const { env, db } = fakeEnv();
	const shown = addScore(db, "dev-a");
	const hidden = addScore(db, "dev-a", "jethro", "hidden");
	for (const scoreId of ["1", 1.5, -1, 0, null, undefined, {}, [shown], Number.MAX_SAFE_INTEGER + 1])
		await assert.rejects(report(env, { scoreId }), (err: Failed) => err.status === 400, `scoreId ${JSON.stringify(scoreId)}`);
	await assert.rejects(report(env, { scoreId: hidden }), (err: Failed) => err.status === 404);
	await assert.rejects(report(env, { scoreId: shown + 100 }), (err: Failed) => err.status === 404);
	await assert.rejects(
		reportScore(new Request("http://localhost/api/reports", { method: "POST", body: "not json" }), env, OTHER_DEVICE),
		(err: Failed) => err.status === 400,
	);
	assert.equal(count(db), 0);
	const res = await report(env, { scoreId: shown });
	assert.deepEqual(await res.json(), { ok: true });
	assert.equal(count(db), 1);
});

test("one report per score per IP: repeats change nothing, another IP counts", async () => {
	const { env, db } = fakeEnv();
	const id = addScore(db, "dev-a");
	await report(env, { scoreId: id });
	await report(env, { scoreId: id });
	await report(env, { scoreId: id }, "203.0.113.5", "c".repeat(32)); // same IP, another device
	assert.equal(count(db), 1);
	await report(env, { scoreId: id }, "198.51.100.7");
	assert.equal(count(db), 2);
	assert.deepEqual(open(db), [id, id]);
});

test("a device reporting its own row is ignored", async () => {
	const { env, db } = fakeEnv();
	const mine = "d".repeat(32);
	const id = addScore(db, await hash(env, `device:${mine}`));
	const res = await report(env, { scoreId: id }, "203.0.113.5", mine);
	assert.deepEqual(await res.json(), { ok: true });
	assert.equal(count(db), 0);
});

test("reports are rate limited per IP", async () => {
	const { env, db } = fakeEnv();
	const ids = Array.from({ length: 31 }, () => addScore(db, "dev-a"));
	for (const id of ids.slice(0, 30)) await report(env, { scoreId: id });
	await assert.rejects(report(env, { scoreId: ids[30] }), (err: Failed) => err.status === 429);
	assert.equal(count(db), 30);
});

test("clearing a name's reports clears that device and player's games only, and they stay cleared", async () => {
	const { env, db } = fakeEnv();
	const a1 = addScore(db, "dev-a");
	const a2 = addScore(db, "dev-a");
	const other = addScore(db, "dev-a", "jethro");
	for (const id of [a1, a2, other]) await report(env, { scoreId: id });
	await clearReports(env, a1);
	assert.deepEqual(open(db), [other]);
	await report(env, { scoreId: a1 }); // the same report again doesn't bring it back
	assert.deepEqual(open(db), [other]);
});
