// Sending the same player again from the same device (createPlayer in worker/src/players.ts): while
// the first request still waits it's replaced, so the admin inbox has it once; once approved, a new
// look waits as a request of its own. Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlayer } from "../src/players.ts";
import { fakeEnv } from "./fake-d1.ts";

// The robot check always passes here.
globalThis.fetch = (async () => new Response(JSON.stringify({ success: true }))) as typeof fetch;

const DEVICE = "device-abcdefghijklmnop";

function send(env: Parameters<typeof createPlayer>[1], fields: Record<string, unknown>) {
	const body = {
		name: "Edity",
		base: "curly",
		colours: { skin: "#8d5a37", hair: "#26222a", jersey: "#d63a3a", team: "#f2f2ef", shoes: "#26222a" },
		number: "7",
		teamName: "KINGS",
		turnstileToken: "ok",
		device: DEVICE,
		localId: "me1700000000000",
		...fields,
	};
	const request = new Request("http://localhost/api/players", {
		method: "POST",
		headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
		body: JSON.stringify(body),
	});
	return createPlayer(request, env);
}

const rows = (db: ReturnType<typeof fakeEnv>["db"]) =>
	db.prepare("SELECT id, name, number, jersey, status FROM players ORDER BY id").all() as { id: number; name: string; number: string; jersey: string; status: string }[];

test("sending the same player again while it waits replaces the waiting request", async () => {
	const { env, db } = fakeEnv();
	await send(env, {});
	await send(env, { number: "23", colours: { skin: "#8d5a37", hair: "#26222a", jersey: "#3fa65c", team: "#f2f2ef", shoes: "#26222a" } });
	const list = rows(db);
	assert.equal(list.length, 1);
	assert.equal(list[0].number, "23");
	assert.equal(list[0].jersey, "#3fa65c");
	assert.equal(list[0].status, "new");
});

test("a new name for the same player still replaces it (same device, same id there)", async () => {
	const { env, db } = fakeEnv();
	await send(env, {});
	await send(env, { name: "Edity Two" });
	assert.deepEqual(
		rows(db).map((r) => r.name),
		["Edity Two"],
	);
});

test("once approved, a new look waits as its own request", async () => {
	const { env, db } = fakeEnv();
	await send(env, {});
	db.prepare("UPDATE players SET status = 'approved'").run();
	await send(env, { number: "23" });
	assert.deepEqual(
		rows(db).map((r) => [r.number, r.status]),
		[
			["7", "approved"],
			["23", "new"],
		],
	);
});

test("other devices' and other players' requests are left alone", async () => {
	const { env, db } = fakeEnv();
	await send(env, {});
	await send(env, { name: "Other", localId: "me1700000000001" });
	await send(env, { device: "another-device-0123456789" });
	assert.equal(rows(db).length, 3);
});
