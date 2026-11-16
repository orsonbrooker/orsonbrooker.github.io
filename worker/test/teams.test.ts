// Teams (worker/src/teams.ts): making community teams, codes, joining and leaving, which team a game is
// saved for, how a team's score adds up, which teams show (and to whom), the admin's changes and pairing.
// Run: npm --prefix worker test
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { teamCounts, teamNameOf } from "../../shared/teams.js";
import { cacheKey } from "../src/cache.ts";
import { forgetFlags } from "../src/flags.ts";
import { HttpError } from "../src/http.ts";
import { claimGame, joinCode, pairCode } from "../src/progress.ts";
import { boardOf, featureFrom, postScore } from "../src/scores.ts";
import { adminTeams, editTeam, teamForScore, teamRoute, teamRows } from "../src/teams.ts";
import { forgetBlockedNames, hash, isUnfriendly } from "../src/util.ts";
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

function setup() {
	return fakeEnv();
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

test("which teams count on Top teams, so the game needn't ask: community, or an official one the kid picked", () => {
	assert.equal(teamCounts({ teamId: "c4", teamName: "HOOPERS" }), true); // a community team
	assert.equal(teamCounts({ teamName: "SHARKS" }), true); // an official team (not where everyone started)
	assert.equal(teamCounts({ teamName: "KINGS" }), false); // where every player used to start
	assert.equal(teamCounts({ teamName: "KINGS" }, true), true); // picked in the builder
	// A team kept only on the device counts for nothing (the server doesn't know it), even if picked: the
	// builder makes it a real team, and the game asks until then.
	assert.equal(teamCounts({ teamName: "BULLS" }, true), false);
	assert.equal(teamCounts({ teamName: "" }, true), false);
	assert.equal(teamCounts(undefined), false);
});

test("making a team: code to join, the maker is on it, and the code joins it", async () => {
	const { env, db } = setup();
	const made = await make(env, A, " hoopers! ");
	assert.equal(made.team.name, "HOOPERS");
	assert.equal(made.team.maker, true);
	assert.equal(made.team.listing, "private");
	assert.match(made.code, /^T-[2-9A-Z]{4}-[2-9A-Z]{4}$/); // never like a pairing code (ABCD-EFGH)
	// Only a hash of the code is kept.
	const row = db.prepare("SELECT * FROM community_teams").get() as Record<string, string>;
	assert.ok(!Object.values(row).some((v) => String(v).includes(made.code.replace(/-/g, "").slice(1))));
	// A friend types it (any case, with or without the dashes and the T).
	const joined = await join(env, B, made.code.toLowerCase().replace(/-/g, ""));
	assert.equal((await join(env, C, made.code.slice(2))).team.name, "HOOPERS");
	assert.equal(joined.team.name, "HOOPERS");
	assert.equal(joined.team.maker, undefined); // the friend can't change it
	assert.deepEqual(names(await mine(env, B)), ["HOOPERS"]);
	// A code-to-join team isn't in the join list, but its players are public like any team's.
	assert.deepEqual((await call(env, "GET", "/api/teams/list")).teams, []);
	assert.deepEqual((await call(env, "GET", `/api/teams/${made.team.key}/players`)).players, []);
});

test("making a team: the robot check, friendly names, 3 per device, and a daily limit per IP", async () => {
	const { env } = setup();
	await rejects(call(env, "POST", "/api/teams", { device: A, name: "HOOPERS", home: GREEN, away: WHITE, turnstileToken: "bad" }), 400, /robot/);
	await rejects(make(env, A, "shit team"), 400, /friendly/);
	await rejects(make(env, A, "!!!"), 400, /name/);
	await rejects(make(env, A, "kings"), 400, /game's teams/); // it would look like the official one
	await rejects(call(env, "POST", "/api/teams", { device: A, name: "HOOPERS", home: { jersey: "red" }, away: WHITE, turnstileToken: "ok" }), 400, /colours/);
	for (const n of ["ONE", "TWO", "THREE"]) await make(env, A, n);
	await rejects(make(env, A, "FOUR"), 400, /3 teams/);
	// One IP (a school's Wi-Fi): 20 a day, whichever devices.
	const ip = "203.0.113.9";
	for (let i = 0; i < 20; i++) await make(env, `kid${Math.floor(i / 3)}`.padEnd(32, "x"), `HOOP ${String.fromCharCode(65 + i)}`, ip);
	await rejects(make(env, "z".repeat(32), "HOOP Z", ip), 429);
});

test("codes: a wrong one fails, 15 wrong a day per IP, right ones don't count, and a new code stops the old one", async () => {
	const { env } = setup();
	const made = await make(env, A, "HOOPERS");
	await rejects(join(env, B, "ZZZZ-ZZZZ"), 400, /didn't work/);
	await rejects(join(env, B, "SHORT"), 400, /8 letters/);
	// A class joining on one Wi-Fi: right codes don't use up the tries.
	const ip = "203.0.113.20";
	for (let i = 0; i < 20; i++) await join(env, `kid${i}`.padEnd(32, "x"), made.code, ip);
	for (let i = 0; i < 15; i++) await rejects(join(env, B, "ZZZZ-ZZZZ", ip), 400, /didn't work/);
	await rejects(join(env, B, made.code, ip), 429); // after 15 wrong, even the right one, until tomorrow
	// A team code typed where a pairing code goes says where it belongs.
	const pair = new Request("http://localhost/api/progress/join", { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.21" }, body: JSON.stringify({ code: made.code, device: B }) });
	await rejects(joinCode(pair, env), 400, /team code/);
	// Only the maker can get a new code.
	await rejects(call(env, "POST", `/api/teams/${made.team.id}`, { device: B, action: "code" }), 404);
	const fresh = await call(env, "POST", `/api/teams/${made.team.id}`, { device: A, action: "code" });
	assert.notEqual(fresh.code, made.code);
	await rejects(join(env, C, made.code), 400);
	assert.equal((await join(env, C, fresh.code)).team.name, "HOOPERS");
	// Luke can make one too, for a maker whose device lost it.
	const admin = (await (await editTeam(env, made.team.id, { action: "code" }, "http://localhost")).json()) as Out;
	assert.match(admin.code, /^T-/);
	await rejects(join(env, "d".repeat(32), fresh.code), 400);
	assert.equal((await join(env, "d".repeat(32), admin.code)).team.name, "HOOPERS");
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

test("which team a game is saved for: the team the kid chose, whoever they play as; members only", async () => {
	const { env, db } = setup();
	const hA = await boardOf(env, A);
	const hB = await boardOf(env, B);
	const made = await make(env, A, "HOOPERS");
	// Orson, an approved player or their own: whatever team was sent (the device's, or their own player's).
	assert.equal(await teamForScore(env, "sharks", undefined, hA), "SHARKS");
	assert.equal(await teamForScore(env, undefined, undefined, hA), null); // an older game, or no team chosen
	assert.equal(await teamForScore(env, "MY TEAM", undefined, hA), null); // a team only on the device
	assert.equal(await teamForScore(env, "HOOPERS", made.team.key, hA), made.team.key);
	// B isn't on it: the game counts for the official team they'd wear, or none.
	assert.equal(await teamForScore(env, "HOOPERS", made.team.key, hB), null);
	assert.equal(await teamForScore(env, "COMETS", made.team.key, hB), "COMETS");
	await join(env, B, made.code);
	assert.equal(await teamForScore(env, "HOOPERS", made.team.key, hB), made.team.key);
	await editTeam(env, made.team.id, { action: "hide" }, "http://localhost");
	assert.equal(await teamForScore(env, "HOOPERS", made.team.key, hB), null);
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

test("every community team is on Top teams; listing only means anyone can join without a code", async () => {
	const { env, db } = setup();
	const hoopers = await make(env, A, "HOOPERS");
	const secret = await make(env, B, "SECRET");
	addScore(db, { device: await boardOf(env, A), player: "me1", score: 40, team: hoopers.team.key });
	addScore(db, { device: await boardOf(env, B), player: "me2", score: 30, team: secret.team.key });
	addScore(db, { player: "orson", score: 20, team: "KINGS" });
	// Code-to-join teams count straight away, next to the official ones.
	const rows = await teamRows(env, "timed", true);
	assert.deepEqual(rows.map((r) => [r.name, r.kind, r.rank]), [["HOOPERS", "community", 1], ["SECRET", "community", 2], ["KINGS", "official", 3]]);
	assert.ok(rows.every((r) => !("owner" in r) && !("listing" in r))); // never who made it, or how it's joined
	assert.equal((await call(env, "GET", `/api/teams/${secret.team.key}/players?mode=timed`)).players.length, 1);
	// Nobody can join without the code until Luke OKs it.
	assert.deepEqual((await call(env, "GET", "/api/teams/list")).teams, []);
	await rejects(call(env, "POST", "/api/teams/join", { device: C, id: hoopers.team.id }), 404);
	const asked = await call(env, "POST", `/api/teams/${hoopers.team.id}`, { device: A, action: "list", turnstileToken: "ok" });
	assert.equal(asked.team.listing, "asked");
	await rejects(call(env, "POST", "/api/teams/join", { device: C, id: hoopers.team.id }), 404);
	await editTeam(env, hoopers.team.id, { action: "list" }, "http://localhost");
	assert.deepEqual((await call(env, "GET", "/api/teams/list")).teams.map((t: Out) => [t.name, t.members]), [["HOOPERS", 1]]);
	assert.equal((await call(env, "POST", "/api/teams/join", { device: C, id: hoopers.team.id })).team.name, "HOOPERS");
	await rejects(call(env, "POST", "/api/teams/join", { device: C, id: secret.team.id }), 404);
	// Anyone can see a team's rank, below the top 10 too; SECRET's members also see every teammate's name.
	const standing = await call(env, "POST", "/api/teams/players", { device: B, key: secret.team.key, mode: "timed" });
	assert.equal(standing.rank, 2);
	assert.equal(standing.players[0].nickname, "Ace");
	assert.equal((await call(env, "POST", "/api/teams/players", { device: C, key: secret.team.key, mode: "timed" })).rank, 2);
	// Back to code-to-join: still on Top teams, out of the join list.
	await call(env, "POST", `/api/teams/${hoopers.team.id}`, { device: A, action: "unlist" });
	assert.deepEqual(names(await teamRows(env, "timed", true)), ["HOOPERS", "SECRET", "KINGS"]);
	assert.deepEqual((await call(env, "GET", "/api/teams/list")).teams, []);
	// A team Luke hides drops off.
	await editTeam(env, secret.team.id, { action: "hide" }, "http://localhost");
	assert.deepEqual(names(await teamRows(env, "timed", true)), ["HOOPERS", "KINGS"]);
	await rejects(call(env, "GET", `/api/teams/${secret.team.key}/players`), 404);
});

test("a new or renamed team can't take a name another team has (any case); old duplicates keep a number on Top teams", async () => {
	const { env, db } = setup();
	const first = await make(env, A, "GOATS");
	const other = await make(env, B, "HOOPERS");
	// Making one: refused with a friendly message, whatever the case or spacing.
	await rejects(make(env, C, "goats"), 400, /already a team called GOATS\. Try a different name/);
	await rejects(make(env, C, " Hoopers! "), 400, /already a team called HOOPERS/);
	await rejects(make(env, C, "kings"), 400, /game's teams/);
	// Renaming one: the same, but keeping its own name is fine.
	await rejects(call(env, "POST", `/api/teams/${other.team.id}`, { device: B, action: "name", name: "Goats", turnstileToken: "ok" }), 400, /already a team called GOATS/);
	assert.equal((await call(env, "POST", `/api/teams/${other.team.id}`, { device: B, action: "name", name: "hoopers" })).team.name, "HOOPERS");
	// The admin can't rename one onto another's name either.
	await rejects(editTeam(env, other.team.id, { action: "rename", name: "goats" }, "http://localhost"), 400, /already has that name/);
	// Teams that shared a name before the rule (two GOATS live) keep it: the later one has a number.
	const second = await make(env, C, "GOATZ");
	db.prepare("UPDATE community_teams SET name = 'GOATS' WHERE id = ?").run(second.team.id);
	for (const [t, d, score] of [[second, C, 50], [first, A, 40], [other, B, 30]] as const) addScore(db, { device: await boardOf(env, d), player: "me1", score, team: t.team.key });
	const rows = await teamRows(env, "timed", true);
	assert.deepEqual(rows.map((r) => [r.name, r.tag ?? null]), [["GOATS", 2], ["GOATS", null], ["HOOPERS", null]]);
	assert.notEqual(rows[0].kit, undefined); // the kit shows on the row too
	// The first one hidden: the second is the only GOATS left, so no number, and a hidden team's name is free.
	await editTeam(env, first.team.id, { action: "hide" }, "http://localhost");
	assert.deepEqual((await teamRows(env, "timed", true)).map((r) => [r.name, r.tag ?? null]), [["GOATS", null], ["HOOPERS", null]]);
	db.prepare("UPDATE community_teams SET status = 'hidden' WHERE id = ?").run(second.team.id);
	assert.equal((await make(env, "e".repeat(32), "GOATS")).team.name, "GOATS");
});

test("reporting a team's name: once per IP, not by its own members, and the admin's hide, rename or looks fine", async () => {
	const { env, db } = setup();
	const report = (key: string, device: string, ip?: string) => call(env, "POST", "/api/teams/report", { key, device }, ip);
	const open = () => db.prepare("SELECT team_id, COUNT(*) AS n FROM team_reports WHERE cleared = 0 GROUP BY team_id ORDER BY team_id").all() as { team_id: number; n: number }[];
	const rude = await make(env, A, "BADNAME");
	const fine = await make(env, B, "FINE");
	addScore(db, { device: await boardOf(env, A), player: "me1", score: 40, team: rude.team.key });
	await report(rude.team.key, C, "203.0.113.1");
	await report(rude.team.key, C, "203.0.113.1"); // the same IP again changes nothing
	await report(rude.team.key, B, "203.0.113.2");
	await report(rude.team.key, A, "203.0.113.3"); // its own member: quietly ignored
	await report(fine.team.key, C, "203.0.113.1");
	assert.deepEqual(open().map((r) => [r.team_id, r.n]), [[rude.team.id, 2], [fine.team.id, 1]]);
	await rejects(report("KINGS", C), 404); // official teams aren't typed by kids
	await rejects(report("c999", C), 404);
	// The admin page lists reported teams first, with how many open reports.
	assert.deepEqual((await adminTeams(env)).slice(0, 2).map((t) => [t.name, t.reports]), [["FINE", 1], ["BADNAME", 2]]);
	// Looks fine: out of the inbox, nothing public changes.
	await editTeam(env, fine.team.id, { action: "name-ok" }, "http://localhost");
	// An old team that already had the same name (before names had to be unique).
	const twin = await make(env, "e".repeat(32), "TWIN");
	db.prepare("UPDATE community_teams SET name = 'BADNAME' WHERE id = ?").run(twin.team.id);
	addScore(db, { device: await boardOf(env, "e".repeat(32)), player: "me1", score: 20, team: twin.team.key });
	// Hidden: off Top teams, its reports dealt with, and that exact name blocked from then on.
	await editTeam(env, rude.team.id, { action: "hide" }, "http://localhost");
	assert.deepEqual(open(), []);
	assert.deepEqual(names(await teamRows(env, "timed", true)), ["BADNAME"]); // the twin stays, until it's reported too
	db.prepare("UPDATE community_teams SET status = 'hidden' WHERE id = ?").run(twin.team.id);
	await rejects(make(env, C, "badname"), 400, /friendly/);
	// Only the exact name: a name with it inside, or a player's nickname, is fine.
	assert.equal((await make(env, C, "BADNAMES")).team.name, "BADNAMES");
	assert.equal(await isUnfriendly(env, "Badname"), false);
	await rejects(report(rude.team.key, C), 404); // hidden: nothing to report
	// Shown again: the name can be used again.
	await editTeam(env, rude.team.id, { action: "show" }, "http://localhost");
	assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blocked_team_names").get() as { n: number }).n, 0);
	// Renamed by the admin: its reports are dealt with too.
	await report(fine.team.key, C, "203.0.113.9");
	await editTeam(env, fine.team.id, { action: "rename", name: "KIND" }, "http://localhost");
	assert.deepEqual(open(), []);
});

test("listed names are unique; renaming a listed team waits for Luke again; blocked names never show", async () => {
	const { env, db } = setup();
	const one = await make(env, A, "HOOPERS");
	// Two teams that shared a name before new names had to be unique (like the two GOATS).
	const two = await make(env, B, "HOOPERZ");
	db.prepare("UPDATE community_teams SET name = 'HOOPERS' WHERE id = ?").run(two.team.id);
	await editTeam(env, one.team.id, { action: "list" }, "http://localhost");
	await rejects(call(env, "POST", `/api/teams/${two.team.id}`, { device: B, action: "list", turnstileToken: "ok" }), 400, /already a team/);
	await rejects(call(env, "POST", `/api/teams/${two.team.id}`, { device: B, action: "name", name: "Sharks", turnstileToken: "ok" }), 400, /game's teams/);
	await rejects(editTeam(env, two.team.id, { action: "list" }, "http://localhost"), 400);
	// Not this name: it stays code-to-join, and the maker sees why.
	await call(env, "POST", `/api/teams/${two.team.id}`, { device: B, action: "name", name: "BALLERS", turnstileToken: "ok" });
	await call(env, "POST", `/api/teams/${two.team.id}`, { device: B, action: "list", turnstileToken: "ok" });
	await editTeam(env, two.team.id, { action: "refuse" }, "http://localhost");
	assert.equal((await mine(env, B))[0].listing, "refused");
	// The same name can't go back to Luke; a new name can.
	await rejects(call(env, "POST", `/api/teams/${two.team.id}`, { device: B, action: "list", turnstileToken: "ok" }), 400, /different name/);
	await call(env, "POST", `/api/teams/${two.team.id}`, { device: B, action: "name", name: "DUNKERS", turnstileToken: "ok" });
	assert.equal((await mine(env, B))[0].listing, "private");
	assert.equal((await call(env, "POST", `/api/teams/${two.team.id}`, { device: B, action: "list", turnstileToken: "ok" })).team.listing, "asked");
	// Renaming a listed team: out of the join list until Luke OKs the new name (it stays on Top teams).
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

test("every team's games count from when teams went live, code-to-join or not, and changing who can join changes nothing", async () => {
	const { env, db } = setup();
	const code = await make(env, A, "SECRET");
	const open = await make(env, B, "OPEN");
	await editTeam(env, open.team.id, { action: "list" }, "http://localhost");
	const after = "2026-11-15 12:00:00"; // after teams went live, before every team was on the board
	assert.ok(featureFrom("teams") < after);
	addScore(db, { device: await boardOf(env, A), player: "me1", score: 50, team: code.team.key, at: after });
	addScore(db, { device: await boardOf(env, B), player: "me1", score: 40, team: open.team.key, at: after });
	const board = async () => (await teamRows(env, "timed", false)).map((r) => [r.name, r.score]);
	assert.deepEqual(await board(), [["SECRET", 50], ["OPEN", 40]]);
	assert.equal((await call(env, "GET", `/api/teams/${code.team.key}/players?mode=timed&range=all`)).players.length, 1);
	// Switching who can join, either way, never changes which games count.
	await call(env, "POST", `/api/teams/${open.team.id}`, { device: B, action: "unlist" });
	await editTeam(env, code.team.id, { action: "list" }, "http://localhost");
	assert.deepEqual(await board(), [["SECRET", 50], ["OPEN", 40]]);
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
	assert.match((await call(env, "POST", `/api/teams/${theirs.team.id}`, { device: A, action: "code" })).code, /^T-.{4}-.{4}$/);
});

test("public team reads are cached like the boards, with only the parameters they read", () => {
	const key = (u: string) => cacheKey(new Request(u), new URL(u))?.key;
	assert.equal(key("http://localhost/api/teams?mode=timed&range=week&junk=1"), "http://localhost/api/teams?mode=timed&range=week");
	assert.equal(key("http://localhost/api/teams/list?x=1"), "http://localhost/api/teams/list");
	assert.equal(key("http://localhost/api/teams/Kings/players?mode=around&range=all&x=2"), "http://localhost/api/teams/KINGS/players?mode=around&range=all");
	assert.equal(key("http://localhost/api/teams/C12/players"), "http://localhost/api/teams/c12/players?mode=timed&range=week");
	assert.equal(key("http://localhost/api/teams/nope/players"), undefined);
	assert.equal(key("http://localhost/api/teams-rank?mode=timed&range=week"), undefined); // the private count is never served
});

test("a team's ranking names only players already on the players' board; members of a code-to-join team see each other", async () => {
	const { env, db } = setup();
	// 12 devices on SHARKS: the players' board shows 10, so the 2 lowest are a face and a score.
	for (let i = 0; i < 12; i++) addScore(db, { player: "me1", device: `s${i}`, score: 50 - i, team: "SHARKS", nickname: `Kid${i}` });
	const { players } = await call(env, "GET", "/api/teams/SHARKS/players?mode=timed");
	assert.deepEqual(players.map((p: Out) => p.nickname), [...Array(10).keys()].map((i) => `Kid${i}`).concat([null, null]));
	assert.ok(players.every((p: Out) => Number.isInteger(p.id))); // for the report flag
	// A code-to-join team: its members see every name (others see it like any team's).
	const secret = await make(env, A, "SECRET");
	for (let i = 0; i < 2; i++) addScore(db, { player: "me1", device: i ? await boardOf(env, A) : "q1", score: 1 + i, team: secret.team.key, nickname: `Pal${i}` });
	const standing = await call(env, "POST", "/api/teams/players", { device: A, key: secret.team.key, mode: "timed" });
	assert.deepEqual(standing.players.map((p: Out) => p.nickname), ["Pal1", "Pal0"]);
});
