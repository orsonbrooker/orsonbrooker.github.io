// A leaderboard game's card (worker/src/scores.ts): its stats from the shot log, and features that
// only count for games played after they went live.
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { MONEY, RAINBOW, recountScore } from "../../shared/rules.js";
import { cardStats, hadFeature } from "../src/scores.ts";

type Shot = [number, number, number, number, number];
const NEW = "2026-11-06 10:00:00"; // after supernova and bonus balls
const OLD = "2026-11-05 12:00:00"; // before them

const shot = (i: number, made: boolean, timing = 0, kind = 0, three = 0): Shot => [1 + i * 1.5, three, made ? 1 : 0, timing, kind];

test("features count from the time they went live", () => {
	assert.equal(hadFeature("2026-11-05 20:46:59", "supernova"), false);
	assert.equal(hadFeature("2026-11-05 20:47:00", "supernova"), true);
	assert.equal(hadFeature("2026-11-06 08:00:00", "bonusBalls"), true);
	assert.equal(hadFeature(OLD, "bonusBalls"), false);
});

// Ten in a row (a money ball made, a three), a miss on a rainbow ball, then three more.
const timed: Shot[] = [
	...Array.from({ length: 10 }, (_, i) => shot(i, true, i === 4 ? 0.6 : 0.1, i === 1 ? MONEY : 0, i === 2 ? 1 : 0)),
	shot(10, false, -0.8, RAINBOW),
	...Array.from({ length: 3 }, (_, i) => shot(11 + i, true, -0.5)),
];

test("a Time attack card: streaks, fire, bonus balls, bonus points, green releases", () => {
	const score = recountScore(timed);
	const stats = cardStats(timed, "timed", score, NEW);
	assert.deepEqual(stats, {
		bestStreak: 10,
		onFire: 2, // at 3 in the first run, and again after the miss
		supernova: 1,
		money: { seen: 1, made: 1 },
		rainbow: { seen: 1, made: 0 },
		bonusPoints: score - (12 * 2 + 3),
		hottestFire: 3,
		missTiming: null, // only for sudden death
		tries: [],
		green: 12, // all but the 0.6 and -0.8 releases
	});
	// The bonus comes from the saved score, so an older game keeps what it really got.
	assert.equal(cardStats(timed, "timed", 27, NEW).bonusPoints, 0);
	assert.equal(cardStats(timed, "timed", 20, NEW).bonusPoints, 0);
});

test("an older game's card leaves out supernova and bonus balls", () => {
	const stats = cardStats(timed, "timed", recountScore(timed), OLD);
	assert.equal(stats.supernova, null);
	assert.equal(stats.money, null);
	assert.equal(stats.rainbow, null);
	assert.equal(stats.hottestFire, 2); // purple was as hot as it got then
	assert.equal(stats.bestStreak, 10);
});

test("a sudden death card shows how the last shot was let go", () => {
	const log = [shot(0, true), shot(1, true), shot(2, true), shot(3, false, 0.7)];
	const stats = cardStats(log, "survival", recountScore(log), NEW);
	assert.equal(stats.missTiming, 0.7);
	assert.equal(stats.hottestFire, 1);
	assert.equal(stats.onFire, 1);
	assert.equal(cardStats([shot(0, true)], "survival", 2, NEW).missTiming, null);
});

test("an around the world card counts tries at each spot, and no bonus points", () => {
	const made = [false, true, true, false, false, true, true, true, true, true, true, false];
	const log = made.map((m, i) => shot(i, m));
	const stats = cardStats(log, "around", 175, NEW);
	assert.deepEqual(stats.tries, [2, 1, 3, 1, 1, 1, 1]); // the miss after the 7th spot isn't counted
	assert.equal(stats.bonusPoints, 0);
});
