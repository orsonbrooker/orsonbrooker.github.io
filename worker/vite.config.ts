import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [cloudflare()],
	// The static site's local preview uses 5173.
	server: { port: 8787 },
});
