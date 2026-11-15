// A place on a board without reading the board (nearScore in worker/src/scores.ts): "Your place" on the leaderboard
// screen (GET /api/scores/around, by score) and the game-over preview. Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { aroundScore, previewScore } from "../src/scores.ts";
import { hash } from "../src/util.ts";
import { fakeEnv } from "./fake-d1.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Env } from "../src/util.ts";

const ME = "m".repeat(32);

function add(db: DatabaseSync, device: string, score: number, nickname: string, { player = "orson", mode = "timed" } = {}) {
	db.prepare(
		`INSERT INTO scores (nickname, score, player, shots, made, threes, real_seconds, log, flags, status, token, device, ip_hash, mode)
		 VALUES (?, ?, ?, 10, 5, 0, 60, '[]', '[]', 'shown', ?, ?, 'ip', ?)`,
	).run(nickname, score, player, `t-${Math.random()}`, device, mode);
}
type Row = { rank: number; nickname: string; score: number; you?: boolean };
const around = async (env: Env, score: number, mode = "timed") =>
	(await (await aroundScore(new Request("http://localhost/api/scores/around"), env, new URL(`http://localhost/api/scores/around?mode=${mode}&range=all&score=${score}`))).json()) as {
		rank: number;
		above: Row[];
		below: Row[];
	};
const preview = async (env: Env, score: number) =>
	(await (
		await previewScore(
			new Request("http://localhost/api/scores/preview", { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.5" }, body: JSON.stringify({ nickname: "Me", score, mode: "timed", player: "orson", device: ME }) }),
			env,
		)
	).json()) as { kept: boolean; rank: number; board: Row[] };

test("13th of 15: two above (11, 12) and two below (14, 15), no device ids", async () => {
	const { env, db } = fakeEnv();
	for (let i = 0; i < 15; i++) if (i !== 12) add(db, `d${i}`, 100 - i, `P${i + 1}`);
	const out = await around(env, 88);
	assert.equal(out.rank, 13);
	assert.deepEqual(out.above.map((r) => [r.rank, r.nickname, r.score]), [[11, "P11", 90], [12, "P12", 89]]);
	assert.deepEqual(out.below.map((r) => [r.rank, r.nickname, r.score]), [[14, "P14", 87], [15, "P15", 86]]);
	assert.ok([...out.above, ...out.below].every((r) => !("device" in r)));
});

test("a player shows once, at their best, however many games they've played", async () => {
	const { env, db } = fakeEnv();
	for (let i = 0; i < 12; i++) add(db, `d${i}`, 100 - i, `P${i + 1}`);
	add(db, "d0", 60, "P1"); // P1's lower games, right next to the score asked about
	add(db, "d0", 59, "P1");
	add(db, "x", 61, "Near");
	const out = await around(env, 58);
	assert.equal(out.rank, 14); // 12 players and Near are better
	assert.deepEqual(out.above.map((r) => r.nickname), ["P12", "Near"]); // not P1 at 60 or 59
	assert.equal(out.above.at(-1)?.score, 61);
});

test("Around the World: the fastest time is best", async () => {
	const { env, db } = fakeEnv();
	for (let i = 0; i < 6; i++) add(db, `d${i}`, 300 + i * 10, `P${i + 1}`, { mode: "around" });
	const out = await around(env, 325, "around");
	assert.equal(out.rank, 4);
	assert.deepEqual(out.above.map((r) => r.score), [310, 320]);
	assert.deepEqual(out.below.map((r) => r.score), [330, 340]);
});

test("game over: a new best lands with two above and two below; an earlier best that stays sends no board", async () => {
	const { env, db } = fakeEnv();
	for (let i = 0; i < 10; i++) add(db, `d${i}`, 100 - i * 2, `P${i + 1}`);
	const out = await preview(env, 93); // between 94 (P4) and 92 (P5)
	assert.equal(out.kept, false);
	assert.equal(out.rank, 5);
	assert.deepEqual(out.board.map((r) => (r.you ? "you" : r.rank)), [3, 4, "you", 5 + 1, 6 + 1]);
	add(db, await hash(env, `device:${ME}`), 99, "Me");
	const again = await preview(env, 50);
	assert.equal(again.kept, true);
	assert.deepEqual(again.board, []);
});

test("game over near the top: more below to make five", async () => {
	const { env, db } = fakeEnv();
	for (let i = 0; i < 10; i++) add(db, `d${i}`, 100 - i * 2, `P${i + 1}`);
	const out = await preview(env, 101);
	assert.equal(out.rank, 1);
	assert.deepEqual(out.board.map((r) => (r.you ? "you" : r.rank)), ["you", 2, 3, 4, 5]);
});
