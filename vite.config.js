// Builds the static site into dist/ (npm run build). Every page keeps its URL; scripts and stylesheets
// are bundled with hashed names in dist/build/, and everything the code fetches by URL at runtime is
// copied across unchanged (STATIC below). GitHub Actions builds and publishes it on every push to main
// (.github/workflows/pages.yml). A new page goes in PAGES; a new file fetched by URL goes in STATIC.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  // The admin page (served by the Worker) imports it to draw players exactly as the game does. Its only
  // imports are shades.js beside it and engine/download.js, so the plain files work; the site's pages
  // use their own bundled copy.
  "players/recolor.js",
  "players/shades.js",
  "engine/download.js",
  "robots.txt",
  "sitemap.xml",
  "CNAME",
  ".nojekyll",
];

// Changes each page before Vite reads it:
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
        const fix = (url) => (rootBase && !/^(\/|[a-z]+:)/i.test(url) ? `/${url}` : url);
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

// The game sends its version with every score (game.js reads it from its own address, so `npm run dev`
// has none). The build puts in the commit it was built from: GITHUB_SHA in Actions, else git here.
function commit() {
  try {
    return (process.env.GITHUB_SHA ?? execSync("git rev-parse HEAD", { cwd: ROOT }).toString()).trim().slice(0, 8);
  } catch {
    return "local";
  }
}

function gameVersion() {
  const expr = 'new URL(import.meta.url).searchParams.get("v")';
  return {
    name: "orson-game-version",
    apply: "build",
    transform(code, id) {
      if (id !== resolve(ROOT, "game.js")) return null;
      if (!code.includes(expr)) this.error(`game.js no longer reads its version with ${expr}; update vite.config.js`);
      return code.replace(expr, JSON.stringify(commit()));
    },
  };
}

// The service worker (sw.js, offline play): written into dist/ with this build's /build/ files, its
// commit and the time it was built, so each deploy is a new worker that knows its own files.
// And the built players kept between visits (play/kept.js) are named with a hash of the code that
// builds them, so a change to it builds them again.
function offline() {
  const playerCode = () => {
    const files = [...readdirSync(resolve(ROOT, "players")).filter((f) => f.endsWith(".js")).map((f) => `players/${f}`), "play/players.js", "play/kept.js"];
    const hash = createHash("sha256");
    for (const f of files.sort()) hash.update(f).update(readFileSync(resolve(ROOT, f)));
    return hash.digest("hex").slice(0, 12);
  };
  let outDir;
  return {
    name: "orson-offline",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transform(code, id) {
      if (id !== resolve(ROOT, "play/kept.js")) return null;
      if (!code.includes("__PLAYER_CODE__")) this.error("play/kept.js no longer has __PLAYER_CODE__; update vite.config.js");
      return code.replace("__PLAYER_CODE__", playerCode());
    },
    writeBundle() {
      const build = readdirSync(resolve(outDir, "build")).map((f) => `/build/${f}`);
      const sw = readFileSync(resolve(ROOT, "sw.js"), "utf8");
      for (const token of ["__VERSION__", "__BUILT_AT__", "__BUILD__"]) if (!sw.includes(token)) this.error(`sw.js no longer has ${token}`);
      writeFileSync(
        resolve(outDir, "sw.js"),
        sw.replace("__VERSION__", commit()).replace("__BUILT_AT__", String(Date.now())).replace("__BUILD__", JSON.stringify(build)),
      );
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

// The pixel font's woff2 files at a fixed address, /fonts/press-start-2p/, for the admin page (served
// by the Worker, so not part of this build; it loads them from the site). Copied into dist/, and
// served by the dev server too, which is the site the local admin page uses. The site's own pages get
// the font through styles.css, with hashed names.
function adminFont() {
  const from = resolve(ROOT, "node_modules/@fontsource/press-start-2p/files");
  const url = "/fonts/press-start-2p/";
  const files = () => readdirSync(from).filter((f) => f.endsWith(".woff2"));
  let outDir;
  return {
    name: "orson-admin-font",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(url, (req, res, next) => {
        const file = files().find((f) => req.url === `/${f}`);
        if (!file) return next();
        res.setHeader("Content-Type", "font/woff2");
        res.setHeader("Access-Control-Allow-Origin", "*"); // the local admin page is on the Worker's port
        res.end(readFileSync(resolve(from, file)));
      });
    },
    writeBundle() {
      for (const file of files()) cpSync(resolve(from, file), resolve(outDir, url.slice(1), file));
    },
  };
}

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "build",
    // Font files stay files (never inlined into every stylesheet); the browser fetches only what it uses.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
    modulePreload: { polyfill: false }, // every browser the game runs in has modulepreload
    rollupOptions: {
      input: Object.fromEntries(Object.entries(PAGES).map(([name, page]) => [name, resolve(ROOT, page)])),
    },
  },
  plugins: [pages(), gameVersion(), offline(), copyStatic(), adminFont()],
});
