// Checking Cloudflare Access's sign-in token. Access sits in front of /admin and signs every request
// it lets through; the Worker checks that signature too, so the admin API stays locked even if a
// route is misconfigured. Anything wrong with a token is a 403, never a crash.
// Tests: worker/test/access.test.ts.

import { HttpError } from "./http.ts";
import type { Env } from "./util.ts";

export type AccessKey = JsonWebKey & { kid: string };
type FetchKeys = (teamDomain: string) => Promise<AccessKey[]>;

const KEYS_FOR = 3600_000; // keys are fetched again after an hour,
const REFETCH_AFTER = 30_000; // or for a token signed by a key we don't have (Access rotated them), at most this often
const CLOCK_SKEW = 60; // seconds of leeway for nbf (a token from a clock a little ahead)

let keys: { list: AccessKey[]; fetched: number } | null = null;
/** Forgets the fetched keys (for tests). */
export const forgetAccessKeys = () => void (keys = null);

const fetchCerts: FetchKeys = async (teamDomain) => {
	const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
	if (!res.ok) throw new Error(`Access certs: ${res.status}`);
	return (await res.json<{ keys: AccessKey[] }>()).keys;
};

const failed = () => new HttpError(403, "Sign-in check failed.");

/** The signed-in email if `token` is a valid Access token for this app, else a 403. */
export async function verifyAccessToken(token: string, env: Env, fetchKeys: FetchKeys = fetchCerts, now = Date.now()): Promise<string> {
	const teamDomain = env.ACCESS_TEAM_DOMAIN!;
	let head: string, payload: string, signature: Uint8Array;
	let header: { alg?: unknown; kid?: unknown };
	let claims: { aud?: unknown; exp?: unknown; nbf?: unknown; iss?: unknown; email?: unknown };
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw failed();
		[head, payload] = parts;
		header = JSON.parse(b64urlText(head));
		claims = JSON.parse(b64urlText(payload));
		signature = b64urlBytes(parts[2]);
		if (!header || !claims || typeof header !== "object" || typeof claims !== "object") throw failed();
	} catch {
		throw failed();
	}
	if (header.alg !== "RS256" || typeof header.kid !== "string") throw failed();

	if (!keys || now - keys.fetched > KEYS_FOR) keys = { list: await fetchKeys(teamDomain), fetched: now };
	let jwk = keys.list.find((k) => k.kid === header.kid);
	if (!jwk && now - keys.fetched > REFETCH_AFTER) {
		keys = { list: await fetchKeys(teamDomain), fetched: now };
		jwk = keys.list.find((k) => k.kid === header.kid);
	}
	if (!jwk) throw new HttpError(403, "Unknown sign-in key.");

	let valid = false;
	try {
		const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
		valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(`${head}.${payload}`));
	} catch {
		throw failed();
	}
	const seconds = now / 1000;
	const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (
		!valid ||
		!audiences.includes(env.ACCESS_AUD) ||
		typeof claims.exp !== "number" ||
		claims.exp < seconds ||
		(claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - CLOCK_SKEW > seconds)) ||
		claims.iss !== `https://${teamDomain}`
	)
		throw failed();
	return String(claims.email ?? "");
}

function b64urlBytes(s: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
	const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlText(s: string): string {
	return new TextDecoder().decode(b64urlBytes(s));
}
