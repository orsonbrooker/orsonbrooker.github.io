// Coins from a game's shot log (shared/rules.js) and the shop list (shared/shop.js).
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { MONEY, RAINBOW, coinsFor } from "../../shared/rules.js";
import type { Shot } from "../../shared/rules.js";
import { BALL_STYLES, DEFAULT_BALL, ballStyle } from "../../shared/shop.js";

const shot = (made: number, kind = 0): Shot => [0, 0, made, 0, kind];

test("a coin a basket, none for a miss", () => {
	assert.equal(coinsFor([]), 0);
	assert.equal(coinsFor([shot(1), shot(0), shot(1)]), 2);
});

test("two coins a basket while on fire (from 3 in a row), back to one after a miss", () => {
	// makes 1-3 earn 1 each; 4 and 5 are made on fire; then a miss and a make
	assert.equal(coinsFor([shot(1), shot(1), shot(1), shot(1), shot(1), shot(0), shot(1)]), 3 + 2 + 2 + 1);
});

test("five coins for a money or rainbow ball that goes in", () => {
	assert.equal(coinsFor([shot(1, MONEY), shot(0, RAINBOW), shot(1, RAINBOW)]), 10);
});

test("the shop: unique ids, Classic free, everything else costs something", () => {
	assert.equal(new Set(BALL_STYLES.map((s) => s.id)).size, BALL_STYLES.length);
	assert.equal(ballStyle(DEFAULT_BALL)?.price, 0);
	assert.ok(BALL_STYLES.filter((s) => s.id !== DEFAULT_BALL).every((s) => s.price > 0));
	assert.equal(ballStyle("nope"), null);
});
