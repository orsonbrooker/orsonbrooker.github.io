// The Worker's small rules that need no database: tidying and checking what people type, how a
// merged idea credits its senders, and the weekly notification's text.
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CREDIT, mergeCredit } from "../src/ideas.ts";
import { notifyMessage } from "../src/notify.ts";
import { isNickname } from "../src/players.ts";
import { scoreNickname } from "../src/scores.ts";
import { clean, isLocalHost, isRude, requireSameOriginJson, RUDE } from "../src/util.ts";
import type { Env } from "../src/util.ts";

test("clean tidies spaces, trims, cuts to length and drops anything but text", () => {
	assert.equal(clean("  Moni \n\t is   the  goat ", 100), "Moni is the goat");
	assert.equal(clean("abcdef", 3), "abc");
	assert.equal(clean("   ", 10), "");
	assert.equal(clean(42, 10), "");
	assert.equal(clean(null, 10), "");
	assert.equal(clean(undefined, 10), "");
	assert.equal(clean(["a"], 10), "");
});

test("the rude-word filter catches disguised words but not innocent ones", () => {
	for (const t of ["a$$hole", "sh1t", "b1tch", "fuuuck"]) assert.equal(isRude(t), true, t);
	for (const t of ["assassin", "class", "Scunthorpe", "Dickens", "Cockatoo", "shitake", "basketball"]) assert.equal(isRude(t), false, t);
	// Any one of several texts; empty ones are fine.
	assert.equal(isRude("Moni", null, undefined, ""), false);
	assert.equal(isRude("Moni", "a$$hole"), true);
});

test("nicknames start with a letter or number, then letters, numbers, spaces, ' and -", () => {
	for (const n of ["Moni", "Jude 2", "O'Neil", "Mary-Kate", "67", "Zoë", "李"]) assert.equal(isNickname(n), true, n);
	for (const n of ["", " Moni", "-Moni", "'Moni", "Moni!", "a$$", "Jac(potato)", "🏀"]) assert.equal(isNickname(n), false, n);
});

test("a leaderboard nickname is tidied, cut to 12 and checked", () => {
	assert.equal(scoreNickname({ nickname: "  Big   Shot  " }), "Big Shot");
	assert.equal(scoreNickname({ nickname: "Abcdefghijklmnop" }), "Abcdefghijkl");
	const rejects = (nickname: unknown, message: string) =>
		assert.throws(() => scoreNickname({ nickname }), (err: Error & { status?: number }) => err.status === 400 && err.message === message);
	rejects("", "Pick a nickname with letters and numbers.");
	rejects(undefined, "Pick a nickname with letters and numbers.");
	rejects("!!", "Pick a nickname with letters and numbers.");
	rejects("b1tch", RUDE);
});

test("a merge adds the sender to the idea's credit once, if it fits", () => {
	assert.equal(mergeCredit(null, "Moni"), "Moni");
	assert.equal(mergeCredit("Moni", "Jude"), "Moni, Jude");
	assert.equal(mergeCredit("Moni, Jude", "  Aston "), "Moni, Jude, Aston");
	// Already there, in any case or spacing.
	assert.equal(mergeCredit("Moni, Jude", "jude"), "Moni, Jude");
	assert.equal(mergeCredit("Moni,Jude", " MONI"), "Moni,Jude");
	// No nickname: unchanged.
	assert.equal(mergeCredit("Moni", null), "Moni");
	assert.equal(mergeCredit("Moni", "   "), "Moni");
	assert.equal(mergeCredit(null, undefined), null);
	// Too long once joined: unchanged.
	const long = "x".repeat(MAX_CREDIT - 6);
	assert.equal(mergeCredit(long, "Jude"), `${long}, Jude`); // exactly MAX_CREDIT
	assert.equal(mergeCredit(long, "Judes"), long);
	assert.equal(mergeCredit(null, "y".repeat(MAX_CREDIT + 1)), null);
});

test("the weekly notification lists what's waiting, or nothing", () => {
	assert.equal(notifyMessage({ ideas: 0, players: 0, oddScores: 0, votes: 12 }), null);
	assert.equal(notifyMessage({ ideas: 1, players: 0, oddScores: 0, votes: 0 }), "1 new idea waiting, and 0 votes this week.");
	assert.equal(notifyMessage({ ideas: 0, players: 2, oddScores: 0, votes: 1 }), "2 new players waiting, and 1 votes this week.");
	assert.equal(
		notifyMessage({ ideas: 3, players: 1, oddScores: 1, votes: 40 }),
		"3 new ideas and 1 new player and 1 odd-looking score waiting, and 40 votes this week.",
	);
});

test("admin changes need JSON from the admin page's own site", () => {
	const env = { SITE_URL: "https://orsonbrooker.com" } as Env;
	const live = "https://orsonbrooker.com/api/admin/ideas/1";
	const local = "http://localhost:8787/api/admin/ideas/1";
	const check = (headers: Record<string, string>, url = live) => () => requireSameOriginJson(new Request(url, { method: "POST", headers }), env);
	const ok = (headers: Record<string, string>, url?: string) => assert.doesNotThrow(check(headers, url));
	const blocked = (headers: Record<string, string>, url?: string) => assert.throws(check(headers, url), (err: Error & { status?: number }) => err.status === 403);
	const json = { "Content-Type": "application/json" };
	ok({ ...json, "Sec-Fetch-Site": "same-origin" });
	ok({ "Content-Type": "application/json; charset=utf-8", "Sec-Fetch-Site": "same-origin" });
	ok({ ...json, Origin: "https://orsonbrooker.com" }); // an older browser: no Sec-Fetch-Site
	ok({ ...json, "Sec-Fetch-Site": "same-origin" }, local);
	ok({ ...json, Origin: "http://localhost:8787" }, local);
	blocked({ "Content-Type": "text/plain", "Sec-Fetch-Site": "same-origin" });
	blocked({ "Content-Type": "application/x-www-form-urlencoded", Origin: "https://orsonbrooker.com" });
	blocked({ ...json, "Sec-Fetch-Site": "cross-site", Origin: "https://orsonbrooker.com" });
	blocked({ ...json, "Sec-Fetch-Site": "same-site" });
	blocked({ ...json, Origin: "https://evil.example" });
	blocked({ ...json }); // no way to tell where it came from
	blocked({ ...json, Origin: "http://localhost:5173" }, local);
});

test("the local admin shortcut is only for this machine's own address", () => {
	const at = (url: string, ip?: string) => isLocalHost(new Request(url, { headers: ip ? { "CF-Connecting-IP": ip } : {} }));
	for (const url of ["http://localhost:8787/admin", "http://127.0.0.1:8787/admin", "http://[::1]:8787/admin"]) assert.equal(at(url), true, url);
	assert.equal(at("http://localhost:8787/admin", "127.0.0.1"), true);
	for (const url of ["http://192.168.4.23:8787/admin", "http://macbook.local:8787/admin", "https://orsonbrooker.com/admin", "http://localhost.evil.com/admin"])
		assert.equal(at(url), false, url);
	assert.equal(at("http://localhost:8787/admin", "192.168.4.40"), false);
});
