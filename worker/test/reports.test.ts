// Reporting a leaderboard name (reportScore and clearReports in worker/src/scores.ts), run against a
// real SQLite database built from the migrations (Node's built-in node:sqlite, standing in for D1).
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { blockReportedName, clearReports, REPORTED, reportScore } from "../src/scores.ts";
import { forgetBlockedNames, hash, isUnfriendly } from "../src/util.ts";
import type { Env } from "../src/util.ts";
import { fakeEnv } from "./fake-d1.ts";

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
	const hidden = addScore(db, "dev-a", "p1", "hidden");
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
	const other = addScore(db, "dev-a", "p1");
	for (const id of [a1, a2, other]) await report(env, { scoreId: id });
	await clearReports(env, a1);
	assert.deepEqual(open(db), [other]);
	await report(env, { scoreId: a1 }); // the same report again doesn't bring it back
	assert.deepEqual(open(db), [other]);
});

test("hiding a reported name blocks it everywhere people type; other hides don't", async () => {
	const { env, db } = fakeEnv();
	forgetBlockedNames();
	const reported = addScore(db, "dev-a");
	db.prepare("UPDATE scores SET nickname = 'Poo Head' WHERE id = ?").run(reported);
	const odd = addScore(db, "dev-b", "p1"); // hidden for an odd score, never reported
	db.prepare("UPDATE scores SET nickname = 'Zapper' WHERE id = ?").run(odd);
	const short = addScore(db, "dev-c", "p2");
	db.prepare("UPDATE scores SET nickname = 'Jo' WHERE id = ?").run(short);
	await report(env, { scoreId: reported });
	await report(env, { scoreId: short });

	assert.equal(await blockReportedName(env, reported), "Poo Head");
	assert.equal(await blockReportedName(env, odd), null);
	assert.equal(await blockReportedName(env, short), null); // too short to block safely
	for (const t of ["Poo Head", "poohead", "P00-HEAD", "Mr Poo Head 2"]) assert.equal(await isUnfriendly(env, t), true, t);
	for (const t of ["Zapper", "Jo", "Pooja", "Head coach"]) assert.equal(await isUnfriendly(env, t), false, t);

	// A name that was said to look fine (reports cleared) isn't blocked if hidden later.
	const fine = addScore(db, "dev-d", "p3");
	db.prepare("UPDATE scores SET nickname = 'Sparkles' WHERE id = ?").run(fine);
	await report(env, { scoreId: fine });
	await clearReports(env, fine);
	assert.equal(await blockReportedName(env, fine), null);
});
