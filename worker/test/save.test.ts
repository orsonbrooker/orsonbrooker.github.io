// The rest of saved progress (shared/save.js and how worker/src/progress.ts keeps it): personal bests,
// the daily streak, builder players and the nickname, tidied and merged without losing anything.
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSaves, tidySave } from "../../shared/save.js";
import { claimGame, getProgress, joinCode, pairCode } from "../src/progress.ts";
import { forgetBlockedNames, hash } from "../src/util.ts";
import type { Env } from "../src/util.ts";
import { fakeEnv } from "./fake-d1.ts";

const colours = { skin: "#f6d7c3", hair: "#26222a", jersey: "#d63a3a", team: "#2c3e7a", shoes: "#26222a", number: "7", teamName: "KINGS" };
const player = (id: string, name: string, extra = {}) => ({ id, name, base: "base-1", colours, ...extra });

test("tidying keeps only what's known, in the right shapes", () => {
	const s = tidySave({
		bests: { timed: 42, survival: -3, around: 23.4, threes: "lots", golf: 9 },
		daily: { done: "2026-11-09", last: "yesterday", days: 4 },
		players: [player("me1", "Zip"), player("me2", "<b>bad</b>"), player("x9", "Nope"), { id: "me3", name: "Odd", base: "base-1", colours: { skin: "red" } }, player("me1", "Again")],
		gone: ["me5", "me5", "nope"],
		nickname: { name: "  Hoops   King  ", at: 1000 },
		extra: "dropped",
	});
	assert.deepEqual(s.bests, { timed: 42, survival: 0, around: 23.4, threes: 0 });
	assert.deepEqual(s.daily, { done: "2026-11-09", last: "", days: 0 });
	assert.deepEqual(
		s.players.map((p) => p.name),
		["Zip"],
	);
	assert.deepEqual(s.gone, ["me5"]);
	assert.deepEqual(s.nickname, { name: "Hoops King", at: 1000 });
	assert.equal("extra" in s, false);
	assert.deepEqual(tidySave(null), tidySave({}));
});

test("merging: the better best (fastest for Around the World), the latest streak, the latest nickname", () => {
	const a = tidySave({ bests: { timed: 40, around: 30 }, daily: { done: "2026-11-08", last: "2026-11-08", days: 3 }, nickname: { name: "Ace", at: 200 } });
	const b = tidySave({ bests: { timed: 55, survival: 9, around: 25 }, daily: { done: "2026-11-09", last: "2026-11-09", days: 1 }, nickname: { name: "Bo", at: 100 } });
	const m = mergeSaves(a, b);
	assert.deepEqual(m.bests, { timed: 55, survival: 9, around: 25, threes: 0 });
	assert.deepEqual(m.daily, { done: "2026-11-09", last: "2026-11-09", days: 1 });
	assert.deepEqual(m.nickname, { name: "Ace", at: 200 });
	// No best on one side isn't "faster".
	assert.equal(mergeSaves(tidySave({ bests: { around: 0 } }), tidySave({ bests: { around: 31 } })).bests.around, 31);
	// The same day: the longer streak.
	const same = mergeSaves(tidySave({ daily: { last: "2026-11-09", days: 2 } }), tidySave({ daily: { last: "2026-11-09", days: 5 } }));
	assert.equal(same.daily.days, 5);
});

test("merging players: both devices', newest first, removed ones stay gone, one per name", () => {
	const a = tidySave({ players: [player("me300", "Zip"), player("me100", "Dot")], gone: ["me200"] });
	const b = tidySave({ players: [player("me200", "Old"), player("me250", "Zip"), player("me400", "New")] });
	const m = mergeSaves(a, b);
	assert.deepEqual(
		m.players.map((p) => p.id),
		["me400", "me300", "me100"],
	);
	assert.deepEqual(m.gone, ["me200"]);
	// Never more than 6.
	const many = tidySave({ players: Array.from({ length: 6 }, (_, i) => player(`me${i + 1}`, `P${i}`)) });
	const more = tidySave({ players: Array.from({ length: 6 }, (_, i) => player(`me${i + 10}`, `Q${i}`)) });
	assert.equal(mergeSaves(many, more).players.length, 6);
});

// ---------- On the server ----------

type Out = { key?: string; coins: number; code?: string; save: ReturnType<typeof tidySave> };
const call = async (route: (r: Request, e: Env) => Promise<Response>, env: Env, body: unknown, ip = "203.0.113.5"): Promise<Out> => {
	const request = new Request("http://localhost/api/progress", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });
	return (await route(request, env)).json() as Promise<Out>;
};
let nonce = 0;
async function game(env: Env) {
	const started = Date.now() - 20000;
	const n = `s${++nonce}`.padEnd(8, "0");
	const token = `${started}.${n}.${await hash(env, `game:${started}.${n}`)}`;
	return { token, mode: "survival", score: 4, shots: [[0.5, 0, 1, 0, 0], [2, 0, 1, 0, 0], [3.5, 0, 0, 0, 0]] };
}

test("the server keeps each device's save, merged, and sends it back", async () => {
	const { env } = fakeEnv();
	const first = await call(claimGame, env, { ...(await game(env)), save: { bests: { survival: 12 }, players: [player("me1", "Zip")] } });
	assert.equal(first.save.bests.survival, 12);
	// A worse best from this device later doesn't lower it; a new player adds to the list.
	const next = await call(getProgress, env, { key: first.key, save: { bests: { survival: 3, timed: 20 }, players: [player("me2", "Dot")] } });
	assert.deepEqual(next.save.bests, { timed: 20, survival: 12, around: 0, threes: 0 });
	assert.deepEqual(
		next.save.players.map((p) => p.name),
		["Dot", "Zip"],
	);
	// Without a save it just reads.
	assert.deepEqual((await call(getProgress, env, { key: first.key })).save, next.save);
});

test("rude names never get saved", async () => {
	const { env } = fakeEnv();
	const out = await call(claimGame, env, { ...(await game(env)), save: { players: [player("me1", "Sh1t"), player("me2", "Zip")], nickname: { name: "Sh1t", at: 5 } } });
	assert.deepEqual(
		out.save.players.map((p) => p.name),
		["Zip"],
	);
	assert.equal(out.save.nickname.name, "");
});

test("names Luke has blocked never get saved either", async () => {
	const { env, db } = fakeEnv();
	db.exec("INSERT INTO blocked_names (squashed, name) VALUES ('poohead', 'Poo Head')");
	forgetBlockedNames(); // the list is kept for a minute per Worker
	const out = await call(claimGame, env, { ...(await game(env)), save: { players: [player("me1", "PooHead2"), player("me2", "Zip")], nickname: { name: "Mr PooHead", at: 5 } } });
	assert.deepEqual(
		out.save.players.map((p) => p.name),
		["Zip"],
	);
	assert.equal(out.save.nickname.name, "");
	forgetBlockedNames();
});

test("joining with a code brings the whole save together", async () => {
	const { env } = fakeEnv();
	const a = await call(claimGame, env, { ...(await game(env)), save: { bests: { timed: 30 }, daily: { last: "2026-11-08", days: 4 }, players: [player("me1", "Zip")], nickname: { name: "Ace", at: 100 } } });
	const b = await call(claimGame, env, { ...(await game(env)), save: { bests: { timed: 45, around: 28 }, players: [player("me2", "Dot")] } }, "198.51.100.7");
	const { code } = await call(pairCode, env, { key: a.key });
	const joined = await call(joinCode, env, { key: b.key, code, save: { nickname: { name: "Bo", at: 300 } } }, "198.51.100.7");
	assert.deepEqual(joined.save.bests, { timed: 45, survival: 0, around: 28, threes: 0 });
	assert.deepEqual(joined.save.daily, { done: "", last: "2026-11-08", days: 4 });
	assert.deepEqual(joined.save.players.map((p) => p.name).sort(), ["Dot", "Zip"]);
	assert.equal(joined.save.nickname.name, "Bo");
	// A brand-new device (no key) joining brings its save too.
	const { code: code2 } = await call(pairCode, env, { key: a.key });
	const fresh = await call(joinCode, env, { code: code2, save: { players: [player("me3", "Neo")] } }, "198.51.100.9");
	assert.deepEqual(fresh.save.players.map((p) => p.name).sort(), ["Dot", "Neo", "Zip"]);
	assert.deepEqual((await call(getProgress, env, { key: a.key })).save, fresh.save);
});
