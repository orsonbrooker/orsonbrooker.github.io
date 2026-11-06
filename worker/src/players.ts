// Players made with the builder: a base body, five colours and a nickname. They wait for approval
// in the admin inbox before they're in the game.

import { HttpError } from "./http.ts";
import { checkTurnstile, clean, hash, ipKey, isRude, json, readJson, RUDE } from "./util.ts";
import type { Env } from "./util.ts";

export const MAX_PLAYER_NAME = 12;
export const MAX_TEAM_NAME = 10;
export const PLAYER_PARTS = ["skin", "hair", "jersey", "team", "shoes"] as const;
const PLAYERS_PER_HOUR = 3;

export async function listPlayers(env: Env): Promise<Response> {
	const players = await env.DB.prepare(
		"SELECT id, name, base, skin, hair, jersey, team, shoes, number, team_name FROM players WHERE status = 'approved' ORDER BY name COLLATE NOCASE",
	).all();
	return json({ players: players.results }, 200, 60);
}

export async function createPlayer(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const name = clean(body.name, MAX_PLAYER_NAME);
	if (!/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(name)) throw new HttpError(400, "Pick a nickname with letters and numbers.");
	const base = clean(body.base, 30);
	if (!/^[a-z0-9-]+$/.test(base)) throw new HttpError(400, "Pick a body.");
	const colours = (body.colours ?? {}) as Record<string, unknown>;
	for (const part of PLAYER_PARTS) {
		if (typeof colours[part] !== "string" || !/^#[0-9a-f]{6}$/i.test(colours[part] as string)) throw new HttpError(400, "Pick all the colours.");
	}
	const number = body.number === undefined || body.number === null || body.number === "" ? null : String(body.number);
	if (number !== null && !/^\d{1,2}$/.test(number)) throw new HttpError(400, "Numbers go from 0 to 99.");
	const teamName = clean(body.teamName, MAX_TEAM_NAME).toUpperCase();
	if (teamName && !/^[A-Z0-9 ]+$/.test(teamName)) throw new HttpError(400, "Team names use letters and numbers.");
	if (isRude(name, teamName)) throw new HttpError(400, RUDE);
	await checkTurnstile(request, env, body.turnstileToken);

	const ipHash = await ipKey(request, env);
	const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')")
		.bind(ipHash)
		.first<{ n: number }>();
	if ((recent?.n ?? 0) >= PLAYERS_PER_HOUR) throw new HttpError(429, "That's a lot of players! Try again in a bit.");

	await env.DB.prepare(
		"INSERT INTO players (name, base, skin, hair, jersey, team, shoes, number, team_name, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(name, base, ...PLAYER_PARTS.map((p) => (colours[p] as string).toLowerCase()), number, teamName || "KINGS", ipHash)
		.run();

	// If they've played as this player on their device, its leaderboard scores get this look.
	const localId = String(body.localId ?? "");
	const device = clean(body.device, 64);
	if (/^me\d{1,15}$/.test(localId) && device.length >= 16) {
		const look = JSON.stringify(Object.fromEntries(PLAYER_PARTS.map((p) => [p, (colours[p] as string).toLowerCase()])));
		await env.DB.prepare("UPDATE scores SET colours = ?, base = ? WHERE device = ? AND player = ?")
			.bind(look, base, await hash(env, `device:${device}`), localId)
			.run();
	}
	return json({ ok: true });
}
