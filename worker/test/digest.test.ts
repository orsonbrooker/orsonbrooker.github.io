// The weekly digest (worker/src/digest.ts) and how the admin inbox shows it, run against a real SQLite
// database built from the migrations (Node's built-in node:sqlite, standing in for D1).
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { collectDigest, openDigest, weeklyDigest } from "../src/digest.ts";
import type { Env } from "../src/util.ts";
import { fakeEnv } from "./fake-d1.ts";

// The admin page's HTML comes in with Vite's "?raw" (admin.ts): the same here, as a string.
registerHooks({
	load(url, context, next) {
		if (!url.endsWith(".html?raw")) return next(url, context);
		const text = readFileSync(new URL(url.slice(0, -4)), "utf8");
		return { format: "module", source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
	},
});
const { admin } = await import("../src/admin.ts");
const { default: worker } = await import("../src/index.ts");

function addScore(db: DatabaseSync, opts: { nickname?: string; flags?: string[]; checked?: number; status?: string; daysAgo?: number } = {}): number {
	const { nickname = "Rudey", flags = [], checked = 0, status = "shown", daysAgo = 0 } = opts;
	const row = db
		.prepare(
			`INSERT INTO scores (nickname, score, player, shots, made, threes, real_seconds, log, flags, status, checked, token, device, ip_hash, mode, created_at)
			 VALUES (?, 40, 'orson', 10, 5, 0, 60, '[]', ?, ?, ?, ?, 'dev', 'ip', 'timed', datetime('now', ?)) RETURNING id`,
		)
		.get(nickname, JSON.stringify(flags), status, checked, `token-${Math.random()}`, `-${daysAgo} days`) as { id: number };
	return row.id;
}
const addReport = (db: DatabaseSync, scoreId: number, ip: string, daysAgo = 0, cleared = 0) =>
	db.prepare("INSERT INTO reports (score_id, ip_hash, cleared, created_at) VALUES (?, ?, ?, datetime('now', ?))").run(scoreId, ip, cleared, `-${daysAgo} days`);

// Admin requests as the local admin page sends them (DEV_ADMIN only opens it on localhost).
const adminEnv = (env: Env) => Object.assign(env, { DEV_ADMIN: "1", SITE_URL: "http://localhost:8787" });
const inbox = async (env: Env) => (await (await admin(new Request("http://localhost/api/admin/inbox"), env, new URL("http://localhost/api/admin/inbox"))).json()) as {
	digest: Awaited<ReturnType<typeof openDigest>>;
};
const post = (env: Env, path: string, body: unknown) => {
	const url = `http://localhost/api/admin/${path}`;
	return admin(new Request(url, { method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify(body) }), env, new URL(url));
};

test("the digest lists odd games and reported names still waiting, and counts the new ones", async () => {
	const { env, db } = fakeEnv();
	const oddNew = addScore(db, { nickname: "Zoom", flags: ["Very fast shots"] });
	const oddOld = addScore(db, { nickname: "Old", flags: ["Hidden tab"], daysAgo: 10 });
	addScore(db, { nickname: "Checked", flags: ["Very fast shots"], checked: 1 }); // already looked at
	addScore(db, { nickname: "Gone", flags: ["Very fast shots"], status: "hidden" }); // off the board
	addScore(db, { nickname: "Normal" }); // nothing odd
	const named = addScore(db, { nickname: "Rudey" });
	addReport(db, named, "ip-a");
	addReport(db, named, "ip-b", 9);
	const oldName = addScore(db, { nickname: "Meanie", daysAgo: 20 });
	addReport(db, oldName, "ip-c", 20);
	const dealt = addScore(db, { nickname: "Fine" });
	addReport(db, dealt, "ip-d", 0, 1); // cleared: dealt with

	const d = await collectDigest(env);
	assert.deepEqual(d.odd.map((o) => o.id), [oddOld, oddNew].sort((a, b) => b - a));
	assert.deepEqual(d.odd.find((o) => o.id === oddNew)?.flags, ["Very fast shots"]);
	assert.equal(d.newOdd, 1);
	assert.deepEqual(d.names.map((n) => [n.id, n.reports]), [[named, 2], [oldName, 1]]);
	assert.equal(d.newNames, 1);
	// Dates only, never times (kids' privacy, even on the admin page).
	for (const item of [...d.odd, ...d.names]) assert.match(item.day, /^\d{4}-\d{2}-\d{2}$/);
});

test("nothing waiting: no digest is saved", async () => {
	const { env, db } = fakeEnv();
	addScore(db);
	assert.equal(await weeklyDigest(env), null);
	assert.equal((db.prepare("SELECT COUNT(*) AS n FROM digests").get() as { n: number }).n, 0);
	assert.equal((await inbox(adminEnv(env))).digest, null);
});

test("the cron saves one digest a day; it shows at the top of the inbox until Got it", async () => {
	const { env, db } = fakeEnv();
	adminEnv(env);
	addScore(db, { nickname: "Zoom", flags: ["Very fast shots"] });
	// The weekly cron (any schedule but the daily one) runs the digest; no ntfy topic, so no notification.
	await worker.scheduled({ cron: "0 21 * * SUN" } as ScheduledController, env, {} as ExecutionContext);
	await worker.scheduled({ cron: "0 21 * * SUN" } as ScheduledController, env, {} as ExecutionContext); // a re-run replaces it
	assert.equal((db.prepare("SELECT COUNT(*) AS n FROM digests").get() as { n: number }).n, 1);
	// The daily cron doesn't make one.
	db.exec("DELETE FROM digests");
	await worker.scheduled({ cron: "30 0 * * *" } as ScheduledController, env, {} as ExecutionContext).catch(() => {}); // page views need a token
	assert.equal((db.prepare("SELECT COUNT(*) AS n FROM digests").get() as { n: number }).n, 0);

	await weeklyDigest(env);
	const { digest } = await inbox(env);
	assert.ok(digest);
	assert.equal(digest.odd[0].nickname, "Zoom");
	assert.equal(digest.newOdd, 1);

	await assert.rejects(post(env, `digests/${digest.id}`, { action: "nope" }), (err: Error & { status?: number }) => err.status === 400);
	assert.deepEqual(await (await post(env, `digests/${digest.id}`, { action: "seen" })).json(), { ok: true });
	assert.equal((await inbox(env)).digest, null);
	await assert.rejects(post(env, `digests/${digest.id}`, { action: "seen" }), (err: Error & { status?: number }) => err.status === 404);
});

test("a new week's digest replaces last week's unseen one", async () => {
	const { env, db } = fakeEnv();
	adminEnv(env);
	addScore(db, { flags: ["Very fast shots"] });
	db.prepare("INSERT INTO digests (week, items) VALUES (date('now', '-7 days'), ?)").run(JSON.stringify({ odd: [], names: [], newOdd: 0, newNames: 0 }));
	await weeklyDigest(env);
	const open = db.prepare("SELECT week FROM digests WHERE seen_at IS NULL").all() as { week: string }[];
	assert.equal(open.length, 1);
	assert.equal(open[0].week, (db.prepare("SELECT date('now') AS d").get() as { d: string }).d);
	assert.equal((await inbox(env)).digest?.odd.length, 1);
});

test("the admin API still needs Access for the digest", async () => {
	const { env } = fakeEnv();
	await assert.rejects(post(env, "digests/1", { action: "seen" }), (err: Error & { status?: number }) => err.status === 503);
});
