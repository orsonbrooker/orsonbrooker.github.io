// A player's pronoun: what the Worker accepts, and the announcer's he- and she-lines (phrases.js).
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePronoun } from "../src/players.ts";
import { PHRASES, SHE, pickPhrase } from "../../phrases.js";

test("a player's pronoun is he, she, or not set", () => {
	assert.equal(parsePronoun("he"), "he");
	assert.equal(parsePronoun("she"), "she");
	for (const v of [undefined, null, "", "He", "SHE", " he", "they", "it", 1, true, ["he"], { he: 1 }]) assert.equal(parsePronoun(v), null, String(v));
});

const lines = Object.values(PHRASES).flat();
const gendered = /\b(he|he's|his|him|bro)\b/i;

test("every line that says he, his or him has a she version, and only those", () => {
	for (const line of lines) assert.equal(line in SHE, gendered.test(line), line);
	for (const [he, she] of Object.entries(SHE)) {
		assert.ok(lines.includes(he), `${he} isn't in PHRASES`);
		assert.ok(!gendered.test(she), she);
		assert.ok(/\b(she|she's|her|sis)\b/i.test(she), she);
	}
});

test("every moment has a line for a player with no pronoun", () => {
	for (const [category, list] of Object.entries(PHRASES)) assert.ok(list.some((l) => !(l in SHE)), category);
});

test("the announcer picks lines that fit the player", () => {
	const heLines = new Set(Object.keys(SHE));
	const sheLines = new Set(Object.values(SHE));
	for (const category of Object.keys(PHRASES)) {
		for (let i = 0; i < 40; i++) {
			assert.ok(!heLines.has(pickPhrase(category, "she")), category);
			assert.ok(!sheLines.has(pickPhrase(category, "he")), category);
			const none = pickPhrase(category, "");
			assert.ok(!heLines.has(none) && !sheLines.has(none), `${category}: ${none}`);
		}
	}
	// Over enough calls, a she gets the she-lines.
	const heard = new Set(Array.from({ length: 200 }, () => pickPhrase("heatingUp", "she")));
	assert.ok(heard.has("She's heating up!"));
});
