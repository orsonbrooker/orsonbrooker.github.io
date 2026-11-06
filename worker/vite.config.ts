import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

// The local Worker skips the admin sign-in (DEV_ADMIN). With --host it's on the network too, and
// the Worker only sees a Host header (which anyone can fake) and 127.0.0.1 for every client, so
// the admin page and API are only answered for this machine's own connections.
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const adminOnlyHere: Plugin = {
	name: "admin-only-from-this-machine",
	configureServer(server) {
		server.middlewares.use((req, res, next) => {
			if (/^\/(api\/)?admin/.test(req.url ?? "") && !LOOPBACK.has(req.socket.remoteAddress ?? "")) {
				res.statusCode = 403;
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify({ error: "The admin page only opens on this computer." }));
				return;
			}
			next();
		});
	},
};

export default defineConfig({
	plugins: [adminOnlyHere, cloudflare()],
	// The static site's local preview uses 5173.
	server: { port: 8787 },
});
