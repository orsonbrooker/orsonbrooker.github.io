// Top teams (worker/src/teams.ts): which team a game is saved for, how a team's score adds up, which
// teams show, and the `teams` flag.
// Run: npm --prefix worker test
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { teamNameOf } from "../../shared/teams.js";
import { cacheKey } from "../src/cache.ts";
import { forgetFlags } from "../src/flags.ts";
import { HttpError } from "../src/http.ts";
import { featureFrom, postScore } from "../src/scores.ts";
import { teamBoard, teamForScore, teamRows } from "../src/teams.ts";
import { hash, forgetBlockedNames } from "../src/util.ts";
import { fakeEnv } from "./fake-d1.ts";

// The robot check always passes here.
globalThis.fetch = (async () => new Response(JSON.stringify({ success: true }))) as typeof fetch;

beforeEach(() => {
	forgetFlags();
	forgetBlockedNames();
});

const NOW = "datetime('now')";
let tokens = 0;
function addScore(db: DatabaseSync, o: { device?: string; player?: string; score: number; team: string | null; mode?: string; status?: string; at?: string }) {
	db.prepare(
		`INSERT INTO scores (nickname, score, player, shots, made, threes, real_seconds, log, flags, status, token, device, ip_hash, mode, team, created_at)
		 VALUES ('Ace', ?, ?, 10, 5, 0, 60, '[]', '[]', ?, ?, ?, 'ip', ?, ?, ${o.at ? "?" : NOW})`,
	).run(o.score, o.player ?? "orson", o.status ?? "shown", `t${++tokens}`, o.device ?? "dev-a", o.mode ?? "timed", o.team, ...(o.at ? [o.at] : []));
}
function addPlayer(db: DatabaseSync, team: string, status = "approved"): number {
	const row = db
		.prepare(
			"INSERT INTO players (name, base, skin, hair, jersey, team, shoes, team_name, status, ip_hash) VALUES ('Kid', 'spiky', '#111111', '#222222', '#123456', '#abcdef', '#333333', ?, ?, 'ip') RETURNING id",
		)
		.get(team, status) as { id: number };
	return row.id;
}
const flagOn = (db: DatabaseSync) => db.prepare("INSERT INTO flags (key, enabled) VALUES ('teams', 1)").run();
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

test("team names are tidied like the builder's", () => {
	assert.equal(teamNameOf(" ilove  food! "), "ILOVE FOOD");
	assert.equal(teamNameOf("supercalifragilistic"), "SUPERCALIF");
	assert.equal(teamNameOf(null), "");
});

test("which team a game is for: Orson is KINGS, approved players wear theirs, own players are checked", async () => {
	const { env, db } = fakeEnv();
	const harpar = addPlayer(db, "ILOVEFOOD");
	const waiting = addPlayer(db, "SEAHAWKS", "new");
	assert.equal(await teamForScore(env, "orson", "DRAGONS"), "KINGS"); // what's sent doesn't matter
	assert.equal(await teamForScore(env, `p${harpar}`, "DRAGONS"), "ILOVEFOOD");
	assert.equal(await teamForScore(env, `p${waiting}`, "SEAHAWKS"), null); // not approved
	assert.equal(await teamForScore(env, "p999", null), null);
	assert.equal(await teamForScore(env, "me1700000000000", "sharks"), "SHARKS");
	assert.equal(await teamForScore(env, "me1700000000000", undefined), "KINGS");
	assert.equal(await teamForScore(env, "me1700000000000", "shit team"), null); // the rude-word filter
});

test("a sent game is saved with its team", async () => {
	const { env, db } = fakeEnv();
	const started = Date.now() - 20000;
	const token = `${started}.abcdefgh.${await hash(env, `game:${started}.abcdefgh`)}`;
	const res = await postScore(
		new Request("http://localhost/api/scores", {
			method: "POST",
			headers: { "CF-Connecting-IP": "203.0.113.4" },
			body: JSON.stringify({ token, mode: "survival", score: 4, shots: [[0.5, 0, 1, 0, 0], [2, 0, 1, 0, 0], [3.5, 0, 0, 0, 0]], nickname: "Ace", device: "d".repeat(32), player: "me1700000000001", team: "comets", turnstileToken: "ok" }),
		}),
		env,
	);
	assert.equal(res.status, 200);
	assert.equal((db.prepare("SELECT team FROM scores").get() as { team: string }).team, "COMETS");
});

test("a team's 3 best players add up, each player once, at their best", async () => {
	const { env, db } = fakeEnv();
	// KINGS: lots of players, but only the best 3 count. Orson played on two devices counts once.
	addScore(db, { player: "orson", device: "a", score: 30, team: "KINGS" });
	addScore(db, { player: "orson", device: "b", score: 28, team: "KINGS" });
	for (const [i, s] of [10, 9, 8, 7, 6].entries()) addScore(db, { player: `me${i + 1}`, device: `k${i}`, score: s, team: "KINGS" });
	// SHARKS: three good players beat KINGS' 30 + 10 + 9.
	addScore(db, { player: "me7", device: "s1", score: 20, team: "SHARKS" });
	addScore(db, { player: "me7", device: "s2", score: 19, team: "SHARKS" }); // a different kid's "me7"
	addScore(db, { player: "me8", device: "s3", score: 15, team: "SHARKS" });
	// DRAGONS: one great player.
	addScore(db, { player: "me9", device: "d1", score: 45, team: "DRAGONS" });
	const rows = await teamRows(env, "timed", true);
	assert.deepEqual(
		rows.map((r) => [r.rank, r.name, r.score, r.players.length]),
		[
			[1, "SHARKS", 54, 3],
			[2, "KINGS", 49, 3],
			[3, "DRAGONS", 45, 1],
		],
	);
	assert.deepEqual(rows[1].players.map((p) => p.score), [30, 10, 9]);
	assert.deepEqual(rows[1].kit, { jersey: "#2c3e7a", trim: "#f2f2ef" }); // KINGS' home kit
	// Only that mode's games.
	assert.deepEqual(await teamRows(env, "survival", true), []);
});

test("Around the World: the 3 best times add up, and teams with all 3 come first", async () => {
	const { env, db } = fakeEnv();
	for (const [i, s] of [400, 500, 600].entries()) addScore(db, { player: `me${i}`, device: `x${i}`, score: s, team: "FOXES", mode: "around" });
	addScore(db, { player: "orson", score: 300, team: "KINGS", mode: "around" });
	for (const [i, s] of [450, 450, 450].entries()) addScore(db, { player: `me${i + 5}`, device: `y${i}`, score: s, team: "ROBOTS", mode: "around" });
	const rows = await teamRows(env, "around", true);
	assert.deepEqual(rows.map((r) => [r.name, r.score]), [["ROBOTS", 1350], ["FOXES", 1500], ["KINGS", 300]]);
	assert.equal(rows[0].players[0].score, 450);
});

test("a custom team shows only while an approved player has it, and never a blocked name", async () => {
	const { env, db } = fakeEnv();
	addScore(db, { player: "me1", score: 20, team: "ILOVEFOOD" });
	addScore(db, { player: "me2", device: "b", score: 18, team: "SEAHAWKS" });
	addScore(db, { player: "me3", device: "c", score: 16, team: "NOBODY" });
	addPlayer(db, "ILOVEFOOD");
	const seahawks = addPlayer(db, "SEAHAWKS", "new");
	assert.deepEqual(names(await teamRows(env, "timed", true)), ["ILOVEFOOD"]);
	db.prepare("UPDATE players SET status = 'approved' WHERE id = ?").run(seahawks);
	const rows = await teamRows(env, "timed", true);
	assert.deepEqual(names(rows), ["ILOVEFOOD", "SEAHAWKS"]);
	assert.deepEqual(rows[1].kit, { jersey: "#123456", trim: "#abcdef" }); // the approved player's colours
	// Luke blocks a name: that team goes, even with an approved player.
	db.prepare("INSERT INTO blocked_names (squashed, name) VALUES ('seahawks', 'SEAHAWKS')").run();
	forgetBlockedNames();
	assert.deepEqual(names(await teamRows(env, "timed", true)), ["ILOVEFOOD"]);
});

test("only shown games with a team, from when teams went live", async () => {
	const { env, db } = fakeEnv();
	addScore(db, { score: 50, team: "KINGS", status: "hidden" });
	addScore(db, { player: "me1", score: 40, team: "COMETS", at: "2026-11-01 10:00:00" }); // before teams
	addScore(db, { player: "me3", device: "c", score: 9, team: "FOXES" });
	addScore(db, { player: "me4", device: "d", score: 99, team: null }); // no team
	assert.ok("2026-11-01 10:00:00" < featureFrom("teams"));
	for (const week of [true, false]) assert.deepEqual(names(await teamRows(env, "timed", week)), ["FOXES"]);
});

test("the teams board is refused until the flag is on, and is cached like the boards", async () => {
	const { env, db } = fakeEnv();
	const url = new URL("http://localhost/api/teams?mode=timed&range=week&junk=1");
	await assert.rejects(teamBoard(env, url), (err) => err instanceof HttpError && err.status === 400);
	flagOn(db);
	forgetFlags();
	addScore(db, { score: 12, team: "KINGS" });
	const res = await teamBoard(env, url);
	assert.equal(res.status, 200);
	const out = (await res.json()) as { teams: { name: string }[] };
	assert.deepEqual(names(out.teams), ["KINGS"]);
	assert.equal(cacheKey(new Request(url), url)?.key, "http://localhost/api/teams?mode=timed&range=week");
});
