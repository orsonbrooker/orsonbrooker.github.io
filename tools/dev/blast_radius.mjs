#!/usr/bin/env node
// What a branch touches, worked out from its diff: the facts the merge note's "Merge danger" section needs.
//
//   node tools/dev/blast_radius.mjs                 # this branch against test-all
//   node tools/dev/blast_radius.mjs main            # against another base
//   node tools/dev/blast_radius.mjs A --head B      # any two commits (e.g. a merge's two parents)
//   node tools/dev/blast_radius.mjs --json          # the same facts as JSON
//
// It reads `git diff --name-status <base>...<head>` and the code at <head>: which pages reach a changed
// file through their scripts' imports, which modes, players and Worker routes it touches, whether the
// Worker must be deployed, and the "door": one-way (can't be undone with git revert), check (might be;
// a person decides) or two-way. It only states facts from file paths and imports; the pr skill reads the
// diff for the rest. Node built-ins only.

import { execFileSync } from "node:child_process";
import { posix } from "node:path";

const args = process.argv.slice(2);
const json = args.includes("--json");
const headAt = args.indexOf("--head");
const head = headAt >= 0 ? args[headAt + 1] : "HEAD";
const base = args.find((a, i) => !a.startsWith("--") && i !== headAt + 1) ?? "test-all";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 });
// Every page, script, stylesheet and Worker file at <head>, read in one batch (one git call, not one per file).
const shown = new Map();
{
  const paths = git("ls-tree", "-r", "--name-only", head).split("\n")
    .filter((f) => /\.(js|css|html|ts)$/.test(f) && !/^(tools|art|ios|node_modules|worker\/test)\//.test(f));
  const out = execFileSync("git", ["cat-file", "--batch"], { input: paths.map((f) => `${head}:${f}`).join("\n") + "\n", maxBuffer: 256 << 20 });
  let at = 0;
  for (const path of paths) {
    const nl = out.indexOf(10, at);
    const size = +out.subarray(at, nl).toString().split(" ")[2];
    shown.set(path, out.subarray(nl + 1, nl + 1 + size).toString("utf8"));
    at = nl + 1 + size + 1;
  }
}
const show = (path) => shown.get(path) ?? null;

// Changed files, with A (added), M, D or R (renamed: counts as its new path).
const changes = git("diff", "--name-status", "--find-renames", `${base}...${head}`)
  .trim().split("\n").filter(Boolean)
  .map((line) => { const p = line.split("\t"); return { status: p[0][0], path: p.at(-1), from: p.length > 2 ? p[1] : null }; });
const files = changes.map((c) => c.path).concat(changes.filter((c) => c.from).map((c) => c.from));
const touched = (re) => files.filter((f) => re.test(f));

// ---- Pages: follow each page's <script>/<link> and their imports at <head>.
const PAGES = { "/": "index.html", "/games/shootaround/": "games/shootaround/index.html", "/players/": "players/index.html",
  "/ideas/": "ideas/index.html", "/lab/": "lab/index.html", "404": "404.html" };
const resolveFrom = (dir, ref) => posix.normalize(ref.startsWith("/") ? ref.slice(1) : posix.join(dir, ref));
const reach = (htmlPath) => {
  const html = show(htmlPath) ?? "";
  const dir = /<base href="\/"/.test(html) ? "" : posix.dirname(htmlPath);
  const seen = new Set([htmlPath]);
  const todo = [...html.matchAll(/<(?:script[^>]*\bsrc|link[^>]*\bhref)="([^"]+\.(?:js|css))"/g)].map((m) => resolveFrom(dir, m[1]));
  // Inline module scripts (the lab page) import too.
  for (const m of html.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+\.js)["']/g)) todo.push(resolveFrom(dir, m[1]));
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = file.endsWith(".js") ? show(file) : null;
    if (!src) continue;
    for (const m of src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) todo.push(resolveFrom(posix.dirname(file), m[1]));
  }
  return seen;
};
const pages = {};
for (const [page, html] of Object.entries(PAGES)) {
  const reached = reach(html);
  const hit = files.filter((f) => reached.has(f));
  if (hit.length) pages[page] = hit;
}
// Files fetched by URL, not imported.
const byUrl = (page, re) => { const hit = touched(re); if (hit.length) pages[page] = [...new Set([...(pages[page] ?? []), ...hit])]; };
byUrl("/games/shootaround/", /^(assets\/(characters|voice|sfx|courts?|balls?)\/|assets\/[^/]+\.(png|webp|json)$|games\/shootaround\/)/);
byUrl("/players/", /^assets\/characters\//);
byUrl("/admin", /^(worker\/src\/admin\.(html|ts)|players\/(recolor|shades)\.js|assets\/characters\/)/);

// ---- Modes: a mode's own file, or everything when the shared rules or the round change.
const modeFiles = touched(/^modes\/(?!index\.js)[^/]+\.js$/).map((f) => posix.basename(f, ".js"));
const allModes = touched(/^(shared\/rules\.js|modes\/index\.js|play\/(round|state|zone)\.js)$/);
const modes = allModes.length ? ["all modes (" + allModes.join(", ") + ")"] : modeFiles;

// ---- Players: art folders and video recipes name the player; attributes touch everyone.
const players = new Set();
for (const f of files) {
  let m;
  if (f.startsWith("assets/characters/bases/") && !f.slice(24).includes("/")) players.add("builder bodies list (bases/index.json)");
  else if ((m = f.match(/^assets\/characters\/bases\/([^/]+)\//))) players.add(`${m[1]} (builder body)`);
  else if ((m = f.match(/^assets\/characters\/(gear|heads|rig)\//))) players.add(`builder ${m[1]}`);
  else if ((m = f.match(/^assets\/characters\/([a-z]+)(?:-(?:detail|pixel))?\//))) players.add(m[1]);
  else if ((m = f.match(/^art\/video\/([a-z]+)\.json$/))) players.add(m[1]);
  else if (f === "content/attributes.js") players.add("every player (attributes)");
  else if (f === "assets/characters/index.json") players.add("picker order / sprite stamps (index.json)");
}

// ---- Worker: routes from the router's header comment (each line names its file, or follows the last one).
const routes = {};
let current = null;
for (const line of (show("worker/src/index.ts") ?? "").split("\n")) {
  if (!line.startsWith("//")) { if (Object.keys(routes).length) break; continue; }
  const m = line.match(/^\/\/\s*(?:\w+:)?\s+(GET|POST|PUT|DELETE)\s+(\S+).*?(?:\s(\w+\.ts))?\s*$/);
  if (!m) continue;
  if (m[3]) current = m[3];
  // index.ts hands every admin URL to admin.ts, whatever file a line names for the work behind it.
  const file = /^\/(api\/)?admin\b/.test(m[2]) && !m[3] ? "admin.ts" : current;
  if (file) (routes[file] ??= []).push(`${m[1]} ${m[2].replace(/,$/, "")}`);
}
const workerSrc = touched(/^worker\/src\//);
const workerRoutes = {};
for (const f of workerSrc) {
  const name = posix.basename(f);
  if (routes[name]) workerRoutes[name] = routes[name];
  else if (name === "admin.html") workerRoutes[name] = ["/admin page"];
  else if (name === "index.ts") workerRoutes[name] = ["the router (every route)"];
  else workerRoutes[name] = ["(shared by several routes)"];
}
// The Worker bundles shared/ (rules, save, shop), so a change there needs a deploy too.
const workerDeploy = workerSrc.length > 0 || touched(/^shared\//).length > 0 || touched(/^worker\/(package(-lock)?\.json|tsconfig\.json)$/).length > 0;
const migrations = changes.filter((c) => c.status === "A" && /^worker\/migrations\/.*\.sql$/.test(c.path)).map((c) => c.path);
const migrationsEdited = changes.filter((c) => c.status !== "A" && /^worker\/migrations\//.test(c.path)).map((c) => c.path);

// FEATURE_FROM: did a changed line in scores.ts fall inside its block?
let featureFrom = false;
if (files.includes("worker/src/scores.ts")) {
  const lines = (show("worker/src/scores.ts") ?? "").split("\n");
  const start = lines.findIndex((l) => /const FEATURE_FROM\b/.test(l)) + 1;
  const end = start ? start + lines.slice(start - 1).findIndex((l) => /^};?\s*$/.test(l)) : 0;
  const hunks = git("diff", "-U0", `${base}...${head}`, "--", "worker/src/scores.ts").matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm);
  for (const h of hunks) {
    const from = +h[1], to = from + Math.max(+(h[2] ?? 1), 1) - 1;
    if (start && from <= end && to >= start) featureFrom = true;
  }
}

// ---- What else.
const site = files.filter((f) => !/^(worker\/|tools\/|art\/|docs\/|notes\/|ios\/|\.claude\/|\.github\/|README\.md$|CLAUDE\.md$|capacitor\.config\.json$)/.test(f));
const facts = {
  base, head, files: changes.length,
  pages, modes, players: [...players],
  worker: { changed: workerSrc, routes: workerRoutes, deploy: workerDeploy, tests: touched(/^worker\/test\//) },
  migrations, migrationsEdited, featureFrom,
  rules: files.includes("shared/rules.js"),
  savedProgress: touched(/^(shared\/(save|shop)\.js|progress\.js|worker\/src\/progress\.ts)$/),
  app: touched(/^(ios\/|capacitor\.config\.json$|tools\/app\/|haptics\.js$|api\.js$)/),
  site: site.length > 0,
  assetsByName: touched(/^assets\/(?!characters\/.*sprites\.(webp|json)$)/).filter((f) => !/index\.json$/.test(f)),
  workflow: touched(/^\.github\//),
  docsOnly: files.every((f) => /^(docs\/|notes\/|README\.md$|CLAUDE\.md$|\.claude\/)/.test(f)),
};

// ---- Door.
const oneWay = [], check = [];
if (migrations.length) oneWay.push(`new D1 migration${migrations.length > 1 ? "s" : ""}: ${migrations.map((m) => posix.basename(m)).join(", ")}`);
if (migrationsEdited.length) oneWay.push(`an existing migration was edited (${migrationsEdited.join(", ")}): live already ran the old one`);
if (featureFrom) oneWay.push("FEATURE_FROM changed: a card stat starts counting from a date");
if (facts.savedProgress.length) check.push(`saved progress or coins code changed (${facts.savedProgress.join(", ")}): does it change what's stored?`);
if (facts.rules) check.push("shared/rules.js changed: scores, fire levels or coins may now count differently");
if (workerSrc.some((f) => !/admin\.(ts|html)$|stats\.ts$/.test(f))) check.push("public Worker code changed: do responses still suit the iOS app already installed?");
if (facts.app.some((f) => f.startsWith("ios/") || f === "capacitor.config.json")) check.push("iOS app files changed: one-way only once a build goes to the App Store");
facts.door = oneWay.length ? "one-way" : check.length ? "check" : "two-way";
facts.doorWhy = [...oneWay, ...check];

// ---- Going live, in order.
const steps = [];
if (migrations.length) steps.push("apply the migration to the live database (go-live skill, step 1)");
if (workerDeploy) steps.push("deploy the Worker (`cf deploy` from worker/, committed tree only)");
if (facts.site || facts.workflow.length) steps.push("push main and wait for the Pages build (`sh tools/dev/wait_pages.sh <sha>`)");
if (facts.assetsByName.length) steps.push("purge the cache for assets that keep their names if they look stale");
if (facts.app.some((f) => f.startsWith("ios/") || f === "capacitor.config.json")) steps.push("iOS: `npm run build:app`, `npx cap sync ios`, build in Xcode (separate from the site)");
if (!steps.length) steps.push(facts.docsOnly ? "nothing to deploy (docs or skills only); merging is enough" : "nothing to deploy (tools or source art only); merging is enough");
facts.goingLive = steps;

if (json) { console.log(JSON.stringify(facts, null, 2)); process.exit(0); }

const list = (xs) => (xs.length ? xs.join(", ") : "none");
const out = [];
out.push(`Blast radius: ${base}...${head} (${changes.length} files)`);
out.push(`Door: ${facts.door}`);
for (const why of facts.doorWhy) out.push(`  - ${why}`);
out.push(`Pages: ${list(Object.keys(pages))}`);
for (const [p, fs] of Object.entries(pages)) out.push(`  ${p}: ${fs.slice(0, 3).join(", ")}${fs.length > 3 ? ` and ${fs.length - 3} more` : ""}`);
out.push(`Modes: ${list(modes)}`);
out.push(`Players: ${list(facts.players)}`);
out.push(`Worker: ${workerSrc.length ? "changed" : "unchanged"}; deploy needed: ${workerDeploy ? "yes" : "no"}${facts.worker.tests.length ? `; tests: ${facts.worker.tests.join(", ")}` : ""}`);
for (const [f, rs] of Object.entries(workerRoutes)) out.push(`  ${f}: ${rs.join("; ")}`);
out.push(`Migrations: ${list(migrations)}`);
out.push(`shared/rules.js: ${facts.rules ? "changed" : "unchanged"}; FEATURE_FROM: ${featureFrom ? "changed" : "unchanged"}`);
if (facts.workflow.length) out.push(`GitHub workflow: ${facts.workflow.join(", ")}`);
out.push("Going live:");
steps.forEach((s, i) => out.push(`  ${i + 1}. ${s}`));
console.log(out.join("\n"));
