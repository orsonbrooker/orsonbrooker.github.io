// The game's scoring rules (shared/rules.js), which the game and the server both use.
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	FIRE_RULES,
	MONEY,
	NORMAL,
	RAINBOW,
	ballKind,
	ballPoints,
	fireBonus,
	fireLevelIndex,
	lowWins,
	modeOf,
	recountScore,
} from "../../shared/rules.js";

test("fire levels: on fire at 3 in a row, purple at 6, supernova at 10", () => {
	assert.deepEqual(
		FIRE_RULES.map((r) => r.streak),
		[3, 6, 10],
	);
	assert.equal(fireLevelIndex(2), -1);
	assert.equal(fireLevelIndex(3), 0);
	assert.equal(fireLevelIndex(5), 0);
	assert.equal(fireLevelIndex(6), 1);
	assert.equal(fireLevelIndex(10), 2);
	assert.equal(fireLevelIndex(40), 2);
	assert.deepEqual(
		[0, 2, 3, 6, 9, 10, 25].map(fireBonus),
		[0, 0, 1, 2, 2, 3, 3],
	);
});

test("points for a basket", () => {
	assert.equal(ballPoints(NORMAL, 0, 0), 2);
	assert.equal(ballPoints(NORMAL, 1, 0), 3);
	assert.equal(ballPoints(NORMAL, 1, 2), 5);
	assert.equal(ballPoints(MONEY, 0, 0), 4); // doubled
	assert.equal(ballPoints(MONEY, 1, 1), 8); // (3 + 1) x 2
	assert.equal(ballPoints(RAINBOW, 0, 0), 5);
	assert.equal(ballPoints(RAINBOW, 1, 3), 8); // always 5, plus fire
});

test("bonus balls come from the token, the same every time", () => {
	const token = "1793883270459.972cfa07.10e188c";
	const once = Array.from({ length: 40 }, (_, i) => ballKind(token, i));
	const again = Array.from({ length: 40 }, (_, i) => ballKind(token, i));
	assert.deepEqual(once, again);
	assert.equal(ballKind(null, 3), NORMAL);
	assert.equal(ballKind("", 3), NORMAL);
});

test("bonus balls are about 1 in 8 money and 1 in 40 rainbow", () => {
	const counts = [0, 0, 0];
	for (let t = 0; t < 2000; t++) {
		const token = `${1793883270459 + t * 7919}.${((t * 2654435761) >>> 0).toString(16)}.abc`;
		for (let i = 0; i < 30; i++) counts[ballKind(token, i)]++;
	}
	const total = counts.reduce((a, b) => a + b);
	assert.ok(Math.abs(counts[MONEY] / total - 1 / 8) < 0.01, `money ${counts[MONEY] / total}`);
	assert.ok(Math.abs(counts[RAINBOW] / total - 1 / 40) < 0.005, `rainbow ${counts[RAINBOW] / total}`);
});

test("a shot log adds up by the rules", () => {
	// 12 twos in a row: 3 at no bonus, 3 at +1, 4 at +2, 2 at +3 = 6 + 9 + 16 + 10
	const run = Array.from({ length: 12 }, (_, i) => [i * 2, 0, 1, 0, 0] as [number, number, number, number, number]);
	assert.equal(recountScore(run), 41);
	// A miss ends the streak.
	assert.equal(
		recountScore([
			[1, 0, 1, 0, 0],
			[3, 0, 1, 0, 0],
			[5, 0, 1, 0, 0],
			[7, 0, 0, 0.8, 0],
			[9, 1, 1, 0, 0],
		]),
		2 + 2 + 2 + 3,
	);
	// Games from before bonus balls have no fifth number.
	assert.equal(
		recountScore([
			[1, 1, 1, 0],
			[3, 0, 1, 0],
		]),
		5,
	);
	// The same 12 with a money ball second and a rainbow ball eleventh (a real game from the tests).
	const bonus = run.map((s, i) => [s[0], 0, 1, 0, i === 1 ? MONEY : i === 10 ? RAINBOW : 0] as [number, number, number, number, number]);
	assert.equal(recountScore(bonus), 46);
});

test("modes", () => {
	assert.equal(modeOf("survival"), "survival");
	assert.equal(modeOf("around"), "around");
	assert.equal(modeOf(undefined), "timed");
	assert.equal(modeOf("nope"), "timed");
	assert.equal(lowWins("around"), true);
	assert.equal(lowWins("timed"), false);
});
