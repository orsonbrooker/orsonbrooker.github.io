// Saved progress: coins earned by playing, the ball styles they buy, and pairing another device.
//
// No accounts with names or passwords. The first game that earns coins makes a progress and gives the
// device a random key (kept in its browser, stored here only as a keyed hash). To carry it to another
// device, one device asks for a pairing code (works once, for 10 minutes) and the other types it in.
// Coins come only from checked games (the same checks as the leaderboard, scoring.ts), one claim per
// game, so they can't be made up any more easily than a score.

import { coinsFor, modeOf } from "../../shared/rules.js";
import { BALL_STYLES, DEFAULT_BALL, ballStyle } from "../../shared/shop.js";
import { HttpError } from "./http.ts";
import { checkGameToken } from "./scores.ts";
import { checkGame } from "./scoring.ts";
import { clean, hash, ipKey, json, rateLimit, readJson } from "./util.ts";
import type { Env } from "./util.ts";

const NEW_PER_DAY = 30; // new progresses from one IP (a class on one network shares an IP)
const GAMES_PER_DAY = 300; // coin claims from one IP
const CODES_PER_DAY = 30; // pairing codes asked for
const TRIES_PER_DAY = 15; // pairing codes typed in (also stops guessing)
const CODE_MINUTES = 10;
// No 0/O, 1/I/L: easy to read out and type. 8 of these is about 40 bits, with 15 tries a day.
const CODE_LETTERS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

type Progress = { id: number; coins: number; earned: number; ball: string };

const keyHash = (env: Env, key: string) => hash(env, `progress:${key}`);
const codeHash = (env: Env, code: string) => hash(env, `pair:${code}`);

function newKey(): string {
	return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return [...bytes].map((b) => CODE_LETTERS[b % CODE_LETTERS.length]).join(""); // 256 % 31 bias is tiny and harmless here
}

// A typed code: letters and numbers only, upper case (so "abcd-efgh" and "ABCDEFGH" both work).
const tidyCode = (value: unknown) =>
	clean(value, 20)
		.toUpperCase()
		.replace(/[^0-9A-Z]/g, "");

async function findProgress(env: Env, key: unknown): Promise<Progress | null> {
	const k = clean(key, 64);
	if (!/^[0-9a-f]{48}$/.test(k)) return null;
	return env.DB.prepare("SELECT p.id, p.coins, p.earned, p.ball FROM progress_devices d JOIN progress p ON p.id = d.progress_id WHERE d.key_hash = ?")
		.bind(await keyHash(env, k))
		.first<Progress>();
}

async function mustFind(env: Env, key: unknown): Promise<Progress> {
	const found = await findProgress(env, key);
	if (!found) throw new HttpError(404, "We couldn't find your coins on this device.");
	return found;
}

// What the game shows: coins, the ball in use and what they own (Classic always).
async function view(env: Env, id: number, key?: string) {
	const [p, items] = await env.DB.batch([
		env.DB.prepare("SELECT coins, earned, ball FROM progress WHERE id = ?").bind(id),
		env.DB.prepare("SELECT item FROM progress_items WHERE progress_id = ?").bind(id),
	]);
	const row = p.results[0] as { coins: number; earned: number; ball: string };
	const owned = new Set([DEFAULT_BALL, ...(items.results as { item: string }[]).map((r) => r.item)]);
	return { ...(key ? { key } : {}), coins: row.coins, earned: row.earned, ball: row.ball, items: BALL_STYLES.filter((s) => owned.has(s.id)).map((s) => s.id) };
}

// A new progress with this device's key in it.
async function create(request: Request, env: Env): Promise<{ id: number; key: string }> {
	await rateLimit(request, env, "progress-new", NEW_PER_DAY, "That's a lot of new players for one day! Try again tomorrow.");
	const key = newKey();
	const row = await env.DB.prepare("INSERT INTO progress DEFAULT VALUES RETURNING id").first<{ id: number }>();
	if (!row) throw new HttpError(500, "Something went wrong.");
	await env.DB.prepare("INSERT INTO progress_devices (key_hash, progress_id) VALUES (?, ?)").bind(await keyHash(env, key), row.id).run();
	return { id: row.id, key };
}

/** POST /api/progress { key }: their coins and ball styles. */
export async function getProgress(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const p = await mustFind(env, body.key);
	return json(await view(env, p.id));
}

/**
 * POST /api/progress/games { key?, token, mode, score, shots }: a finished game earns its coins.
 * Checked like a leaderboard score, once per game. Without a key (their first coins), a new
 * progress is made and its key sent back.
 */
export async function claimGame(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	if (body.debug) throw new HttpError(400, "Games in test mode don't earn coins.");
	const mode = modeOf(body.mode);
	const game = checkGame(mode, Number(body.score), body.shots, body.token);
	await checkGameToken(env, body.token, game.minSeconds);
	const coins = coinsFor(game.shots);
	if (coins < 1) throw new HttpError(400, "No coins in that game.");
	await rateLimit(request, env, "progress-game", GAMES_PER_DAY, "That's a lot of games for one day! Try again tomorrow.");

	let found = await findProgress(env, body.key);
	let key: string | undefined;
	if (!found) {
		const made = await create(request, env);
		key = made.key;
		found = { id: made.id, coins: 0, earned: 0, ball: DEFAULT_BALL };
	}
	const claimed = await env.DB.prepare("INSERT OR IGNORE INTO progress_games (token, progress_id, mode, coins, ip_hash) VALUES (?, ?, ?, ?, ?) RETURNING token")
		.bind(String(body.token), found.id, mode, coins, await ipKey(request, env))
		.first();
	if (!claimed) throw new HttpError(400, "That game's coins are already in.");
	await env.DB.prepare("UPDATE progress SET coins = coins + ?1, earned = earned + ?1 WHERE id = ?2").bind(coins, found.id).run();
	return json({ ...(await view(env, found.id, key)), got: coins });
}

/** POST /api/progress/buy { key, item }: spend coins on a ball style. */
export async function buy(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const p = await mustFind(env, body.key);
	const style = ballStyle(body.item);
	if (!style || style.price < 1) throw new HttpError(400, "That's not in the shop.");
	const poor = () => new HttpError(400, "You need more coins for that one. Keep shooting!");
	if (p.coins < style.price) throw poor();
	// The item first: its key means a double tap can't add (or pay for) it twice. Then the coins, only
	// if they still have enough (another buy might have just spent them); if not, the item goes again.
	const added = await env.DB.prepare("INSERT OR IGNORE INTO progress_items (progress_id, item) VALUES (?, ?) RETURNING item").bind(p.id, style.id).first();
	if (!added) throw new HttpError(400, "You've already got that one.");
	const paid = await env.DB.prepare("UPDATE progress SET coins = coins - ?1, ball = ?3 WHERE id = ?2 AND coins >= ?1 RETURNING id").bind(style.price, p.id, style.id).first();
	if (!paid) {
		await env.DB.prepare("DELETE FROM progress_items WHERE progress_id = ? AND item = ?").bind(p.id, style.id).run();
		throw poor();
	}
	return json(await view(env, p.id));
}

/** POST /api/progress/ball { key, ball }: use a ball style they own. */
export async function useBall(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const p = await mustFind(env, body.key);
	const style = ballStyle(body.ball);
	if (!style) throw new HttpError(400, "That's not a ball.");
	const owned =
		style.id === DEFAULT_BALL || (await env.DB.prepare("SELECT 1 FROM progress_items WHERE progress_id = ? AND item = ?").bind(p.id, style.id).first());
	if (!owned) throw new HttpError(400, "Get that one in the shop first.");
	await env.DB.prepare("UPDATE progress SET ball = ? WHERE id = ?").bind(style.id, p.id).run();
	return json(await view(env, p.id));
}

/** POST /api/progress/pair { key }: a code to type on another device (once, within 10 minutes). */
export async function pairCode(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const p = await mustFind(env, body.key);
	await rateLimit(request, env, "pair-code", CODES_PER_DAY, "That's a lot of codes for one day! Try again tomorrow.");
	const code = newCode();
	await env.DB.prepare(`INSERT INTO pair_codes (code_hash, progress_id, expires_at) VALUES (?, ?, datetime('now', '+${CODE_MINUTES} minutes'))`)
		.bind(await codeHash(env, code), p.id)
		.run();
	return json({ code: `${code.slice(0, 4)}-${code.slice(4)}`, minutes: CODE_MINUTES });
}

/**
 * POST /api/progress/join { key?, code }: this device joins the progress the code came from. Any coins
 * and balls this device already had are added to it, so nothing's lost.
 */
export async function joinCode(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	await rateLimit(request, env, "pair-join", TRIES_PER_DAY, "That's a lot of tries for one day! Try again tomorrow.");
	const code = tidyCode(body.code);
	if (code.length !== 8) throw new HttpError(400, "A code is 8 letters and numbers.");
	const pair = await env.DB.prepare("DELETE FROM pair_codes WHERE code_hash = ? RETURNING progress_id, expires_at > datetime('now') AS fresh")
		.bind(await codeHash(env, code))
		.first<{ progress_id: number; fresh: number }>();
	if (!pair?.fresh) throw new HttpError(400, "That code didn't work. Codes only last 10 minutes: get a new one and try again.");
	const into = pair.progress_id;

	const mine = await findProgress(env, body.key);
	if (mine && mine.id === into) return json(await view(env, into)); // already together
	let key = clean(body.key, 64);
	if (mine) {
		// Bring this device's coins and balls along, then move its devices across.
		await env.DB.batch([
			env.DB.prepare("UPDATE progress SET coins = coins + ?1, earned = earned + ?2 WHERE id = ?3").bind(mine.coins, mine.earned, into),
			env.DB.prepare("INSERT OR IGNORE INTO progress_items (progress_id, item, created_at) SELECT ?1, item, created_at FROM progress_items WHERE progress_id = ?2").bind(into, mine.id),
			env.DB.prepare("DELETE FROM progress_items WHERE progress_id = ?").bind(mine.id),
			env.DB.prepare("UPDATE progress_devices SET progress_id = ?1 WHERE progress_id = ?2").bind(into, mine.id),
			env.DB.prepare("UPDATE progress_games SET progress_id = ?1 WHERE progress_id = ?2").bind(into, mine.id),
			env.DB.prepare("DELETE FROM pair_codes WHERE progress_id = ?").bind(mine.id),
			env.DB.prepare("DELETE FROM progress WHERE id = ?").bind(mine.id),
		]);
	} else {
		key = newKey();
		await env.DB.prepare("INSERT INTO progress_devices (key_hash, progress_id) VALUES (?, ?)").bind(await keyHash(env, key), into).run();
	}
	return json(await view(env, into, key));
}
