// The server's checks on a game sent to the leaderboard (worker/src/scoring.ts).
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { MONEY, MONEY_CHANCE, RAINBOW_CHANCE, ballKind, recountScore } from "../../shared/rules.js";
import { AROUND_FASTEST, atLeast, checkGame, oddFlags } from "../src/scoring.ts";

type Shot = [number, number, number, number, number];
const TOKEN = "1793883270459.972cfa07.10e188c";

// A believable Time attack game: a shot every ~2 seconds, varied timing, a miss now and then, and the
// bonus balls this token really gives.
function timedGame(count = 20): Shot[] {
	return Array.from({ length: count }, (_, i) => [1 + i * 2.1 + ((i * 13) % 7) * 0.12, i % 3 === 0 ? 1 : 0, i % 7 === 6 ? 0 : 1, ((i * 37) % 11) / 20 - 0.25, ballKind(TOKEN, i)] as Shot);
}

const rejects = (fn: () => unknown, message: RegExp) => assert.throws(fn, (err: Error & { status?: number }) => err.status === 400 && message.test(err.message));

test("a real Time attack game passes", () => {
	const shots = timedGame();
	const game = checkGame("timed", recountScore(shots), shots, TOKEN);
	assert.equal(game.shots.length, 20);
	assert.equal(game.minSeconds, 59);
	assert.deepEqual(oddFlags("timed", recountScore(shots), game, 40), []);
});

test("a score that doesn't match its shots is rejected", () => {
	const shots = timedGame();
	rejects(() => checkGame("timed", recountScore(shots) + 2, shots, TOKEN), /doesn't match its shots/);
	rejects(() => checkGame("timed", 0, [], TOKEN), /doesn't match its shots/);
});

test("a bonus ball the token didn't give is rejected", () => {
	const shots = timedGame();
	const i = shots.findIndex((s) => s[4] === 0);
	shots[i][4] = MONEY;
	rejects(() => checkGame("timed", recountScore(shots), shots, TOKEN), /Bad shot log/);
});

test("shots too close together, out of order, or after the buzzer are rejected", () => {
	const quick = timedGame().map((s, i) => [i * 0.5, ...s.slice(1)] as Shot);
	rejects(() => checkGame("timed", recountScore(quick), quick, TOKEN), /too quickly/);
	const late = timedGame();
	late[late.length - 1][0] = 61;
	rejects(() => checkGame("timed", recountScore(late), late, TOKEN), /Bad shot log/);
	rejects(() => checkGame("timed", 4, [[1, 0, 1, 0], [1, 0], [3, 0, 1, 0]], TOKEN), /Bad shot log/);
});

test("too many shots for a game is rejected", () => {
	const lots = Array.from({ length: 81 }, (_, i) => [i * 0.7, 0, 0, 0, 0] as Shot);
	rejects(() => checkGame("timed", 1, lots, TOKEN), /more shots than fit/);
});

test("sudden death must end on its first miss", () => {
	const run: Shot[] = [
		[1, 0, 1, 0, 0],
		[3, 0, 1, 0, 0],
		[5, 1, 1, 0, 0],
		[7, 0, 0, 0.9, 0],
	];
	const game = checkGame("survival", recountScore(run), run, "");
	assert.equal(game.made, 3);
	assert.equal(game.minSeconds, 6); // the last shot was 7 seconds in
	const madeAfter: Shot[] = [...run, [9, 0, 1, 0, 0]];
	rejects(() => checkGame("survival", recountScore(madeAfter), madeAfter, ""), /first miss/);
	const noMiss = run.slice(0, 3);
	rejects(() => checkGame("survival", recountScore(noMiss), noMiss, ""), /first miss/);
});

test("around the world: the time must come just after the last spot", () => {
	const trip: Shot[] = [
		[2, 0, 1, 0, 0],
		[4, 0, 0, 0.7, 0],
		[6, 0, 1, 0, 0],
		[8, 0, 1, 0, 0],
		[10, 0, 1, 0, 0],
		[12, 0, 1, 0, 0],
		[14, 0, 1, 0, 0],
		[16, 0, 1, 0, 0],
	];
	const game = checkGame("around", 172, trip, "");
	assert.equal(game.minSeconds, 16.2);
	rejects(() => checkGame("around", 150, trip, ""), /time doesn't match/); // before the last spot
	rejects(() => checkGame("around", 220, trip, ""), /time doesn't match/); // too long after
	rejects(() => checkGame("around", 172, trip.slice(0, 6), ""), /time doesn't match/); // only 5 spots
	const money = trip.map((s) => [...s] as Shot);
	money[0][4] = MONEY;
	rejects(() => checkGame("around", 172, money, "x"), /Bad shot log|time doesn't match/);
});

test("odd games are flagged, not rejected", () => {
	// Every release timed exactly the same, at a perfectly steady rhythm: a script.
	const script = Array.from({ length: 20 }, (_, i) => [1 + i * 2, 0, 1, 0.1, 0] as Shot);
	const game = checkGame("timed", recountScore(script), script, "");
	const flags = oddFlags("timed", recountScore(script), game, null);
	assert.ok(flags.some((f) => /like a script/.test(f)));
	assert.ok(flags.some((f) => /steady rhythm/.test(f)));
	// A huge jump on this device's best.
	const real = timedGame();
	assert.deepEqual(oddFlags("timed", 100, checkGame("timed", recountScore(real), real, TOKEN), 20), ["5x this device's best (20)"]);
	// A perfect game on its own isn't odd.
	const perfect = timedGame(28).map((s) => [s[0], s[1], 1, s[3], s[4]] as Shot);
	assert.deepEqual(oddFlags("timed", recountScore(perfect), checkGame("timed", recountScore(perfect), perfect, TOKEN), 150), []);
});

test("a device's first game in a mode going straight into this week's top 3 is flagged", () => {
	const shots = timedGame();
	const score = recountScore(shots);
	const game = checkGame("timed", score, shots, TOKEN);
	const first = (flags: string[]) => flags.some((f) => /First game in this mode, straight in at #/.test(f));
	assert.ok(first(oddFlags("timed", score, game, null, 1)));
	assert.ok(first(oddFlags("timed", score, game, null, 3)));
	assert.ok(!first(oddFlags("timed", score, game, null, 4))); // a first game further down is normal
	assert.ok(!first(oddFlags("timed", score, game, score - 2, 1))); // they've played this mode before
	assert.ok(!first(oddFlags("timed", score, game, null))); // rank not known
});

test("an around the world time quicker than anyone gets round is flagged", () => {
	// Seven makes a second apart: allowed by the shot gap rule, but far quicker than walking to each spot.
	const rushed: Shot[] = Array.from({ length: 7 }, (_, i) => [0.5 + i, 0, 1, 0.1 * (i % 3), 0]);
	const game = checkGame("around", 70, rushed, "");
	assert.ok(oddFlags("around", 70, game, null).some((f) => /Round in 7s, faster than anyone/.test(f)));
	// The best real trips, about 11.6 s, aren't.
	const real: Shot[] = [0.98, 2.48, 4.15, 5.85, 7.6, 9.33, 10.93].map((t, i) => [t, 0, 1, [-0.177, -0.132, 0.055, -0.433][i % 4], 0]);
	assert.deepEqual(oddFlags("around", 116, checkGame("around", 116, real, ""), 120), []);
	assert.ok(AROUND_FASTEST < 116);
});

test("far more bonus balls than the shots would give is flagged", () => {
	// A start token picked for its luck (new tokens are free): look for one giving 13+ bonus balls in 30 shots.
	let lucky = "";
	for (let n = 0; !lucky; n++) {
		const token = `1793883270459.${n.toString(16).padStart(8, "0")}.x`;
		if (Array.from({ length: 30 }, (_, i) => ballKind(token, i)).filter(Boolean).length >= 13) lucky = token;
	}
	const shots: Shot[] = Array.from({ length: 30 }, (_, i) => [1 + i * 1.9 + (i % 4) * 0.07, i % 4 === 0 ? 1 : 0, i % 5 === 4 ? 0 : 1, ((i * 37) % 11) / 20 - 0.25, ballKind(lucky, i)]);
	const score = recountScore(shots);
	assert.ok(oddFlags("timed", score, checkGame("timed", score, shots, lucky), 100).some((f) => /bonus balls .* a very lucky start token/.test(f)));
	// An ordinary token's share isn't: the luckiest real game so far had 10 in 33 shots.
	assert.ok(atLeast(33, MONEY_CHANCE + RAINBOW_CHANCE, 10) > 1 / 2000);
	assert.ok(atLeast(30, MONEY_CHANCE + RAINBOW_CHANCE, 13) < 1 / 2000);
	assert.ok(atLeast(30, RAINBOW_CHANCE, 6) < 1 / 2000);
	assert.equal(atLeast(5, 0.5, 0), 1);
	assert.ok(Math.abs(atLeast(2, 0.5, 1) - 0.75) < 1e-12);
	assert.ok(atLeast(3, 0.5, 4) === 0);
});
