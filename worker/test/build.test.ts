// A builder player's size (height and bulk): what the Worker accepts and what the game gets back.
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILD_STEPS, buildOf, parseBuild } from "../src/players.ts";

test("a size is two of the builder's five steps, or none", () => {
	for (const height of BUILD_STEPS) for (const bulk of BUILD_STEPS) assert.deepEqual(parseBuild({ height, bulk }), { height, bulk });
	assert.equal(parseBuild(undefined), undefined);
	assert.equal(parseBuild(null), undefined);
});

test("anything else isn't a size", () => {
	for (const v of [
		{ height: 2, bulk: 0 },
		{ height: 0.25, bulk: 0 },
		{ height: -1.5, bulk: 0 },
		{ height: "1", bulk: 0 },
		{ height: 0, bulk: NaN },
		{ height: 0, bulk: Infinity },
		{ height: 0 },
		{ bulk: 0 },
		{ height: 0, bulk: 0, extra: 1 },
		{ height: null, bulk: null },
		{},
		[0, 0],
		"tall",
		0,
		true,
	])
		assert.equal(parseBuild(v), "bad", JSON.stringify(v));
});

test("a saved player's size for the game, null when it has none", () => {
	assert.equal(buildOf({ height: null, bulk: null }), null);
	assert.deepEqual(buildOf({ height: 1, bulk: -0.5 }), { height: 1, bulk: -0.5 });
	assert.deepEqual(buildOf({ height: 0.5, bulk: null }), { height: 0.5, bulk: 0 });
});
