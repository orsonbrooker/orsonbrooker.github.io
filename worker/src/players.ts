// Players made with the builder: a base body, five colours, a nickname, maybe a pronoun (for the
// announcer's lines) and maybe a size (height and bulk, from the builder's sliders). They wait for approval in the admin inbox before they're in the game.

import { requireBodyOut, requireFlag } from "./flags.ts";
import { HttpError } from "./http.ts";
import { checkTurnstile, clean, hash, ipKey, isUnfriendly, json, readJson, RUDE } from "./util.ts";
import type { Env } from "./util.ts";

export const MAX_PLAYER_NAME = 12;
export const MAX_TEAM_NAME = 10;
export const PLAYER_PARTS = ["skin", "hair", "jersey", "team", "shoes"] as const;

/** Shorts in a colour of their own: a colour, or null to wear the team colour (the jersey's trim). */
export const parseShorts = (value: unknown): string | null => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null);

/** The look saved with a score: the five colours, and the shorts when they have their own. */
export const lookJson = (colours: Record<string, unknown>) => {
	const shorts = parseShorts(colours.shorts);
	return JSON.stringify({ ...Object.fromEntries(PLAYER_PARTS.map((p) => [p, String(colours[p]).toLowerCase()])), ...(shorts ? { shorts } : {}) });
};
const PLAYERS_PER_HOUR = 3;

/** A nickname starts with a letter or number, then letters, numbers, spaces, ' and -. */
export const isNickname = (name: string) => /^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(name);

/** A player's pronoun: "he" or "she", or null for anything else (not answered). */
export const parsePronoun = (value: unknown): "he" | "she" | null => (value === "he" || value === "she" ? value : null);

/** The builder's five size steps for height and bulk (0 is the body as drawn). */
export const BUILD_STEPS = [-1, -0.5, 0, 0.5, 1] as const;
type Build = { height: number; bulk: number };
const isStep = (v: unknown): v is number => typeof v === "number" && (BUILD_STEPS as readonly number[]).includes(v);

/** A player's size: undefined when none was sent, the size when it's exactly two of the five steps, else "bad". */
export function parseBuild(value: unknown): Build | undefined | "bad" {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "object" || Array.isArray(value)) return "bad";
	const keys = Object.keys(value);
	const { height, bulk } = value as Record<string, unknown>;
	if (keys.length !== 2 || !isStep(height) || !isStep(bulk)) return "bad";
	return { height, bulk };
}

/** A saved player's size for the game: null when it has none (drawn at normal size). */
export const buildOf = (row: { height: number | null; bulk: number | null }): Build | null =>
	row.height === null && row.bulk === null ? null : { height: row.height ?? 0, bulk: row.bulk ?? 0 };

export async function listPlayers(env: Env): Promise<Response> {
	const players = await env.DB.prepare(
		"SELECT id, name, base, skin, hair, jersey, team, shorts, shoes, number, team_name, pronoun, height, bulk FROM players WHERE status = 'approved' ORDER BY name COLLATE NOCASE",
	).all<Record<string, unknown> & { height: number | null; bulk: number | null }>();
	return json({ players: players.results.map(({ height, bulk, ...p }) => ({ ...p, build: buildOf({ height, bulk }) })) }, 200, 60);
}

export async function createPlayer(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const name = clean(body.name, MAX_PLAYER_NAME);
	if (!isNickname(name)) throw new HttpError(400, "Pick a nickname with letters and numbers.");
	const base = clean(body.base, 30);
	if (!/^[a-z0-9-]+$/.test(base)) throw new HttpError(400, "Pick a body.");
	await requireBodyOut(env, base); // a body that isn't out yet (flags.ts)
	const colours = (body.colours ?? {}) as Record<string, unknown>;
	for (const part of PLAYER_PARTS) {
		if (typeof colours[part] !== "string" || !/^#[0-9a-f]{6}$/i.test(colours[part] as string)) throw new HttpError(400, "Pick all the colours.");
	}
	const number = body.number === undefined || body.number === null || body.number === "" ? null : String(body.number);
	if (number !== null && !/^\d{1,2}$/.test(number)) throw new HttpError(400, "Numbers go from 0 to 99.");
	const teamName = clean(body.teamName, MAX_TEAM_NAME).toUpperCase();
	if (teamName && !/^[A-Z0-9 ]+$/.test(teamName)) throw new HttpError(400, "Team names use letters and numbers.");
	const pronoun = parsePronoun(body.pronoun);
	const build = parseBuild(body.build);
	if (build === "bad") throw new HttpError(400, "Pick a height and build.");
	if (build) await requireFlag(env, "videokids"); // sizes are for kids from video, not out yet (flags.ts)
	if (await isUnfriendly(env, name, teamName)) throw new HttpError(400, RUDE);
	await checkTurnstile(request, env, body.turnstileToken);

	// The same player sent again from the same device (the builder sends its id on this device) while
	// the first is still waiting: this one replaces it, so the inbox has it once. One already approved
	// (or hidden) stays, and this one waits as a new look.
	const sentId = String(body.localId ?? "");
	const sentDevice = clean(body.device, 64);
	const localKey = /^me\d{1,15}$/.test(sentId) && sentDevice.length >= 16 ? await hash(env, `player:${sentDevice}:${sentId}`) : null;
	if (localKey) await env.DB.prepare("DELETE FROM players WHERE local_key = ? AND status = 'new'").bind(localKey).run();

	const ipHash = await ipKey(request, env);
	const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')")
		.bind(ipHash)
		.first<{ n: number }>();
	if ((recent?.n ?? 0) >= PLAYERS_PER_HOUR) throw new HttpError(429, "That's a lot of players! Try again in a bit.");

	await env.DB.prepare(
		"INSERT INTO players (name, base, skin, hair, jersey, team, shoes, shorts, number, team_name, pronoun, height, bulk, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			name,
			base,
			...PLAYER_PARTS.map((p) => (colours[p] as string).toLowerCase()),
			parseShorts(colours.shorts),
			number,
			teamName || "KINGS",
			pronoun,
			build?.height ?? null,
			build?.bulk ?? null,
			ipHash,
		)
		.run();

	// If they've played as this player on their device, its leaderboard scores get this look.
	const localId = String(body.localId ?? "");
	const device = clean(body.device, 64);
	if (/^me\d{1,15}$/.test(localId) && device.length >= 16) {
		// the request just made, marked as this device's player (see above)
		if (localKey)
			await env.DB.prepare("UPDATE players SET local_key = ? WHERE id = (SELECT MAX(id) FROM players WHERE ip_hash = ? AND name = ?)")
				.bind(localKey, ipHash, name)
				.run();
		const look = lookJson(colours);
		await env.DB.prepare("UPDATE scores SET colours = ?, base = ? WHERE device = ? AND player = ?")
			.bind(look, base, await hash(env, `device:${device}`), localId)
			.run();
	}
	return json({ ok: true });
}
