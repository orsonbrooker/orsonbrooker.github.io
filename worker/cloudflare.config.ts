import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// The ideas board API for orsonbrooker.com. The static site stays on GitHub Pages;
// this Worker only answers /api/* and the private /admin page on the same domain.
export default defineConfig(({ mode }) => ({
	worker: {
		name: "orson-ideas",
		compatibilityDate: "2026-10-23",
		entrypoint,
		env: {
			DB: bindings.d1({ name: "orson-ideas", id: "67713a08-4e9f-46b0-874f-bbf9ccf05c4c" }),
			SITE_URL: bindings.text("https://orsonbrooker.com"),
			// Turnstile bot check. The site key is public; the secret is not.
			TURNSTILE_SITE_KEY: bindings.secret(),
			TURNSTILE_SECRET: bindings.secret(),
			// Key for hashing IP addresses and device ids, so neither is stored as-is.
			HASH_SECRET: bindings.secret(),
			// Cloudflare Access, which protects the admin page: team domain and the app's audience tag.
			ACCESS_TEAM_DOMAIN: bindings.secret(),
			ACCESS_AUD: bindings.secret(),
			// Private ntfy.sh topic for the weekly "new ideas to check" phone notification.
			NTFY_TOPIC: bindings.secret(),
			// Skips the Access check, so /admin can be tried locally. Only on in `cf dev`.
			DEV_ADMIN: bindings.text(mode === "development" ? "1" : "0"),
		},
		triggers: [
			triggers.fetch({ pattern: "orsonbrooker.com/api/*", zone: "orsonbrooker.com" }),
			triggers.fetch({ pattern: "orsonbrooker.com/admin*", zone: "orsonbrooker.com" }),
			// Mondays 8am Melbourne (Sunday 21:00 UTC).
			triggers.scheduled({ schedule: "0 21 * * SUN" }),
		],
	},
}));
