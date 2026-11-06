// A leaderboard game's card (worker/src/scores.ts): its stats from the shot log, and features that
// only count for games played after they went live.
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { MONEY, RAINBOW, contestBall, recountScore } from "../../shared/rules.js";
import { cardStats, hadFeature, publicDay } from "../src/scores.ts";

type Shot = [number, number, number, number, number];
const NEW = "2026-11-08 10:00:00"; // after supernova, bonus balls, the moving green zone and the 3-point contest
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
		racks: [], // only for the 3-point contest
		movingGreen: false, // Time attack's green zone stays put
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

test("a 3-point contest card counts makes from each rack", () => {
	const made = [1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0];
	const log = made.map((m, i) => shot(i, !!m, 0, contestBall(i) ?? 0, 1));
	const stats = cardStats(log, "threes", recountScore(log), NEW);
	assert.deepEqual(stats.racks, [4, 0, 5, 1]);
	assert.equal(stats.money.seen, 3);
	assert.equal(stats.movingGreen, true);
	assert.deepEqual(cardStats(log, "threes", recountScore(log), OLD).racks, []); // from before the contest
});

test("the moving green zone shows on newer cards in the modes that have it", () => {
	const log = [shot(0, true), shot(1, false)];
	assert.equal(cardStats(log, "survival", 2, NEW).movingGreen, true);
	assert.equal(cardStats(log, "around", 30, NEW).movingGreen, true);
	assert.equal(cardStats(log, "survival", 2, OLD).movingGreen, false);
	assert.equal(cardStats(log, "timed", 2, NEW).movingGreen, false);
	assert.equal(hadFeature("2026-11-06 19:59:59", "movingGreen"), false);
});

test("a card only shows the day a game was played, as the day in Melbourne", () => {
	assert.equal(publicDay("2026-11-06 03:15:42"), "2026-11-06 12:00:00");
	// 9 am on the 7th in Melbourne is still the 6th in UTC.
	assert.equal(publicDay("2026-11-06 22:30:00"), "2026-11-07 12:00:00");
	assert.equal(publicDay("2026-11-06 13:59:59"), "2026-11-06 12:00:00");
	assert.equal(publicDay(null), null);
	// The game reads it as before, and every timezone the players are likely in shows that day.
	const shown = new Date("2026-11-07 12:00:00".replace(" ", "T") + "Z");
	for (const timeZone of ["Australia/Melbourne", "Australia/Perth", "Europe/London", "America/Los_Angeles"])
		assert.equal(new Intl.DateTimeFormat("en-AU", { timeZone, day: "numeric" }).format(shown), "7", timeZone);
});
