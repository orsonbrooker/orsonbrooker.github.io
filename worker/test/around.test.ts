// Your place on the leaderboard (aroundMe in worker/src/scores.ts): outside the top 10, your best row with two
// above and two below, never repeating a row the top 10 shows. Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { aroundMe } from "../src/scores.ts";
import { hash } from "../src/util.ts";
import { fakeEnv } from "./fake-d1.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Env } from "../src/util.ts";

const ME = "m".repeat(32);

function add(db: DatabaseSync, device: string, score: number, nickname: string, player = "orson") {
	db.prepare(
		`INSERT INTO scores (nickname, score, player, shots, made, threes, real_seconds, log, flags, status, token, device, ip_hash, mode)
		 VALUES (?, ?, ?, 10, 5, 0, 60, '[]', '[]', 'shown', ?, ?, 'ip', 'timed')`,
	).run(nickname, score, player, `t-${Math.random()}`, device);
}
const ask = async (env: Env, range = "all") =>
	(await (await aroundMe(new Request("http://localhost/api/scores/around", { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.5" }, body: JSON.stringify({ mode: "timed", range, device: ME }) }), env)).json()) as { rows: { rank: number; nickname: string; you: boolean }[] };

test("13th of 15: rows 11-15 with ranks 11..15, mine at 13", async () => {
	const { env, db } = fakeEnv();
	const me = await hash(env, `device:${ME}`);
	for (let i = 0; i < 15; i++) if (i !== 12) add(db, `d${i}`, 100 - i, `P${i + 1}`);
	add(db, me, 100 - 12, "Me");
	add(db, me, 10, "MeAlt", "me1"); // my second player, lower down
	const { rows } = await ask(env);
	assert.deepEqual(rows.map((r) => r.rank), [11, 12, 13, 14, 15]);
	assert.equal(rows[2].you, true);
	assert.equal(rows[2].nickname, "Me");
	assert.ok(rows.every((r) => !("device" in r)));
});

test("in the top 10: nothing", async () => {
	const { env, db } = fakeEnv();
	const me = await hash(env, `device:${ME}`);
	for (let i = 0; i < 15; i++) add(db, `d${i}`, 50 - i, `P${i}`);
	add(db, me, 99, "Me");
	assert.deepEqual((await ask(env)).rows, []);
});

test("last on the board: fewer rows below", async () => {
	const { env, db } = fakeEnv();
	const me = await hash(env, `device:${ME}`);
	for (let i = 0; i < 12; i++) add(db, `d${i}`, 100 - i, `P${i}`);
	add(db, me, 1, "Me");
	const { rows } = await ask(env);
	assert.deepEqual(rows.map((r) => r.rank), [11, 12, 13]);
});

test("11th: no rows the top 10 already shows", async () => {
	const { env, db } = fakeEnv();
	const me = await hash(env, `device:${ME}`);
	for (let i = 0; i < 14; i++) add(db, `d${i}`, 100 - i, `P${i + 1}`);
	add(db, me, 90, "Me"); // ties with P11 at 90: placed after it by id, so 12th
	const { rows } = await ask(env);
	assert.ok(rows.every((r) => r.rank > 10));
	assert.equal(rows.find((r) => r.you)?.rank, 12);
});
