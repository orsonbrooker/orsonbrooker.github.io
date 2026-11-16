// The agent's eyes: checks the site in a headless Chrome and saves pictures and numbers as evidence.
//
//   node tools/dev/verify.mjs pages                 every page at phone, iPad and desktop size
//   node tools/dev/verify.mjs play [modes]          plays games (default timed,survival,around,threes)
//   node tools/dev/verify.mjs perf                  frame times (play + builder preview, 4x slower CPU), sizes
//   node tools/dev/verify.mjs art <player|body>     contact sheets and checks of a player's art
//   node tools/dev/verify.mjs serve                 builds and serves dist/ to phones; prints the links
//   node tools/dev/verify.mjs keys [screens]        every control on the site's screens and the game's sheets, by keyboard alone
//
// Options: --out DIR (default .verify/<branch>/), --port N (attach to a headless Chrome already running on
// that debug port; otherwise it starts its own), --url BASE (use a server already running instead of
// building and serving dist/), --no-build (serve dist/ as it is), --keep (perf: don't fail, just measure),
// --update-budget (perf: write today's numbers plus headroom to perf-budget.json).
// Each run writes PNGs to <out>/<subcommand>/, merges its checks into <out>/summary.json
// ({ ok, checks: [{ name, ok, detail, images }] }) and rebuilds <out>/index.html. Exits 1 if a check failed.
// `play` needs the local Worker on port 8787 (see CLAUDE.md). The exit code isn't the verdict: look at the
// pictures. See .claude/skills/verify/SKILL.md.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, openSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, freePort, launchChrome, openTab, wait } from "./cdp.mjs";
import { PAGES, pageProblems, realProblems } from "./check_pages.mjs";
import { HELPERS, playGame } from "./play.mjs";
import { checkPrints, printReport } from "./check_prints.mjs";
import { checkGame, checkScreen, checkTouch, key } from "./keyboard.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--out", "--port", "--url", "--base", "--serve-port", "--size"].includes(args[i - 1])));
const [command, ...rest] = positional;
// each art target keeps its own checks in the summary
const group = command === "art" && rest[0] ? `art ${rest[0]}` : command;

const git = (...a) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return ""; } };
const branch = git("rev-parse", "--abbrev-ref", "HEAD") || "detached";
const OUT = resolve(option("--out") ?? join(ROOT, ".verify", branch));

export const SIZES = {
  phone: { width: 390, height: 844, scale: 2, mobile: true },
  ipad: { width: 820, height: 1180, scale: 1, mobile: true },
  desktop: { width: 1280, height: 800, scale: 1, mobile: false },
};
const MIN_TAP = 44;

// ---------- serving the site ----------

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".woff": "font/woff", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
const PRIVATE = new Set(["worker", "notes", "tools", "art", "node_modules", "ios"]);

/** Serves a folder on 127.0.0.1 (this Mac only), never hidden files or the private folders. */
export async function serveDir(dir) {
  const port = await freePort();
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const parts = path.split("/").filter(Boolean);
    if (parts.some((p) => p.startsWith(".")) || PRIVATE.has(parts[0])) { res.writeHead(403); return res.end(); }
    let file = join(dir, ...parts);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    let status = 200;
    if (!existsSync(file)) { status = 404; file = join(dir, "404.html"); if (!existsSync(file)) { res.writeHead(404); return res.end(); } }
    res.writeHead(status, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { base: `http://localhost:${port}`, stop: () => server.close() };
}

function build() {
  console.log("building dist/ ...");
  const r = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error("npm run build failed"); }
}

/** The built site: --url, or dist/ (built first unless --no-build). */
async function site() {
  if (option("--url")) return { base: option("--url").replace(/\/$/, ""), stop() {} };
  if (!flag("--no-build") || !existsSync(join(ROOT, "dist/index.html"))) build();
  return serveDir(join(ROOT, "dist"));
}

/** Vite's dev server on a free port (for tools that import the game's source modules). */
async function devServer() {
  const port = await freePort();
  const proc = spawn(join(ROOT, "node_modules/.bin/vite"), ["--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  const stop = () => { try { proc.kill(); } catch {} };
  process.once("exit", stop);
  for (let i = 0; i < 100 && !listening(port); i++) await wait(150);
  return { base: `http://localhost:${port}`, stop };
}

const listening = (port) => spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim() !== "";

// ---------- evidence folder ----------

const checks = [];
const record = (name, ok, detail = "", images = []) => {
  checks.push({ name: `${group}: ${name}`, ok, detail, images: images.map((p) => relative(OUT, p)) });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail.split("\n")[0]}` : ""}`);
};
const dirFor = (sub) => { const d = join(OUT, sub); mkdirSync(d, { recursive: true }); return d; };

function writeSummary(extra = {}) {
  const file = join(OUT, "summary.json");
  let old = { checks: [], runs: {} };
  try { old = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const kept = (old.checks ?? []).filter((c) => !c.name.startsWith(`${group}: `));
  const all = [...kept, ...checks];
  const summary = {
    ok: all.every((c) => c.ok), branch, commit: git("rev-parse", "--short", "HEAD"), dirty: git("status", "--porcelain") !== "",
    updated: new Date().toISOString(),
    runs: { ...(old.runs ?? {}), [group]: { at: new Date().toISOString(), ok: checks.every((c) => c.ok), args: rest, ...extra } },
    checks: all,
  };
  writeFileSync(file, JSON.stringify(summary, null, 2));
  writeFileSync(join(OUT, "index.html"), indexPage(summary));
  return summary;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function indexPage(s) {
  const groups = {};
  for (const c of s.checks) (groups[c.name.split(":")[0]] ??= []).push(c);
  const section = ([g, list]) => `<h2>${esc(g)} <small>${esc(s.runs?.[g]?.at?.slice(0, 16).replace("T", " ") ?? "")}</small></h2>
<div class="grid">${[...list].sort((a, b) => a.ok - b.ok).map((c) => `<div class="check ${c.ok ? "ok" : "bad"}${c.images.length > 2 ? " wide" : ""}"><b>${c.ok ? "ok" : "FAIL"}</b> ${esc(c.name.slice(g.length + 2))}
${c.detail ? `<pre>${esc(c.detail)}</pre>` : ""}<div class="imgs">${c.images.map((i) => `<a href="${esc(i)}"><img src="${esc(i)}" loading="lazy" alt="${esc(i)}"><span>${esc(i)}</span></a>`).join("")}</div></div>`).join("\n")}</div>`;
  const failed = s.checks.filter((c) => !c.ok);
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>verify ${esc(s.branch)}</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#f6f4f1;color:#222}h1{font-size:18px}h2{margin-top:28px;border-bottom:1px solid #ccc}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:8px}.check{background:#fff;border-left:6px solid #3a3;padding:6px 10px;min-width:0}.bad{border-color:#d33}
.check.wide{grid-column:1/-1}ul{margin:4px 0 0}pre{white-space:pre-wrap;margin:4px 0;font-size:12px}
.imgs{display:flex;flex-wrap:wrap;gap:8px}.imgs a{display:flex;flex-direction:column;max-width:260px;font-size:11px;color:#555;text-decoration:none}
.imgs img{max-width:260px;max-height:360px;object-fit:contain;background:#ddd;border:1px solid #bbb}small{color:#777;font-weight:normal}</style>
<h1>${s.ok ? "All checks pass" : "Some checks failed"}: ${esc(s.branch)} at ${esc(s.commit)}${s.dirty ? " (with uncommitted changes)" : ""}</h1>
<p>Updated ${esc(s.updated.slice(0, 16).replace("T", " "))}. Passing checks aren't the verdict: look at every picture.</p>
${failed.length ? `<p><b>Failed:</b></p><ul>${failed.map((c) => `<li>${esc(c.name)}: ${esc((c.detail || "").split("\n").slice(0, 2).join(" "))}</li>`).join("")}</ul>` : ""}
${Object.entries(groups).map(section).join("\n")}`;
}

// ---------- pages ----------

// In the page: controls under 44 CSS px either way (links inside running text don't count), and anything
// sticking out sideways.
const LAYOUT_CHECK = `
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=radio],[role=checkbox],[role=link]';
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "")
    + ((el.getAttribute("aria-label") || el.textContent || "").trim() ? ' "' + (el.getAttribute("aria-label") || el.textContent).trim().replace(/\\s+/g, " ").slice(0, 24) + '"' : "");
  const small = [], seen = new Set();
  for (const el of document.querySelectorAll(SEL)) {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || el.closest("[inert]")) continue;
    let r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.right <= 0 || r.left >= innerWidth) continue;
    const label = el.closest("label") || (el.type === "range" && el.closest(".pixel-slider"));
    if (label) { const l = label.getBoundingClientRect(); r = { width: Math.max(r.width, l.width), height: Math.max(r.height, l.height) }; }
    if (el.tagName === "A" && getComputedStyle(el).display === "inline" && (el.parentElement?.textContent || "").trim().length > (el.textContent || "").trim().length + 10) continue;
    if (r.width >= ${MIN_TAP} && r.height >= ${MIN_TAP}) continue;
    const n = name(el) + " " + Math.round(r.width) + "x" + Math.round(r.height);
    if (!seen.has(n)) { seen.add(n); small.push(n); }
  }
  const sw = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
  const wide = sw > innerWidth + 1 ? [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && el.checkVisibility(); })
    .slice(0, 4).map((el) => name(el) + " to " + Math.round(el.getBoundingClientRect().right) + "px") : [];
  return { small, sideways: sw > innerWidth + 1, scrollWidth: sw, innerWidth, wide };`;

// The game's screens before playing, reached the way a kid does.
const GAME_VIEWS = [
  ["title", null],
  ["choose-game", `document.getElementById("stage").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));`],
  ["choose-player", `document.querySelector('[data-mode="timed"]').click();`],
];

async function pages() {
  const srv = await site();
  const chrome = await launchChrome({ port: option("--port") });
  const out = dirFor("pages");
  try {
    for (const [size, vp] of Object.entries(SIZES)) {
      for (const path of PAGES) {
        const tab = await openTab(chrome.port);
        await tab.viewport(vp.width, vp.height, vp);
        await tab.send("Page.navigate", { url: srv.base + path });
        await wait(4000);
        const views = path === "/games/shootaround/" ? GAME_VIEWS : [["page", null]];
        for (const [view, step] of views) {
          if (step) { await tab.run(step); await wait(1200); }
          const label = `${path === "/" ? "/home" : path.replace(/\/$/, "")}${view === "page" ? "" : " " + view} @ ${size}`;
          const file = join(out, `${size}-${(path.replace(/[/.]+/g, "-").replace(/^-|-$/g, "") || "home")}${view === "page" ? "" : "-" + view}.png`);
          await tab.screenshot(file);
          const lay = await tab.run(LAYOUT_CHECK);
          const errs = realProblems(pageProblems(tab));
          const notes = [];
          if (errs.length) notes.push("errors:\n  " + errs.map(describe).join("\n  "));
          if (lay.sideways) notes.push(`sideways scroll: page is ${lay.scrollWidth}px wide in a ${lay.innerWidth}px screen; sticking out: ${lay.wide.join(", ")}`);
          // the lab is a hidden page for trying effects, not for kids
          const tapFails = size !== "desktop" && path !== "/lab/" && lay.small.length;
          if (lay.small.length) notes.push(`${tapFails ? "" : "(not failed here) "}tap targets under ${MIN_TAP}px:\n  ${lay.small.join("\n  ")}`);
          const api = pageProblems(tab).filter((p) => !realProblems([p]).length);
          if (api.length) notes.push(`(not failed) /api calls failed: ${api.length}, is the local Worker running?`);
          record(label, !errs.length && !lay.sideways && !tapFails, notes.join("\n"), [file]);
        }
        await tab.close();
      }
    }
  } finally { chrome.stop(); srv.stop(); }
}

// ---------- play ----------

// The instant replay after a game, at each size: it plays (phase "replay"), drawn like the game itself (the
// street and the gym's folded walls round the court, play/fold.js keepOpen, not the court on its own), with its
// sign (who's shooting, how to skip) and nothing left of the old TV bars; then it goes back to game over.
const REPLAY_CHECK = `
  const street = document.querySelector("canvas.box-layer");
  const sx = street.width >> 1;
  const drawn = street.getContext("2d").getImageData(sx, 2, 1, 1).data[3] > 0; // the street's sky, top middle
  const tag = document.querySelector(".replay-tag");
  return JSON.stringify({ phase: window.game.state.phase, street: drawn, tag: !!tag && getComputedStyle(tag).display !== "none" && tag.textContent.trim().length > 0, banner: window.game.state.banner?.text ?? null });`;
async function checkReplay(tab, mode, out) {
  if (await tab.run(`return document.getElementById("replay").hidden`)) return record(`${mode} replay`, true, "(no basket this game, so no replay)");
  for (const [size, vp] of Object.entries({ ...SIZES, "ipad sideways": { width: 1180, height: 820, scale: 1, mobile: true } })) {
    await tab.viewport(vp.width, vp.height, vp);
    await wait(600);
    await tab.run(`document.getElementById("replay").click(); return 1;`);
    await wait(1800);
    const file = join(out, `${mode}-replay-${size}.png`);
    await tab.screenshot(file);
    const got = JSON.parse(await tab.run(REPLAY_CHECK));
    for (let i = 0; i < 30 && (await tab.run(`return window.game.state.phase`)) === "replay"; i++) await wait(500);
    const back = await tab.run(`return window.game.state.phase`);
    const notes = [];
    if (got.phase !== "replay") notes.push(`Replay didn't play (phase "${got.phase}")`);
    if (!got.street) notes.push("no street round the court: the replay is drawing the court on its own");
    if (!got.tag) notes.push("no replay sign (who's shooting, how to skip)");
    if (got.banner !== "REPLAY") notes.push(`the LED doesn't say REPLAY (${got.banner})`);
    if (back !== "over") notes.push(`after the replay: phase "${back}", not game over`);
    record(`${mode} replay @ ${size}`, !notes.length, notes.join("\n"), [file]);
  }
}

async function play() {
  const modes = (rest[0] ?? "timed,survival,around,threes").split(",");
  if (!listening(8787)) console.log("warning: nothing is listening on 8787, so scores can't be sent (start the local Worker, see CLAUDE.md)");
  const srv = await site();
  const chrome = await launchChrome({ port: option("--port") });
  const out = dirFor("play");
  const vp = SIZES.phone;
  try {
    const tab = await openTab(chrome.port, `${srv.base}/games/shootaround/?debug`);
    await tab.viewport(vp.width, vp.height, vp);
    await wait(3000);
    for (const mode of modes) {
      const before = tab.problems.length;
      const mid = join(out, `${mode}-mid.png`), over = join(out, `${mode}-over.png`);
      let shotMid = false;
      const text = await playGame(tab, mode, {
        log: () => {},
        onTick: async (s) => { if (!shotMid && s >= 12) { shotMid = true; await tab.screenshot(mid); } },
      });
      if (!shotMid) await tab.screenshot(mid);
      await tab.screenshot(over);
      const phase = await tab.run(`return window.game.state.phase`);
      const errs = realProblems(tab.problems.slice(before)).filter((p) => !/localhost:8787/.test(p.text));
      const [forged, real] = text.split("\n");
      const forgedTurnedDown = / -> 4\d\d /.test(forged);
      const accepted = / -> 2\d\d /.test(real);
      const notes = [real.trim(), forged.trim()];
      if (!forgedTurnedDown) notes.push("the made-up copy was NOT turned down");
      if (!accepted) notes.push("the real game was NOT accepted");
      if (phase !== "over") notes.push(`ended in phase "${phase}", not "over"`);
      if (errs.length) notes.push("errors:\n  " + errs.map(describe).join("\n  "));
      record(mode, phase === "over" && forgedTurnedDown && accepted && !errs.length, notes.join("\n"), [mid, over]);
      const lay = await tab.run(LAYOUT_CHECK);
      record(`${mode} game over screen @ phone`, !lay.small.length && !lay.sideways,
        [lay.small.length && `tap targets under ${MIN_TAP}px:\n  ${lay.small.join("\n  ")}`, lay.sideways && `sideways scroll: ${lay.wide.join(", ")}`].filter(Boolean).join("\n"), [over]);
      await checkReplay(tab, mode, out);
      await tab.viewport(vp.width, vp.height, vp);
    }
    await tab.close();
  } finally { chrome.stop(); srv.stop(); }
}

// ---------- perf ----------

// Times every requestAnimationFrame callback: the work in each frame (all callbacks sharing a timestamp)
// and the gaps between frames. Installed before the page's own scripts.
const FRAME_TIMER = `
  window.__frames = { work: [], gaps: [], on: false };
  const raf = window.requestAnimationFrame.bind(window);
  let lastTs = 0, cur = 0;
  window.requestAnimationFrame = (cb) => raf((ts) => {
    const t0 = performance.now();
    try { cb(ts); } finally {
      const f = window.__frames;
      if (f.on) {
        if (ts !== lastTs) { if (lastTs) { f.work.push(cur); f.gaps.push(ts - lastTs); } cur = 0; lastTs = ts; }
        cur += performance.now() - t0;
      }
    }
  });`;
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
  const r = (x) => Math.round(x * 10) / 10;
  return { frames: s.length, p50: r(q(0.5)), p95: r(q(0.95)), worst: r(s.at(-1) ?? 0) };
};
async function measureFrames(tab, seconds) {
  await tab.run(`window.__frames.work = []; window.__frames.gaps = []; window.__frames.on = true;`);
  await wait(seconds * 1000);
  const f = await tab.run(`window.__frames.on = false; return window.__frames;`);
  return { work: stats(f.work), longGaps: f.gaps.filter((g) => g > 50).length, worstGap: Math.round(Math.max(0, ...f.gaps)) };
}

/** Gzipped JS and CSS each page loads first (its scripts, stylesheets and their static imports). */
function bundleSizes() {
  const dist = join(ROOT, "dist");
  const gz = (f) => gzipSync(readFileSync(f)).length;
  const sizes = {};
  for (const path of PAGES) {
    const html = readFileSync(join(dist, path.endsWith("/") ? path + "index.html" : path), "utf8");
    const files = new Set();
    const add = (url) => {
      const f = join(dist, url.replace(/^\//, "").split("?")[0]);
      if (files.has(f) || !existsSync(f)) return;
      files.add(f);
      if (f.endsWith(".js")) for (const m of readFileSync(f, "utf8").matchAll(/(?:import|from)\s*["'](\.\/[^"']+)["']/g)) add(relative(dist, join(dirname(f), m[1])));
    };
    for (const m of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(\/build\/[^"]+)"/g)) add(m[1]);
    const list = [...files];
    sizes[path] = { js: Math.round(list.filter((f) => f.endsWith(".js")).reduce((a, f) => a + gz(f), 0) / 1024 * 10) / 10,
      css: Math.round(list.filter((f) => f.endsWith(".css")).reduce((a, f) => a + gz(f), 0) / 1024 * 10) / 10 };
  }
  return sizes; // KB, gzipped
}

/** Bytes a phone downloads in the first 6 seconds of each page, all and images only (KB). */
async function firstLoad(port, base) {
  const out = {};
  for (const path of PAGES) {
    const tab = await openTab(port);
    await tab.viewport(SIZES.phone.width, SIZES.phone.height, SIZES.phone);
    const types = new Map();
    let all = 0, images = 0;
    tab.on((m) => {
      if (m.method === "Network.responseReceived") types.set(m.params.requestId, m.params.type);
      if (m.method === "Network.loadingFinished") { all += m.params.encodedDataLength; if (types.get(m.params.requestId) === "Image") images += m.params.encodedDataLength; }
    });
    await tab.send("Network.setCacheDisabled", { cacheDisabled: true });
    await tab.send("Page.navigate", { url: base + path });
    await wait(6000);
    await tab.close();
    out[path] = { all: Math.round(all / 1024), images: Math.round(images / 1024) };
  }
  return out;
}

// Every long task's length (ms), from the first moment of a page: window.__long.
const LONG_TASKS = `window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch {}`;

async function perf() {
  const srv = await site();
  const chrome = await launchChrome({ port: option("--port") });
  const out = dirFor("perf");
  const vp = { width: 390, height: 844, scale: 3, mobile: true };
  const today = { play: null, builder: null, builderChange: null, builderStep: null, builderSwitch: null, builderColour: null, doneToPlayable: null, size: null, firstLoad: null };
  try {
    // 20 s of Time attack as Orson, phone, 4x slower CPU
    const tab = await openTab(chrome.port);
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: FRAME_TIMER });
    await tab.viewport(vp.width, vp.height, vp);
    await tab.goto(`${srv.base}/games/shootaround/?debug`, 4000);
    await tab.run(HELPERS);
    await tab.run(`window.__play("timed", 5); return 1;`);
    await wait(3000);
    await tab.throttle(4);
    today.play = await measureFrames(tab, 20);
    await tab.throttle(1);
    await tab.screenshot(join(out, "play.png"));
    await tab.close();

    // the builder: Curly (a kid from video, the heaviest body), one colour change, then the preview (on the
    // Body tab: on a phone the Character tab covers it) and one step of the height slider
    const b = await openTab(chrome.port);
    await b.send("Page.addScriptToEvaluateOnNewDocument", { source: FRAME_TIMER });
    await b.viewport(vp.width, vp.height, vp);
    await b.goto(`${srv.base}/players/`, 4000);
    await b.run(`document.querySelector('.character-card[aria-label="Curly"]')?.click(); return 1;`);
    await wait(8000);
    await b.throttle(4);
    const freeze = async (step) => {
      await b.run(`window.__frames.work = []; window.__frames.gaps = []; window.__frames.on = true; ${step} return 1;`);
      await wait(8000);
      const f = await b.run(`window.__frames.on = false; return window.__frames;`);
      return Math.round(Math.max(0, ...f.gaps, ...f.work));
    };
    today.builderChange = await freeze(`const s = [...document.querySelectorAll("#look-swatches .swatch")].find((x) => x.getAttribute("aria-pressed") !== "true"); s?.click();`);
    await b.run(`document.getElementById("tab-body").click(); return 1;`);
    await wait(2000);
    today.builder = await measureFrames(b, 10);
    today.builderStep = await freeze(`const h = document.getElementById("height"); h.value = String(Number(h.value) + 1); h.dispatchEvent(new Event("input", { bubbles: true })); h.dispatchEvent(new Event("change", { bubbles: true }));`);
    await b.throttle(1);
    await b.screenshot(join(out, "builder.png"));
    await b.close();

    // Switching bodies, a colour change, and Done to playable (phone, 4x slower CPU): how long until it's
    // shown (the builder's "builder-painted" mark, the game's "player-ready"), and the longest the page froze
    // (its longest task) on the way: for Done, on the builder until it leaves and then on the game.
    const k = await openTab(chrome.port);
    await k.send("Page.bringToFront");
    await k.send("Page.addScriptToEvaluateOnNewDocument", { source: LONG_TASKS });
    await k.viewport(vp.width, vp.height, vp);
    await k.goto(`${srv.base}/players/`, 9000);
    await k.throttle(4);
    const timed = async (step, mark, ms = 9000) => {
      const t0 = await k.run(`window.__long.length = 0; performance.clearMarks(${JSON.stringify(mark)}); ${step} return performance.now();`);
      await wait(ms);
      const r = await k.run(`const m = performance.getEntriesByName(${JSON.stringify(mark)})[0]; return { at: m ? Math.round(m.startTime) : null, longest: Math.max(0, ...window.__long) };`);
      return { time: r.at === null ? null : r.at - Math.round(t0), longest: r.longest };
    };
    const worst = (list) => ({ time: Math.max(...list.map((r) => r.time ?? 99999)), longest: Math.max(...list.map((r) => r.longest)) });
    const switches = [];
    for (const body of ["Curly", "Buzz", "Buns", "Spiky"]) switches.push(await timed(`document.querySelector('.character-card[aria-label="${body}"]')?.click();`, "builder-painted"));
    today.builderSwitch = worst(switches);
    const colours = [];
    for (let i = 0; i < 3; i++) colours.push(await timed(`[...document.querySelectorAll("#look-swatches .swatch")].find((x) => x.getAttribute("aria-pressed") !== "true")?.click();`, "builder-painted", 4000));
    today.builderColour = worst(colours);
    // Done with Curly (a team picked, a name typed): to the game, until their player is in
    await k.run(`document.querySelector('.character-card[aria-label="Curly"]')?.click(); return 1;`);
    await wait(9000);
    await k.run(`document.getElementById("tab-team").click(); return 1;`);
    await wait(1500);
    await k.run(`document.querySelector(".team-pick")?.click(); document.getElementById("done-open").click(); return 1;`);
    await wait(1500);
    await k.run(`const n = document.getElementById("name"); n.value = "Testy"; n.dispatchEvent(new Event("input", { bubbles: true })); return 1;`);
    await wait(2000);
    const t0 = Date.now();
    await k.run(`window.__long.length = 0; document.getElementById("play").click(); return 1;`);
    // (the builder's long tasks are read while it's still open: the game page starts a list of its own)
    let ready = null, builderLong = 0;
    for (let i = 0; i < 120 && ready === null; i++) {
      await wait(250);
      const r = await k.run(`return { game: location.pathname.startsWith("/games"), ready: performance.getEntriesByName("player-ready").length > 0, longest: Math.max(0, ...window.__long) }`).catch(() => null);
      if (r && !r.game) builderLong = Math.max(builderLong, r.longest);
      if (r?.game && r.ready) ready = 1;
    }
    const doneLong = Math.max(builderLong, await k.run(`return Math.max(0, ...window.__long)`).catch(() => 0));
    today.doneToPlayable = { time: ready ? Date.now() - t0 : null, longest: doneLong };
    await k.throttle(1);
    await k.close();

    today.size = bundleSizes();
    today.firstLoad = await firstLoad(chrome.port, srv.base);
  } finally { chrome.stop(); srv.stop(); }

  writeFileSync(join(out, "perf.json"), JSON.stringify(today, null, 2));
  const budgetFile = join(ROOT, "perf-budget.json");
  if (flag("--update-budget") || !existsSync(budgetFile)) {
    writeFileSync(budgetFile, JSON.stringify(seedBudget(today), null, 2) + "\n");
    console.log("wrote perf-budget.json from today's numbers plus headroom");
  }
  const budget = JSON.parse(readFileSync(budgetFile, "utf8"));
  const over = (got, max) => max !== undefined && got > max;
  for (const where of ["play", "builder"]) {
    const got = today[where], max = budget.frames[where];
    const bad = ["p50", "p95", "worst"].filter((k) => over(got.work[k], max[k]));
    if (over(got.longGaps, max.longGaps)) bad.push("longGaps");
    record(`frames in ${where}`, !bad.length || flag("--keep"),
      `work per frame (ms, 4x slower CPU): p50 ${got.work.p50}, p95 ${got.work.p95}, worst ${got.work.worst} over ${got.work.frames} frames; ` +
      `${got.longGaps} gaps over 50 ms, longest ${got.worstGap} ms. Budget: p50 ${max.p50}, p95 ${max.p95}, worst ${max.worst}, gaps ${max.longGaps}` +
      (bad.length ? `\nover budget: ${bad.join(", ")}` : ""), [join(out, `${where}.png`)]);
  }
  for (const [name, what] of [["builderSwitch", "switching bodies (Curly, Buzz, Buns, Spiky)"], ["builderColour", "a colour change"], ["doneToPlayable", "Done to playable, with Curly"]]) {
    const got = today[name], max = budget[name] ?? {};
    const bad = [over(got.time ?? Infinity, max.time) && "time", over(got.longest, max.longest) && "longest freeze"].filter(Boolean);
    record(`${what}`, !bad.length || flag("--keep"),
      `(4x slower CPU) ${got.time === null ? "never shown" : `shown after ${got.time} ms`} (budget ${max.time}); longest freeze ${got.longest} ms (budget ${max.longest})` + (bad.length ? `\nover budget: ${bad.join(", ")}` : ""));
  }
  record("builder changes", (!over(today.builderChange, budget.builderChange) && !over(today.builderStep, budget.builderStep)) || flag("--keep"),
    `longest freeze (4x slower CPU) after one colour change: ${today.builderChange} ms (budget ${budget.builderChange}); after one height step: ${today.builderStep} ms (budget ${budget.builderStep})`);
  for (const path of PAGES) {
    const s = today.size[path], max = budget.size[path] ?? {}, l = today.firstLoad[path], lmax = budget.firstLoad[path] ?? {};
    const bad = [over(s.js, max.js) && "js", over(s.css, max.css) && "css", over(l.all, lmax.all) && "first load", over(l.images, lmax.images) && "images"].filter(Boolean);
    record(`size ${path}`, !bad.length || flag("--keep"),
      `gzipped JS ${s.js} KB (budget ${max.js}), CSS ${s.css} KB (budget ${max.css}); first 6 s on a phone ${l.all} KB, images ${l.images} KB (budget ${lmax.all}, ${lmax.images})` +
      (bad.length ? `\nover budget: ${bad.join(", ")}` : ""));
  }
  return { numbers: "perf/perf.json" };
}

/** Today's numbers with headroom: frame times are noisy (+40-100%), sizes aren't (+10%). */
function seedBudget(t) {
  // with a floor, so a number that's near 0 today doesn't fail on noise
  const up = (x, k, floor = 0) => Math.ceil(Math.max(x * k, x + floor) * 10) / 10;
  // frame times move by about a third between runs on a busy Mac, and the worst frame is one freeze
  const frames = (f) => ({ p50: up(f.work.p50, 1.5, 1.5), p95: up(f.work.p95, 1.4, 3), worst: up(f.work.worst, 2, 50), longGaps: Math.ceil(f.longGaps * 2) + 3 });
  return {
    note: "Limits for `node tools/dev/verify.mjs perf`: frame work in ms at 4x slower CPU on a 390x844 phone screen, sizes in KB gzipped, first-load KB in the first 6 s. Seeded from the numbers on " + new Date().toISOString().slice(0, 10) + " plus headroom; lower them as things get faster, never raise them without saying why.",
    frames: { play: frames(t.play), builder: frames(t.builder) },
    builderChange: Math.ceil(t.builderChange * 1.5),
    builderStep: Math.ceil(t.builderStep * 1.5),
    // time to shown, and the longest freeze: nothing over about 100 ms
    builderSwitch: { time: Math.ceil(t.builderSwitch.time * 1.5), longest: 120 },
    builderColour: { time: Math.ceil(t.builderColour.time * 1.5), longest: 120 },
    doneToPlayable: { time: Math.ceil(t.doneToPlayable.time * 1.5), longest: 250 },
    size: Object.fromEntries(Object.entries(t.size).map(([p, s]) => [p, { js: up(s.js, 1.1, 1), css: up(s.css, 1.1, 1) }])),
    firstLoad: Object.fromEntries(Object.entries(t.firstLoad).map(([p, s]) => [p, { all: Math.ceil(Math.max(s.all * 1.1, s.all + 20)), images: Math.ceil(Math.max(s.images * 1.1, s.images + 20)) }])),
  };
}

// ---------- art ----------

function python() {
  if (spawnSync("uv", ["--version"]).status === 0) return ["uv", ["run", "--quiet", "--with", "pillow", "--with", "numpy", "--with", "scipy", "python3"]];
  return [join(process.env.HOME, ".venvs/announcer/bin/python"), []];
}

async function art() {
  const who = rest[0];
  if (!who) throw new Error("say which player or body: node tools/dev/verify.mjs art <orson|curly|buns|spiky|...>");
  const out = dirFor(`art-${who}`);
  const base = option("--base") ?? (git("rev-parse", "--verify", "-q", "origin/main") ? "origin/main" : "main");
  const [py, pre] = python();
  const r = spawnSync(py, [...pre, join(ROOT, "tools/pixelart/check_art.py"), who, out, "--base", base], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  process.stdout.write(r.stderr ?? "");
  if (r.status !== 0) throw new Error("check_art.py failed:\n" + r.stdout + r.stderr);
  const res = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  for (const c of res.checks) record(c.name, c.ok, c.detail, c.images.map((i) => join(out, i)));

  if (who === "orson") {
    // the number and team name stay on his jersey (imports the game's own modules, so Vite's dev server)
    const srv = await devServer();
    const chrome = await launchChrome({ port: option("--port") });
    try {
      const tab = await openTab(chrome.port);
      const res = await checkPrints(tab, `${srv.base}/games/shootaround/?debug&pixel`);
      await tab.close();
      const file = join(out, "prints-off-jersey.png");
      writeFileSync(file, Buffer.from(res.png.split(",")[1], "base64"));
      const lines = [];
      printReport(res, (...a) => lines.push(a.join(" ")));
      record("number and team name on the jersey", !res.bad.length, lines.at(-1), res.bad.length ? [file] : []);
    } finally { chrome.stop(); srv.stop(); }
  }
}

// ---------- serve ----------

async function serve() {
  build();
  let port = Number(option("--serve-port") ?? 5174);
  while (listening(port)) port++;
  const log = join(dirFor("serve"), "lan_server.log");
  const proc = spawn("python3", [join(ROOT, "tools/dev/lan_server.py"), String(port), join(ROOT, "dist")], { cwd: ROOT, detached: true, stdio: ["ignore", openSync(log, "a"), openSync(log, "a")] });
  proc.unref();
  await wait(800);
  const sh = (cmd, a) => { const x = spawnSync(cmd, a, { encoding: "utf8" }); return x.status === 0 ? x.stdout.trim() : ""; };
  const lan = sh("ipconfig", ["getifaddr", "en0"]);
  const tail = sh("sh", ["-c", "command -v tailscale >/dev/null && tailscale ip -4 | head -1"]);
  const game = "/games/shootaround/";
  const links = [`http://localhost:${port}${game}`, lan && `http://${lan}:${port}${game}`, tail && `http://${tail}:${port}${game}`].filter(Boolean);
  const up = listening(port);
  record("lan server", up, [
    `serving dist/ on port ${port} (pid ${proc.pid}; stop it with: kill ${proc.pid})`,
    `this Mac:  ${links[0]}`, lan ? `same Wi-Fi: http://${lan}:${port}${game}` : "no Wi-Fi address (en0)",
    tail ? `Tailscale: http://${tail}:${port}${game}` : "Tailscale isn't installed or isn't up",
    listening(8787) ? "the local Worker is up on 8787, so scores and players work" : "the local Worker isn't running on 8787: the game works, but scores and players won't send",
    "The builder is at /players/ and the ideas board at /ideas/ on the same address.",
  ].join("\n"));
  for (const l of links) console.log(l);
  return { port, pid: proc.pid, links };
}

// ---------- keys ----------

// The ideas board needs the Worker; these stand in for it, so the board has cards and votes.
const FAKE_IDEAS = `(() => {
  const real = window.fetch;
  const ok = (body) => Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
  window.fetch = (u, o) => {
    const url = String(u);
    if (url.endsWith("/api/config")) return ok({ apps: [{ slug: "new-game", name: "New games" }, { slug: "basketball", name: "Shootaround" }, { slug: "website", name: "The website" }] });
    if (url.endsWith("/api/ideas")) return ok({ ideas: [
      { id: 1, app: "basketball", status: "idea", title: "Moni as a player", votes: 9 },
      { id: 2, app: "new-game", status: "idea", title: "A city to explore", votes: 2, credit: "Zoom" },
      { id: 3, app: "basketball", status: "planned", title: "New courts", votes: 5 },
      { id: 4, app: "basketball", status: "done", title: "Fire at 3 in a row", votes: 12 },
    ], voted: [2] });
    return real(u, o);
  };
})();`;
const click = (sel) => `document.querySelector(${JSON.stringify(sel)})?.click();`;

// Each screen: its page and how to get to it (what a kid would tap first; the check itself is all keys).
const KEY_SCREENS = {
  home: { path: "/" },
  lost: { path: "/404.html" },
  ideas: { path: "/ideas/" },
  "builder-character": { path: "/players/" },
  // a new character, so the sliders can move
  "builder-body": { path: "/players/", steps: [click(".character-card:nth-child(2)"), click("#tab-body")] },
  "builder-team": { path: "/players/", steps: [click("#tab-team")] },
  "builder-team-editor": { path: "/players/", steps: [click("#tab-team"), click(".make-team")] },
  "builder-gear": { path: "/players/", steps: [click("#tab-gear")] },
  // Done, with a team picked so it opens its sheet
  "builder-done": { path: "/players/", steps: [click("#tab-team"), click(".team-pick"), click("#tab-character")] },
  "choose-player": { path: "/games/shootaround/", keys: [" ", "Enter"] },
  "horse-turn": {
    path: "/games/shootaround/",
    keys: [" "],
    steps: [click('[data-mode="horse"]'), click("#char-pick .card:nth-child(1)"), click("#char-pick .card:nth-child(2)"), click("#team-go")],
  },
};

async function keys() {
  const srv = await site();
  const chrome = await launchChrome({ port: option("--port") });
  const out = dirFor("keys");
  const vp = SIZES[option("--size") ?? "desktop"];
  const only = rest[0]?.split(",");
  try {
    for (const [name, screen] of Object.entries(KEY_SCREENS)) {
      if (only && !only.includes(name)) continue;
      const tab = await openTab(chrome.port);
      await tab.viewport(vp.width, vp.height, vp);
      await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_IDEAS });
      const open = async () => {
        await tab.goto(srv.base + screen.path, 3500);
        for (const k of screen.keys ?? []) { await key(tab, k); await wait(900); }
        for (const step of screen.steps ?? []) { await tab.run(step); await wait(900); }
      };
      const file = join(out, `${name}.png`);
      const res = await checkScreen(tab, open);
      await open();
      await tab.screenshot(file);
      const errs = realProblems(pageProblems(tab));
      if (errs.length) res.problems.push("errors:\n  " + errs.map(describe).join("\n  "));
      const notes = [...res.problems, res.dialogs.length ? `dialogs opened and checked from: ${res.dialogs.join(", ")}` : ""].filter(Boolean);
      record(`${name}: ${res.reached} of ${res.total} reached`, res.ok && !errs.length, notes.join("\n"), [file]);
      await tab.close();
    }
    // the game's own sheets, walked through in order
    if (!only || only.includes("game")) {
      const tab = await openTab(chrome.port);
      // as a first visit: the screens above chose a player, which would skip Choose your player
      await tab.goto(`${srv.base}/404.html`, 1000);
      await tab.run(`localStorage.clear(); sessionStorage.clear();`);
      await checkGame(tab, srv.base, record, out);
      await tab.close();
    }
    // touch: opening the same menus with taps, nothing looks chosen
    if (!only || only.includes("touch")) {
      const tab = await openTab(chrome.port);
      await checkTouch(tab, srv.base, record, out);
      await tab.close();
    }
  } finally { chrome.stop(); srv.stop(); }
}

// ---------- main ----------

const COMMANDS = { pages, play, perf, art, serve, keys };
if (!COMMANDS[command]) {
  console.log(readFileSync(import.meta.filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(command ? 1 : 0);
}
mkdirSync(OUT, { recursive: true });
let extra = {};
try {
  extra = (await COMMANDS[command]()) ?? {};
} catch (e) {
  record("run", false, String(e.stack ?? e));
}
const summary = writeSummary(extra);
const mine = checks.every((c) => c.ok);
console.log(`\n${mine ? "pass" : "FAIL"}: ${checks.filter((c) => !c.ok).length} of ${checks.length} checks failed. Evidence: ${join(OUT, "index.html")}`);
console.log("Look at the pictures before saying it's done.");
process.exit(mine ? 0 : 1);
