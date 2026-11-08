// What every part of the Worker shares: its environment, JSON responses, CORS, reading and tidying
// what's sent, hashing, the robot check and the rude-word filter.

import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";
import { HttpError } from "./http.ts";

export interface Env {
	DB: D1Database;
	SITE_URL: string;
	TURNSTILE_SITE_KEY: string;
	TURNSTILE_SECRET: string;
	HASH_SECRET: string;
	ACCESS_TEAM_DOMAIN?: string;
	ACCESS_AUD?: string;
	NTFY_TOPIC?: string;
	DEV_ADMIN?: string; // local development only: skips the Access check
}

// Rude-word check for everything people type. It sees through tricks like "a$$" and letters spaced
// or dotted out ("f u c k", "f.u.c.k"), without blocking innocent words that happen to contain rude ones.
const rudeWords = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
// A run of two or more single characters (letters, digits and the look-alikes $ @ !) with a few
// spaces or dots between each. Only single characters, so ordinary words with spaces between them
// ("a shot it", "Jo Ann") are never joined together.
const CH = "[\\p{L}\\p{N}$@!]";
const SPACED_OUT = new RegExp(`(?<!${CH})${CH}(?:[^\\p{L}\\p{N}$@!]{1,3}${CH}(?!${CH}))+`, "gu");
/** Text with any spaced-out letters joined up: "f u c k" and "f.u.c.k" read as "fuck". */
export const joinSpacedLetters = (text: string) => text.replace(SPACED_OUT, (run) => run.replace(/[^\p{L}\p{N}$@!]/gu, ""));
// Words the library misses, checked on the text squashed to lower-case letters with look-alike digits
// and symbols swapped back (so "N3gg3r cheese" is caught). Add to this when one gets through; keep each
// pattern tight enough not to catch innocent words (e.g. "snigger" is allowed).
const LOOKALIKES: Record<string, string> = { "4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "0": "o", "5": "s", $: "s", "7": "t" };
const squash = (text: string) =>
	text
		.toLowerCase()
		.replace(/[4@3105$!7]/g, (c) => LOOKALIKES[c])
		.replace(/[^a-z]/g, "");
const EXTRA_RUDE = [/(?<!s)n[ie]+gg+[aeuh]/];
const extraRude = (text: string) => EXTRA_RUDE.some((pattern) => pattern.test(squash(text)));
export const isRude = (...texts: (string | null | undefined)[]) =>
	texts.some((t) => !!t && (rudeWords.hasMatch(t) || rudeWords.hasMatch(joinSpacedLetters(t)) || extraRude(t)));
export const RUDE = "Let's keep it friendly. Try different words.";

export function json(data: unknown, status = 200, maxAge = 0): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
	});
}

// The live site calls the API from the same domain. Allow local previews and the iOS app (whose
// pages come from inside the app, at capacitor://localhost) to call it too.
export function cors(request: Request, response: Response): Response {
	const origin = request.headers.get("Origin");
	if (origin && (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === "capacitor://localhost")) {
		response.headers.set("Access-Control-Allow-Origin", origin);
		response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		response.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Device");
	}
	return response;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	try {
		const body = await request.json();
		if (body && typeof body === "object") return body as Record<string, unknown>;
	} catch {
		// fall through
	}
	throw new HttpError(400, "Bad request.");
}

/**
 * Only the admin page itself may change things: a JSON body (which a plain form on another site
 * can't send without asking first) from this same site. Browsers say where a request came from in
 * Sec-Fetch-Site; older ones only send Origin, which must then be this site (or the local Worker).
 */
export function requireSameOriginJson(request: Request, env: Env): void {
	const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
	const site = request.headers.get("Sec-Fetch-Site");
	const origin = request.headers.get("Origin");
	const own = [new URL(request.url).origin, new URL(env.SITE_URL).origin];
	const sameOrigin = site ? site === "same-origin" : !!origin && own.includes(origin);
	if (type !== "application/json" || !sameOrigin) throw new HttpError(403, "Not allowed.");
}

// The admin page's own addresses: /admin (the inbox) and one per section (admin.html opens the section
// from its address). Every one gets the same page, behind the same sign-in check (admin.ts).
export const ADMIN_SECTIONS = ["ideas", "players", "scores"];
const ADMIN_PAGE = new RegExp(`^/admin(/(${ADMIN_SECTIONS.join("|")}))?/?$`);
export const isAdminPage = (path: string) => ADMIN_PAGE.test(path);

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"];
/**
 * Asked for at this machine's own address (localhost, 127.0.0.1 or [::1]), not a network one, and,
 * where the client's address is known, from this machine too (a Host header is easy to fake).
 */
export function isLocalHost(request: Request): boolean {
	const client = request.headers.get("CF-Connecting-IP");
	return LOOPBACK.includes(new URL(request.url).hostname) && (!client || LOOPBACK.includes(client) || client === "::ffff:127.0.0.1");
}

/** Text as sent, with runs of spaces made one, trimmed and cut to `max`. Anything but a string is "". */
export function clean(value: unknown, max: number): string {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export async function hash(env: Env, value: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.HASH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
	return [...new Uint8Array(sig)]
		.slice(0, 16)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// IP + today's date, hashed: enough to rate limit, never the address itself.
export function ipKey(request: Request, env: Env): Promise<string> {
	const ip = request.headers.get("CF-Connecting-IP") ?? "local";
	return hash(env, `ip:${ip}:${new Date().toISOString().slice(0, 10)}`);
}

/**
 * Counts a call to a cheap route (bucket) from this IP today, in one write, and refuses it (429,
 * with `message`) once there have been more than `perDay`.
 */
export async function rateLimit(request: Request, env: Env, bucket: string, perDay: number, message: string): Promise<void> {
	const row = await env.DB.prepare(
		`INSERT INTO rate_limits (bucket, ip_hash, day, count) VALUES (?, ?, date('now'), 1)
		 ON CONFLICT (bucket, ip_hash, day) DO UPDATE SET count = count + 1 RETURNING count`,
	)
		.bind(bucket, await ipKey(request, env))
		.first<{ count: number }>();
	if ((row?.count ?? 0) > perDay) throw new HttpError(429, message);
}

export async function checkTurnstile(request: Request, env: Env, token: unknown) {
	if (typeof token !== "string" || !token) throw new HttpError(400, "Please finish the robot check.");
	const form = new FormData();
	form.append("secret", env.TURNSTILE_SECRET);
	form.append("response", token);
	const ip = request.headers.get("CF-Connecting-IP");
	if (ip) form.append("remoteip", ip);
	const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
	const outcome = await res.json<{ success: boolean; hostname?: string }>();
	if (!outcome.success) throw new HttpError(400, "The robot check didn't work. Please try again.");
	// On the live site, only accept checks passed on this site (local test keys report another host).
	if (env.ACCESS_AUD && outcome.hostname !== new URL(env.SITE_URL).hostname) {
		throw new HttpError(400, "The robot check didn't work. Please try again.");
	}
}
