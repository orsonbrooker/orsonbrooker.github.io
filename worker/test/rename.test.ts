// The admin renaming a leaderboard nickname (renameScores in worker/src/scores.ts), run against a
// real SQLite database built from the migrations (Node's built-in node:sqlite, standing in for D1).
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { renameScores } from "../src/scores.ts";
import { RUDE } from "../src/util.ts";
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
	return { env: { DB: { prepare } } as unknown as Env, db };
}

function addScore(db: DatabaseSync, nickname: string, device: string, player: string, mode: string): number {
	const row = db
		.prepare(
			`INSERT INTO scores (nickname, score, player, shots, made, threes, real_seconds, log, flags, token, device, ip_hash, mode)
			 VALUES (?, 10, ?, 10, 5, 0, 60, '[]', '[]', ?, ?, 'ip', ?) RETURNING id`,
		)
		.get(nickname, player, `token-${Math.random()}`, device, mode) as { id: number };
	return row.id;
}

const nicknames = (db: DatabaseSync) =>
	Object.fromEntries((db.prepare("SELECT id, nickname FROM scores ORDER BY id").all() as { id: number; nickname: string }[]).map((r) => [r.id, r.nickname]));

test("renaming a score renames that device and player's games, in every mode, and no one else's", async () => {
	const { env, db } = fakeEnv();
	const a1 = addScore(db, "Rudey", "dev-a", "orson", "timed");
	const a2 = addScore(db, "Rudey2", "dev-a", "orson", "survival");
	const other = addScore(db, "Moni", "dev-a", "p1", "timed"); // same device, another player
	const b1 = addScore(db, "Rudey", "dev-b", "orson", "timed"); // same name, another device

	const { modes, ids } = await renameScores(env, a1, "  Big   Shot ");
	assert.deepEqual(nicknames(db), { [a1]: "Big Shot", [a2]: "Big Shot", [other]: "Moni", [b1]: "Rudey" });
	assert.deepEqual([...modes].sort(), ["survival", "timed"]);
	assert.deepEqual(ids, [a2, a1]); // newest first
});

test("a new nickname follows the same rules as a player's own", async () => {
	const { env, db } = fakeEnv();
	const id = addScore(db, "Moni", "dev-a", "orson", "timed");
	const rejects = (nickname: unknown, status: number, message: string) =>
		assert.rejects(renameScores(env, id, nickname), (err: Error & { status?: number }) => err.status === status && err.message === message);
	await rejects("", 400, "Pick a nickname with letters and numbers.");
	await rejects("Moni!", 400, "Pick a nickname with letters and numbers.");
	await rejects("b1tch", 400, RUDE);
	await rejects("f u c k", 400, RUDE);
	assert.equal(nicknames(db)[id], "Moni");
	await assert.rejects(renameScores(env, id + 100, "Jude"), (err: Error & { status?: number }) => err.status === 404);
	// Cut to the leaderboard's 12 characters.
	await renameScores(env, id, "Abcdefghijklmnop");
	assert.equal(nicknames(db)[id], "Abcdefghijkl");
});
