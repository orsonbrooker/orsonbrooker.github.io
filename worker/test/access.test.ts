// Checking Cloudflare Access's sign-in token for the admin page (worker/src/access.ts).
// Run: npm --prefix worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { forgetAccessKeys, verifyAccessToken } from "../src/access.ts";
import type { AccessKey } from "../src/access.ts";
import type { Env } from "../src/util.ts";

const env = { ACCESS_TEAM_DOMAIN: "team.example.com", ACCESS_AUD: "aud123" } as Env;
const NOW = 1_800_000_000_000;
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const text = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function keyPair(kid: string) {
	const pair = (await crypto.subtle.generateKey(
		{ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;
	const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid } as AccessKey;
	return { kid, jwk, privateKey: pair.privateKey };
}

async function sign(key: { kid: string; privateKey: CryptoKey }, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
	const unsigned = `${text({ alg: "RS256", kid: key.kid, ...header })}.${text(claims)}`;
	const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(unsigned));
	return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

const good = (extra: Record<string, unknown> = {}) => ({
	aud: ["aud123"],
	iss: "https://team.example.com",
	email: "luke@example.com",
	exp: NOW / 1000 + 600,
	nbf: NOW / 1000 - 10,
	...extra,
});

const denied = (promise: Promise<unknown>) => assert.rejects(promise, (err: Error & { status?: number }) => err.status === 403);

test("a valid Access token passes; bad ones are a 403, never a crash", async () => {
	forgetAccessKeys();
	const key = await keyPair("k1");
	const fetchKeys = async () => [key.jwk];
	assert.equal(await verifyAccessToken(await sign(key, good()), env, fetchKeys, NOW), "luke@example.com");
	for (const token of ["", "nope", "a.b", "a.b.c", "!!!.???.***", `${text({ alg: "RS256", kid: "k1" })}.not-json.x`, `${text("str")}.${text(good())}.AAAA`])
		await denied(verifyAccessToken(token, env, fetchKeys, NOW));
	// Tampered claims, wrong audience or issuer, expired, not yet valid, or not RS256.
	const token = await sign(key, good());
	const [h, , s] = token.split(".");
	await denied(verifyAccessToken(`${h}.${text(good({ email: "someone@else.com" }))}.${s}`, env, fetchKeys, NOW));
	await denied(verifyAccessToken(await sign(key, good({ aud: ["other"] })), env, fetchKeys, NOW));
	await denied(verifyAccessToken(await sign(key, good({ iss: "https://evil.example.com" })), env, fetchKeys, NOW));
	await denied(verifyAccessToken(await sign(key, good({ exp: NOW / 1000 - 1 })), env, fetchKeys, NOW));
	await denied(verifyAccessToken(await sign(key, good({ exp: undefined })), env, fetchKeys, NOW));
	await denied(verifyAccessToken(await sign(key, good({ nbf: NOW / 1000 + 600 })), env, fetchKeys, NOW));
	await denied(verifyAccessToken(await sign(key, good({ nbf: "soon" })), env, fetchKeys, NOW));
	await denied(verifyAccessToken(await sign(key, good(), { alg: "none" }), env, fetchKeys, NOW));
	// A clock a little ahead is fine.
	assert.equal(await verifyAccessToken(await sign(key, good({ nbf: NOW / 1000 + 30 })), env, fetchKeys, NOW), "luke@example.com");
});

test("a token from a new key fetches the keys again, once", async () => {
	forgetAccessKeys();
	const old = await keyPair("old");
	const rotated = await keyPair("new");
	let current = [old.jwk];
	let fetches = 0;
	const fetchKeys = async () => (fetches++, current);
	assert.equal(await verifyAccessToken(await sign(old, good()), env, fetchKeys, NOW), "luke@example.com");
	assert.equal(fetches, 1);
	// Access rotates its keys: the new one isn't known yet, so they're fetched again.
	current = [old.jwk, rotated.jwk];
	const later = NOW + 60_000;
	assert.equal(await verifyAccessToken(await sign(rotated, good()), env, fetchKeys, later), "luke@example.com");
	assert.equal(fetches, 2);
	// A made-up key id is refused, without fetching again straight away.
	const stranger = await keyPair("stranger");
	await denied(verifyAccessToken(await sign(stranger, good()), env, fetchKeys, later + 1000));
	assert.equal(fetches, 2);
});
