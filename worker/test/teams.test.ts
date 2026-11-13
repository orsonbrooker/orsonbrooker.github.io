// Teams (worker/src/teams.ts): making community teams, codes, joining and leaving, which team a game is
// saved for, how a team's score adds up, which teams show (and to whom), the admin's changes, pairing,
// and the `teams` flag.
// Run: npm --prefix worker test
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { teamNameOf } from "../../shared/teams.js";
import { cacheKey } from "../src/cache.ts";
import { forgetFlags } from "../src/flags.ts";
import { HttpError } from "../src/http.ts";
import { claimGame, joinCode, pairCode } from "../src/progress.ts";
import { boardOf, featureFrom, postScore } from "../src/scores.ts";
import { editTeam, teamForScore, teamRoute, teamRows } from "../src/teams.ts";
import { forgetBlockedNames, hash } from "../src/util.ts";
import type { Env } from "../src/util.ts";
import { fakeEnv } from "./fake-d1.ts";

// The robot check passes unless the token is "bad".
globalThis.fetch = (async (_url: unknown, init?: { body?: FormData }) =>
	new Response(JSON.stringify({ success: init?.body?.get("response") !== "bad" }))) as typeof fetch;

beforeEach(() => {
	forgetFlags();
	forgetBlockedNames();
});

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const GREEN = { jersey: "#3fa65c", shorts: "#3fa65c", trim: "#f2f2ef" };
const WHITE = { jersey: "#f2f2ef", shorts: "#3fa65c", trim: "#3fa65c" };

type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Failed = Error & { status?: number };

function setup(flag = true) {
	const { env, db } = fakeEnv();
	if (flag) db.prepare("INSERT INTO flags (key, enabled) VALUES ('teams', 1)").run();
	return { env, db };
}

let ips = 0;
/** Calls a teams route as the app would, from its own IP unless one is given. Throws on an error answer. */
async function call(env: Env, method: string, path: string, body?: unknown, ip = `198.51.100.${++ips % 250}`): Promise<Out> {
	const url = new URL(`http://localhost${path}`);
	const req = new Request(url, { method, headers: { "CF-Connecting-IP": ip }, body: body === undefined ? undefined : JSON.stringify(body) });
	const res = await teamRoute(req, env, url);
	if (!res) throw new Error(`no route for ${method} ${path}`);
	return res.json() as Promise<Out>;
}
const make = (env: Env, device: string, name: string, ip?: string) => call(env, "POST", "/api/teams", { device, name, home: GREEN, away: WHITE, turnstileToken: "ok" }, ip);
const join = (env: Env, device: string, code: string, ip?: string) => call(env, "POST", "/api/teams/join", { device, code }, ip);
const mine = async (env: Env, device: string) => (await call(env, "POST", "/api/teams/mine", { device })).teams as Out[];

let tokens = 0;
function addScore(db: DatabaseSync, o: { device?: string; player?: string; score: number; team: string | null; mode?: string; status?: string; at?: string; nickname?: string }) {
	db.prepare(
		`INSERT INTO scores (nickname, score, player, shots, made, threes, real_seconds, log, flags, status, token, device, ip_hash, mode, team, created_at)
		 VALUES (?, ?, ?, 10, 5, 0, 60, '[]', '[]', ?, ?, ?, 'ip', ?, ?, ${o.at ? "?" : "datetime('now')"})`,
	).run(o.nickname ?? "Ace", o.score, o.player ?? "orson", o.status ?? "shown", `t${++tokens}`, o.device ?? "dev-a", o.mode ?? "timed", o.team, ...(o.at ? [o.at] : []));
}
function addPlayer(db: DatabaseSync, team: string, status = "approved"): number {
	return (
		db
			.prepare(
				"INSERT INTO players (name, base, skin, hair, jersey, team, shoes, team_name, status, ip_hash) VALUES ('Kid', 'spiky', '#111111', '#222222', '#123456', '#abcdef', '#333333', ?, ?, 'ip') RETURNING id",
			)
			.get(team, status) as { id: number }
	).id;
}
const names = (rows: { name: string }[]) => rows.map((r) => r.name);
const rejects = (p: Promise<unknown>, status: number, text?: RegExp) =>
	assert.rejects(p, (err: Failed) => err instanceof HttpError && err.status === status && (!text || text.test(err.message)));

test("team names are tidied like the builder's", () => {
	assert.equal(teamNameOf(" ilove  food! "), "ILOVE FOOD");
	assert.equal(teamNameOf("supercalifragilistic"), "SUPERCALIF");
	assert.equal(teamNameOf(null), "");
});

test("every teams route is refused while the flag is off", async () => {
	const { env } = setup(false);
	await rejects(call(env, "GET", "/api/teams?mode=timed"), 400);
	await rejects(call(env, "GET", "/api/teams/list"), 400);
	await rejects(call(env, "GET", "/api/teams/KINGS/players"), 400);
	await rejects(make(env, A, "HOOPERS"), 400);
	await rejects(join(env, A, "ABCD-EFGH"), 400);
	await rejects(call(env, "POST", "/api/teams/mine", { device: A }), 400);
});

test("making a team: private, the maker is on it, and the code joins it", async () => {
	const { env, db } = setup();
	const made = await make(env, A, " hoopers! ");
	assert.equal(made.team.name, "HOOPERS");
	assert.equal(made.team.maker, true);
	assert.equal(made.team.listing, "private");
	assert.match(made.code, /^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
	// Only a hash of the code is kept.
	const row = db.prepare("SELECT * FROM community_teams").get() as Record<string, string>;
	assert.ok(!Object.values(row).some((v) => String(v).includes(made.code.replace("-", ""))));
	// A friend types it (any case, with or without the dash).
	const joined = await join(env, B, made.code.toLowerCase().replace("-", ""));
	assert.equal(joined.team.name, "HOOPERS");
	assert.equal(joined.team.maker, undefined); // the friend can't change it
	assert.deepEqual(names(await mine(env, B)), ["HOOPERS"]);
	// A private team isn't listed and has no public ranking.
	assert.deepEqual((await call(env, "GET", "/api/teams/list")).teams, []);
	await rejects(call(env, "GET", `/api/teams/${made.team.key}/players`), 404);
});

test("making a team: the robot check, friendly names, 3 per device, and a daily limit per IP", async () => {
	const { env } = setup();
	await rejects(call(env, "POST", "/api/teams", { device: A, name: "HOOPERS", home: GREEN, away: WHITE, turnstileToken: "bad" }), 400, /robot/);
	await rejects(make(env, A, "shit team"), 400, /friendly/);
	await rejects(make(env, A, "!!!"), 400, /name/);
	await rejects(call(env, "POST", "/api/teams", { device: A, name: "HOOPERS", home: { jersey: "red" }, away: WHITE, turnstileToken: "ok" }), 400, /colours/);
	for (const n of ["ONE", "TWO", "THREE"]) await make(env, A, n);
	await rejects(make(env, A, "FOUR"), 400, /3 teams/);
	// One IP: 5 a day, whichever devices.
	const ip = "203.0.113.9";
	for (const n of ["A1", "A2", "A3"]) await make(env, B, n, ip);
	for (const n of ["A4", "A5"]) await make(env, C, n, ip);
	await rejects(make(env, "d".repeat(32), "A6", ip), 429);
});

test("codes: a wrong one fails, 15 tries a day per IP, and a new code stops the old one", async () => {
	const { env } = setup();
	const made = await make(env, A, "HOOPERS");
	await rejects(join(env, B, "ZZZZ-ZZZZ"), 400, /didn't work/);
	await rejects(join(env, B, "SHORT"), 400, /8 letters/);
	const ip = "203.0.113.20";
	for (let i = 0; i < 15; i++) await rejects(join(env, B, "ZZZZ-ZZZZ", ip), 400);
	await rejects(join(env, B, made.code, ip), 429); // even the right one, until tomorrow
	// Only the maker can get a new code.
	await rejects(call(env, "POST", `/api/teams/${made.team.id}`, { device: B, action: "code" }), 404);
	const fresh = await call(env, "POST", `/api/teams/${made.team.id}`, { device: A, action: "code" });
	assert.notEqual(fresh.code, made.code);
	await rejects(join(env, C, made.code), 400);
	assert.equal((await join(env, C, fresh.code)).team.name, "HOOPERS");
});

test("leaving a team, and a hidden team is gone for its members", async () => {
	const { env, db } = setup();
	const made = await make(env, A, "HOOPERS");
	await join(env, B, made.code);
	await call(env, "POST", "/api/teams/leave", { device: B, id: made.team.id });
	assert.deepEqual(await mine(env, B), []);
	await join(env, B, made.code); // and back again
	await editTeam(env, made.team.id, { action: "hide" }, "http://localhost");
	assert.deepEqual(await mine(env, B), []);
	assert.deepEqual(await mine(env, A), []);
	await rejects(join(env, C, made.code), 400);
	db.prepare("UPDATE community_teams SET status = 'ok'").run();
	assert.deepEqual(names(await mine(env, B)), ["HOOPERS"]);
});

test("which team a game is saved for: Orson, own players, members only, and approved players' official teams", async () => {
	const { env, db } = setup();
	const hA = await boardOf(env, A);
	const hB = await boardOf(env, B);
	const made = await make(env, A, "HOOPERS");
	const comets = addPlayer(db, "COMETS");
	const ilovefood = addPlayer(db, "ILOVEFOOD");
	const waiting = addPlayer(db, "SHARKS", "new");
	assert.equal(await teamForScore(env, "orson", "DRAGONS", made.team.key, hA), "KINGS"); // what's sent doesn't matter
	assert.equal(await teamForScore(env, `p${comets}`, "DRAGONS", null, hA), "COMETS");
	assert.equal(await teamForScore(env, `p${ilovefood}`, null, null, hA), null); // not an official team
	assert.equal(await teamForScore(env, `p${waiting}`, null, null, hA), null); // not approved
	assert.equal(await teamForScore(env, "me1", "sharks", undefined, hA), "SHARKS");
	assert.equal(await teamForScore(env, "me1", undefined, undefined, hA), "KINGS"); // an older game
	assert.equal(await teamForScore(env, "me1", "MY TEAM", undefined, hA), null); // a team only on the device
	assert.equal(await teamForScore(env, "me1", "HOOPERS", made.team.key, hA), made.team.key);
	// B isn't on it: the game counts for the official team they'd wear, or none.
	assert.equal(await teamForScore(env, "me1", "HOOPERS", made.team.key, hB), null);
	await join(env, B, made.code);
	assert.equal(await teamForScore(env, "me1", "HOOPERS", made.team.key, hB), made.team.key);
	await editTeam(env, made.team.id, { action: "hide" }, "http://localhost");
	assert.equal(await teamForScore(env, "me1", "HOOPERS", made.team.key, hB), null);
});

test("a sent game is saved with its team", async () => {
	const { env, db } = setup();
	const made = await make(env, A, "HOOPERS");
	const started = Date.now() - 20000;
	const token = `${started}.abcdefgh.${await hash(env, `game:${started}.abcdefgh`)}`;
	const res = await postScore(
		new Request("http://localhost/api/scores", {
			method: "POST",
			headers: { "CF-Connecting-IP": "203.0.113.4" },
			body: JSON.stringify({ token, mode: "survival", score: 4, shots: [[0.5, 0, 1, 0, 0], [2, 0, 1, 0, 0], [3.5, 0, 0, 0, 0]], nickname: "Ace", device: A, player: "me1700000000001", team: "HOOPERS", teamId: made.team.key, turnstileToken: "ok" }),
		}),
		env,
	);
	assert.equal(res.status, 200);
	assert.equal((db.prepare("SELECT team FROM scores").get() as { team: string }).team, made.team.key);
});

test("Top teams: the 3 best devices add up, one device counts once whoever it played as", async () => {
	const { env, db } = setup();
	// KINGS: Orson on two devices counts twice (two kids); one device's other players don't add more.
	addScore(db, { player: "orson", device: "a", score: 30, team: "KINGS" });
	addScore(db, { player: "me1", device: "a", score: 29, team: "KINGS" }); // same device: only its best counts
	addScore(db, { player: "orson", device: "b", score: 28, team: "KINGS" });
	for (const [i, s] of [10, 9, 8].entries()) addScore(db, { player: `me${i + 2}`, device: `k${i}`, score: s, team: "KINGS" });
	// SHARKS: three good devices beat KINGS' 30 + 28 + 10.
	for (const [i, s] of [25, 24, 22].entries()) addScore(db, { player: "me7", device: `s${i}`, score: s, team: "SHARKS" });
	// DRAGONS: one great player.
	addScore(db, { player: "me9", device: "d1", score: 45, team: "DRAGONS" });
	const rows = await teamRows(env, "timed", true);
	assert.deepEqual(
		rows.map((r) => [r.rank, r.name, r.kind, r.score]),
		[
			[1, "SHARKS", "official", 71],
			[2, "KINGS", "official", 68],
			[3, "DRAGONS", "official", 45],
		],
	);
	assert.deepEqual(rows[1].top, { player: "orson", base: null, colours: null }); // the top player's face
	assert.deepEqual(rows[1].kit, { jersey: "#2c3e7a", shorts: "#2c3e7a", trim: "#f2f2ef" }); // KINGS' home kit
	assert.deepEqual(await teamRows(env, "survival", true), []); // only that mode's games
	// KINGS' ranking: each device once, top 3 marked, nicknames as on the players' board.
	const { players } = await call(env, "GET", "/api/teams/kings/players?mode=timed");
	assert.deepEqual(
		players.map((p: Out) => [p.score, p.counts]),
		[[30, true], [28, true], [10, true], [9, false], [8, false]],
	);
});

test("Around the World: the 3 best times add up, and teams with all 3 come first", async () => {
	const { env, db } = setup();
	for (const [i, s] of [400, 500, 600].entries()) addScore(db, { player: `me${i}`, device: `x${i}`, score: s, team: "FOXES", mode: "around" });
	addScore(db, { player: "orson", score: 300, team: "KINGS", mode: "around" });
	for (const [i, s] of [450, 450, 450].entries()) addScore(db, { player: `me${i + 5}`, device: `y${i}`, score: s, team: "ROBOTS", mode: "around" });
	const rows = await teamRows(env, "around", true);
	assert.deepEqual(rows.map((r) => [r.name, r.score]), [["ROBOTS", 1350], ["FOXES", 1500], ["KINGS", 300]]);
});

test("community teams show once listed; a private team's rank is only for its members", async () => {
	const { env, db } = setup();
	const hoopers = await make(env, A, "HOOPERS");
	const secret = await make(env, B, "SECRET");
	addScore(db, { device: await boardOf(env, A), player: "me1", score: 40, team: hoopers.team.key });
	addScore(db, { device: await boardOf(env, B), player: "me2", score: 30, team: secret.team.key });
	addScore(db, { player: "orson", score: 20, team: "KINGS" });
	assert.deepEqual(names(await teamRows(env, "timed", true)), ["KINGS"]);
	// The maker asks; it shows once Luke lists it.
	const asked = await call(env, "POST", `/api/teams/${hoopers.team.id}`, { device: A, action: "list", turnstileToken: "ok" });
	assert.equal(asked.team.listing, "asked");
	assert.deepEqual(names(await teamRows(env, "timed", true)), ["KINGS"]);
	await editTeam(env, hoopers.team.id, { action: "list" }, "http://localhost");
	const rows = await teamRows(env, "timed", true);
	assert.deepEqual(rows.map((r) => [r.name, r.kind]), [["HOOPERS", "community"], ["KINGS", "official"]]);
	assert.deepEqual((await call(env, "GET", "/api/teams/list")).teams.map((t: Out) => [t.name, t.members]), [["HOOPERS", 1]]);
	assert.equal((await call(env, "GET", `/api/teams/${hoopers.team.key}/players?mode=timed`)).players.length, 1);
	// A listed team can be joined without its code; a private one can't.
	assert.equal((await call(env, "POST", "/api/teams/join", { device: C, id: hoopers.team.id })).team.name, "HOOPERS");
	await rejects(call(env, "POST", "/api/teams/join", { device: C, id: secret.team.id }), 404);
	// SECRET's members see where it would be (2nd, between HOOPERS and KINGS); nobody else can.
	const standing = await call(env, "POST", "/api/teams/players", { device: B, key: secret.team.key, mode: "timed" });
	assert.equal(standing.rank, 2);
	assert.equal(standing.players[0].nickname, "Ace");
	await rejects(call(env, "POST", "/api/teams/players", { device: C, key: secret.team.key, mode: "timed" }), 404);
	// Unlisting takes it off again.
	await call(env, "POST", `/api/teams/${hoopers.team.id}`, { device: A, action: "unlist" });
	assert.deepEqual(names(await teamRows(env, "timed", true)), ["KINGS"]);
});

test("listed names are unique; renaming a listed team waits for Luke again; blocked names never show", async () => {
	const { env, db } = setup();
	const one = await make(env, A, "HOOPERS");
	const two = await make(env, B, "HOOPERS"); // private teams can share a name
	const kings = await make(env, C, "KINGS");
	await editTeam(env, one.team.id, { action: "list" }, "http://localhost");
	await rejects(call(env, "POST", `/api/teams/${two.team.id}`, { device: B, action: "list", turnstileToken: "ok" }), 400, /already a team/);
	await rejects(call(env, "POST", `/api/teams/${kings.team.id}`, { device: C, action: "list", turnstileToken: "ok" }), 400, /already a team/);
	await rejects(editTeam(env, two.team.id, { action: "list" }, "http://localhost"), 400);
	// Not this name: it stays private, and the maker sees why.
	await call(env, "POST", `/api/teams/${two.team.id}`, { device: B, action: "name", name: "BALLERS", turnstileToken: "ok" });
	await call(env, "POST", `/api/teams/${two.team.id}`, { device: B, action: "list", turnstileToken: "ok" });
	await editTeam(env, two.team.id, { action: "refuse" }, "http://localhost");
	assert.equal((await mine(env, B))[0].listing, "refused");
	// Renaming a listed team: off the board until Luke OKs the new name.
	const renamed = await call(env, "POST", `/api/teams/${one.team.id}`, { device: A, action: "name", name: "NEW NAME", turnstileToken: "ok" });
	assert.equal(renamed.team.listing, "asked");
	await rejects(call(env, "POST", `/api/teams/${one.team.id}`, { device: A, action: "name", name: "shit team", turnstileToken: "ok" }), 400, /friendly/);
	// A listed name Luke later blocks disappears.
	await editTeam(env, one.team.id, { action: "list" }, "http://localhost");
	addScore(db, { device: await boardOf(env, A), player: "me1", score: 40, team: one.team.key });
	assert.deepEqual(names(await teamRows(env, "timed", true)), ["NEW NAME"]);
	db.prepare("INSERT INTO blocked_names (squashed, name) VALUES ('newname', 'NEW NAME')").run();
	forgetBlockedNames();
	assert.deepEqual(names(await teamRows(env, "timed", true)), []);
});

test("only shown games with a team, from when teams went live, and switching never moves old games", async () => {
	const { env, db } = setup();
	addScore(db, { score: 50, team: "KINGS", status: "hidden" });
	addScore(db, { player: "me1", score: 40, team: "COMETS", at: "2026-11-01 10:00:00" }); // before teams
	addScore(db, { player: "me3", device: "c", score: 9, team: "FOXES" });
	addScore(db, { player: "me3", device: "c", score: 12, team: "SHARKS" }); // the same kid, after switching
	addScore(db, { player: "me4", device: "d", score: 99, team: null }); // no team
	assert.ok("2026-11-01 10:00:00" < featureFrom("teams"));
	for (const week of [true, false]) assert.deepEqual((await teamRows(env, "timed", week)).map((r) => [r.name, r.score]), [["SHARKS", 12], ["FOXES", 9]]);
});

test("pairing a device brings its teams along", async () => {
	const { env } = setup();
	const post = async (route: (r: Request, e: Env) => Promise<Response>, body: unknown, ip: string) =>
		(await route(new Request("http://localhost/api/progress", { method: "POST", headers: { "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), env)).json() as Promise<Out>;
	let nonce = 0;
	const game = async () => {
		const started = Date.now() - 20000;
		const n = `t${++nonce}`.padEnd(8, "0");
		return { token: `${started}.${n}.${await hash(env, `game:${started}.${n}`)}`, mode: "survival", score: 4, shots: [[0.5, 0, 1, 0, 0], [2, 0, 1, 0, 0], [3.5, 0, 0, 0, 0]] };
	};
	const a = await post(claimGame, { ...(await game()), device: A }, "203.0.113.30");
	// B made a team and is on a friend's, before joining A.
	const theirs = await make(env, B, "MINE");
	const friend = await make(env, C, "FRIENDS");
	await join(env, B, friend.code);
	const { code } = await post(pairCode, { key: a.key }, "203.0.113.30");
	await post(joinCode, { code, device: B }, "203.0.113.31");
	assert.equal(await boardOf(env, B), await boardOf(env, A));
	assert.deepEqual(names(await mine(env, A)).sort(), ["FRIENDS", "MINE"]);
	assert.equal((await mine(env, A)).find((t) => t.name === "MINE")!.maker, true);
	assert.equal((await call(env, "POST", `/api/teams/${theirs.team.id}`, { device: A, action: "code" })).code.length, 9);
});

test("public team reads are cached like the boards, with only the parameters they read", () => {
	const key = (u: string) => cacheKey(new Request(u), new URL(u))?.key;
	assert.equal(key("http://localhost/api/teams?mode=timed&range=week&junk=1"), "http://localhost/api/teams?mode=timed&range=week");
	assert.equal(key("http://localhost/api/teams/list?x=1"), "http://localhost/api/teams/list");
	assert.equal(key("http://localhost/api/teams/Kings/players?mode=around&range=all&x=2"), "http://localhost/api/teams/KINGS/players?mode=around&range=all");
	assert.equal(key("http://localhost/api/teams/C12/players"), "http://localhost/api/teams/c12/players?mode=timed&range=week");
	assert.equal(key("http://localhost/api/teams/nope/players"), undefined);
});
