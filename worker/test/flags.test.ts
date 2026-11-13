// Feature flags (worker/src/flags.ts, listed in shared/flags.js): the public list, switching one on
// from the admin page, and the Worker refusing what a hidden feature would send.
// Run: npm --prefix worker test
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FLAGS, FLAG_KEYS, flagForBody, flagForMode, parseFlagList } from "../../shared/flags.js";
import { cacheKey } from "../src/cache.ts";
import { adminFlags, forgetFlags, readFlags, requireBodyOut, requireModeOut, setFlag } from "../src/flags.ts";
import { HttpError } from "../src/http.ts";
import { listIdeas } from "../src/ideas.ts";
import { createPlayer } from "../src/players.ts";
import { claimGame } from "../src/progress.ts";
import { postScore, previewScore } from "../src/scores.ts";
import type { Env } from "../src/util.ts";
import { fakeEnv } from "./fake-d1.ts";

// The robot check always passes here.
globalThis.fetch = (async () => new Response(JSON.stringify({ success: true }))) as typeof fetch;

beforeEach(() => forgetFlags());

// The admin API's GET and POST /api/admin/flags (admin.ts routes them there after the sign-in and
// same-origin checks, which api.test.ts and access.test.ts cover).
const adminCall = (env: Env, method: string, body?: Record<string, unknown>) => (method === "GET" ? adminFlags(env) : setFlag(env, body ?? {}));

const post = (path: string, body: unknown) =>
	new Request(`http://localhost:8787${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
		body: JSON.stringify(body),
	});

const refusal = async (p: Promise<unknown>) => {
	try {
		await p;
		return null;
	} catch (err) {
		return err instanceof HttpError ? err.message : String(err);
	}
};

test("the flag list: unique keys, each with a name and what it hides", () => {
	assert.equal(new Set(FLAG_KEYS).size, FLAG_KEYS.length);
	for (const f of FLAGS) {
		assert.match(f.key, /^[a-z0-9]+$/, f.key);
		assert.ok(f.name && f.hides, f.key);
	}
	assert.equal(flagForMode("threes"), "threepoint");
	assert.equal(flagForMode("timed"), undefined);
	assert.equal(flagForBody("spiky"), undefined);
});

test("?flags= turns on known flags, or all of them", () => {
	assert.deepEqual(parseFlagList(null), []);
	assert.deepEqual(parseFlagList("threepoint,nope"), ["threepoint"]);
	assert.deepEqual(parseFlagList(" ThreePoint , freeplay"), ["threepoint", "freeplay"].filter((k) => FLAG_KEYS.includes(k)));
	assert.deepEqual(parseFlagList("all"), FLAG_KEYS);
});

test("every flag starts off", async () => {
	const { env } = fakeEnv();
	const flags = await readFlags(env);
	assert.deepEqual(Object.keys(flags), FLAG_KEYS);
	assert.ok(Object.values(flags).every((on) => on === false));
});

test("the public list is edge-cached, whatever is added to the address", () => {
	const at = (u: string) => cacheKey(new Request(u), new URL(u));
	assert.equal(at("https://orsonbrooker.com/api/flags")?.key, "https://orsonbrooker.com/api/flags");
	assert.equal(at("https://orsonbrooker.com/api/flags?x=1")?.key, "https://orsonbrooker.com/api/flags");
});

test("the admin switches a flag on and off, and the public list follows", async () => {
	const { env } = fakeEnv();
	let res = await adminCall(env, "POST", { key: "threepoint", on: true });
	assert.equal(res.status, 200);
	assert.equal((await readFlags(env)).threepoint, true);

	res = await adminCall(env, "GET");
	const listed = (await res.json()) as { flags: { key: string; on: boolean; hides: string; updated_at: string | null }[] };
	assert.deepEqual(
		listed.flags.map((f) => [f.key, f.on]),
		FLAG_KEYS.map((k) => [k, k === "threepoint"]),
	);
	assert.ok(listed.flags.find((f) => f.key === "threepoint")?.updated_at);

	await adminCall(env, "POST", { key: "threepoint", on: false });
	assert.equal((await readFlags(env)).threepoint, false);
});

test("the admin can't make up flags or send anything but on or off", async () => {
	const { env } = fakeEnv();
	assert.equal(await refusal(adminCall(env, "POST", { key: "everything", on: true })), "Unknown flag.");
	assert.equal(await refusal(adminCall(env, "POST", { key: "threepoint", on: "yes" })), "Say on or off.");
});



test("a score, a preview or coins for a mode that isn't out are refused, and allowed once it is", async () => {
	const { env } = fakeEnv();
	const game = { mode: "threes", score: 30, shots: [], token: "x", device: "device-abcdefghijklmnop", nickname: "Moni", player: "orson" };
	const NOT_OUT = "That isn't out yet.";
	assert.equal(await refusal(postScore(post("/api/scores", game), env)), NOT_OUT);
	assert.equal(await refusal(previewScore(post("/api/scores/preview", game), env)), NOT_OUT);
	assert.equal(await refusal(claimGame(post("/api/progress/games", game), env)), NOT_OUT);

	await adminCall(env, "POST", { key: "threepoint", on: true });
	// Now it gets past the flag (and is refused later, for its made-up shots and token).
	assert.notEqual(await refusal(postScore(post("/api/scores", game), env)), NOT_OUT);
	assert.notEqual(await refusal(claimGame(post("/api/progress/games", game), env)), NOT_OUT);
	// Modes that are out don't depend on any flag.
	await assert.doesNotReject(requireModeOut(env, "timed"));
});

test("a builder player with a body that isn't out is refused, and allowed once it is", async () => {
	const { env, db } = fakeEnv();
	await assert.doesNotReject(requireBodyOut(env, "spiky"));
	const flagged = FLAGS.find((f) => f.bodies?.length);
	if (!flagged) return; // no hidden bodies right now
	const body = {
		name: "Edity",
		base: flagged.bodies![0],
		colours: { skin: "#8d5a37", hair: "#26222a", jersey: "#d63a3a", team: "#f2f2ef", shoes: "#26222a" },
		turnstileToken: "ok",
	};
	assert.equal(await refusal(createPlayer(post("/api/players", body), env)), "That isn't out yet.");
	assert.equal((db.prepare("SELECT COUNT(*) AS n FROM players").get() as { n: number }).n, 0);
	await adminCall(env, "POST", { key: flagged.key, on: true });
	assert.equal(await refusal(createPlayer(post("/api/players", body), env)), null);
});

test("a player with a size (kids from video) waits for the videokids flag", async () => {
	const { env } = fakeEnv();
	const body = {
		name: "Tally",
		base: "curly",
		colours: { skin: "#8d5a37", hair: "#26222a", jersey: "#d63a3a", team: "#f2f2ef", shoes: "#26222a" },
		build: { height: 1, bulk: 0 },
		turnstileToken: "ok",
	};
	assert.equal(await refusal(createPlayer(post("/api/players", body), env)), "That isn't out yet.");
	// Without a size it's an ordinary drawn Curly, out already.
	assert.equal(await refusal(createPlayer(post("/api/players", { ...body, build: undefined }), env)), null);
	await setFlag(env, { key: "videokids", on: true });
	assert.equal(await refusal(createPlayer(post("/api/players", body), env)), null);
});

const addIdea = (db: ReturnType<typeof fakeEnv>["db"], title: string, status = "planned", doneAt: string | null = null) =>
	Number(db.prepare("INSERT INTO ideas (app, title, description, status, done_at) VALUES ('basketball', ?, '', ?, ?) RETURNING id").get(title, status, doneAt)!.id);
const idea = (db: ReturnType<typeof fakeEnv>["db"], id: number) => db.prepare("SELECT status, done_at FROM ideas WHERE id = ?").get(id) as { status: string; done_at: string | null };
const board = async (env: Env) =>
	((await (await listIdeas(new Request("http://localhost/api/ideas"), env, new URL("http://localhost/api/ideas"))).json()) as { ideas: { id: number; coming_soon?: boolean }[] }).ideas;

test("a flag links to the idea it delivers, and the admin list shows it", async () => {
	const { env, db } = fakeEnv();
	const id = addIdea(db, "Free play");
	await setFlag(env, { key: "freeplay", ideaId: id });
	const listed = (await (await adminFlags(env)).json()) as { flags: { key: string; idea_id: number | null; on: boolean }[] };
	assert.deepEqual(listed.flags.find((f) => f.key === "freeplay"), { ...listed.flags.find((f) => f.key === "freeplay"), idea_id: id, on: false });
	assert.equal(await refusal(setFlag(env, { key: "freeplay", ideaId: 9999 })), "No such idea.");
	await setFlag(env, { key: "freeplay", ideaId: null });
	assert.equal(((await (await adminFlags(env)).json()) as { flags: { key: string; idea_id: number | null }[] }).flags.find((f) => f.key === "freeplay")?.idea_id, null);
});

test("while its flag is off, a linked idea says Coming soon on the board; other ideas don't", async () => {
	const { env, db } = fakeEnv();
	const linked = addIdea(db, "Free play");
	const other = addIdea(db, "Moni as a player");
	await setFlag(env, { key: "freeplay", ideaId: linked });
	const ideas = await board(env);
	assert.equal(ideas.find((i) => i.id === linked)?.coming_soon, true);
	assert.equal(ideas.find((i) => i.id === other)?.coming_soon, undefined);
	// Nothing about the flag itself is public.
	assert.ok(!JSON.stringify(ideas).includes("freeplay"));
});

test("switching a linked flag on marks its idea done, once", async () => {
	const { env, db } = fakeEnv();
	const id = addIdea(db, "Free play", "building");
	await setFlag(env, { key: "freeplay", ideaId: id });
	assert.equal(idea(db, id).done_at, null);
	await setFlag(env, { key: "freeplay", on: true });
	assert.equal(idea(db, id).status, "done");
	assert.ok(idea(db, id).done_at);
	assert.equal((await board(env)).find((i) => i.id === id)?.coming_soon, undefined);
	// Off and on again: the first done date stays.
	db.prepare("UPDATE ideas SET done_at = '2026-01-01 00:00:00' WHERE id = ?").run(id);
	await setFlag(env, { key: "freeplay", on: false });
	await setFlag(env, { key: "freeplay", on: true });
	assert.equal(idea(db, id).done_at, "2026-01-01 00:00:00");
});

test("an idea already done keeps its date, and a hidden one stays hidden", async () => {
	const { env, db } = fakeEnv();
	const done = addIdea(db, "Done already", "done", "2026-02-02 00:00:00");
	await setFlag(env, { key: "freeplay", ideaId: done, on: true });
	assert.deepEqual({ ...idea(db, done) }, { status: "done", done_at: "2026-02-02 00:00:00" });
	const hidden = addIdea(db, "Hidden", "hidden");
	await setFlag(env, { key: "threepoint", ideaId: hidden, on: true });
	assert.equal(idea(db, hidden).status, "hidden");
});

test("switching a flag off or on without an idea changes no idea", async () => {
	const { env, db } = fakeEnv();
	const id = addIdea(db, "Unlinked");
	await setFlag(env, { key: "freeplay", on: true });
	assert.deepEqual({ ...idea(db, id) }, { status: "planned", done_at: null });
});
