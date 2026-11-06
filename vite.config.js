// Builds the static site into dist/ (npm run build). Every page keeps its URL; scripts and stylesheets
// are bundled with hashed names in dist/build/, and everything the code fetches by URL at runtime is
// copied across unchanged (STATIC below).
//
// During the move to this build the unbuilt site must keep working, so the source still carries the
// ?v=<hash> stamps from tools/stamp_versions.py. The build ignores them: it strips them from imports, so
// each module is bundled once however it was imported.
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const ROOT = import.meta.dirname;

const PAGES = {
  home: "index.html",
  shootaround: "games/shootaround/index.html",
  players: "players/index.html",
  ideas: "ideas/index.html",
  lab: "lab/index.html",
  notFound: "404.html",
};

// Fetched or linked by URL at runtime (fetch, new Image, <img>, icons, manifests, share images), so
// they keep their paths and names. Dev-only folders (art/, tools/, worker/, notes/, caches) stay out.
const STATIC = [
  "assets",
  "icons",
  "favicon.ico",
  "site.webmanifest",
  "games/shootaround/manifest.webmanifest",
  "robots.txt",
  "sitemap.xml",
  "CNAME",
  ".nojekyll",
];

const STAMP = /\?v=[0-9a-f]+$/;

// Changes each page before Vite reads it:
// - strips ?v= stamps from scripts and stylesheets;
// - on pages with <base href="/"> (the game), makes their relative addresses start at the root, since
//   Vite resolves them from the page's own folder;
// - marks every other address (icons, manifests, images, preloads) vite-ignore so it stays exactly as
//   written and is served from the STATIC copy.
function pages() {
  return {
    name: "orson-pages",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const rootBase = /<base\s+href="\/"/.test(html);
        const fix = (url) => {
          url = url.replace(STAMP, "");
          return rootBase && !/^(\/|[a-z]+:)/i.test(url) ? `/${url}` : url;
        };
        return html
          .replace(/(<script\b[^>]*\bsrc=")([^"]+)(")/g, (_, a, url, b) => a + fix(url) + b)
          .replace(/<link\b[^>]*>/g, (tag) =>
            /\brel="stylesheet"/.test(tag) && !/\bhref="https?:/.test(tag)
              ? tag.replace(/(\bhref=")([^"]+)(")/, (_, a, url, b) => a + fix(url) + b)
              : tag.replace(/^<link\b/, "<link vite-ignore"),
          )
          .replace(/<img\b/g, "<img vite-ignore");
      },
    },
  };
}

// game.js reads its own ?v= stamp as the game version it sends with scores. Bundled, it has no stamp,
// so put in the same value: the first 8 hex digits of the SHA-1 of game.js, as stamp_versions.py makes it.
function gameVersion() {
  const expr = 'new URL(import.meta.url).searchParams.get("v")';
  return {
    name: "orson-game-version",
    apply: "build",
    transform(code, id) {
      if (id !== resolve(ROOT, "game.js")) return null;
      if (!code.includes(expr)) this.error(`game.js no longer reads its version with ${expr}; update vite.config.js`);
      const v = createHash("sha1").update(readFileSync(id, "utf8")).digest("hex").slice(0, 8);
      return code.replace(expr, JSON.stringify(v));
    },
  };
}

// Copies STATIC into dist/ after the bundle is written.
function copyStatic() {
  let outDir;
  return {
    name: "orson-copy-static",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      for (const path of STATIC) {
        const from = resolve(ROOT, path);
        if (!existsSync(from)) this.error(`missing static file: ${path}`);
        cpSync(from, resolve(outDir, path), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  publicDir: false,
  resolve: {
    // import "./ui/icons.js?v=c284e3ca" and import "./icons.js" are the same module.
    alias: [{ find: /^(.+\.(?:js|css))\?v=[0-9a-f]+$/, replacement: "$1" }],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "build",
    modulePreload: { polyfill: false }, // every browser the game runs in has modulepreload
    rollupOptions: {
      input: Object.fromEntries(Object.entries(PAGES).map(([name, page]) => [name, resolve(ROOT, page)])),
    },
  },
  plugins: [pages(), gameVersion(), copyStatic()],
});
