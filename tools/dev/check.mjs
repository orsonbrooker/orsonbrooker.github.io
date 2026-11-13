// Checks everything a machine can before a change goes to review: the build, the Worker tests, the
// Worker's types, and the house rules from CLAUDE.md as plain text checks. Each failure says how to fix it.
//
//   npm run check              everything
//   npm run check -- --quick   skips the build (CI builds in its own step)
//
// Prints one line per check and exits 1 if any failed. Node built-ins only.

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const quick = process.argv.includes("--quick");
const results = [];

// ---- helpers ----

function report(name, status, lines = []) {
  results.push(status);
  const tag = { ok: "ok  ", fail: "FAIL", skip: "skip", warn: "warn" }[status];
  console.log(`${tag}  ${name}`);
  for (const line of lines) console.log(`      ${line}`);
}

function run(name, cmd, args, cwd = ROOT) {
  const started = Date.now();
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 0) return report(`${name} (${secs}s)`, "ok");
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}${res.error ? String(res.error) : ""}`.trim().split("\n");
  report(`${name} (${secs}s)`, "fail", [`\`${cmd} ${args.join(" ")}\` failed. Last lines:`, ...out.slice(-30)]);
}

const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const read = (file) => readFileSync(join(ROOT, file), "utf8");

// The site's own code: what visitors' browsers run. Not the Worker (its admin page is Luke's), not the
// tools, not vendored code.
const SITE_SKIP = /^(worker|tools|vendor|ios|art|\.github|\.claude|node_modules|dist)\//;
const siteFiles = tracked.filter((f) => /\.(js|mjs|html)$/.test(f) && !SITE_SKIP.test(f) && existsSync(join(ROOT, f)));

// Finds lines matching `pattern` in `files`, ignoring anything after a `//` comment start.
function grep(files, pattern) {
  const hits = [];
  for (const file of files) {
    read(file).split("\n").forEach((line, i) => {
      const m = pattern.exec(line);
      if (!m) return;
      const comment = line.indexOf("//");
      if (comment >= 0 && comment < m.index && !/:\/\/$/.test(line.slice(0, comment + 2))) return;
      hits.push({ file, line: i + 1, text: line.trim() });
    });
  }
  return hits;
}
const where = (hits) => hits.map((h) => `${h.file}:${h.line}  ${h.text.slice(0, 120)}`);

// ---- build, tests, types ----

if (quick) report("build", "skip", ["--quick: not built"]);
else run("build", "npm", ["run", "build"]);

run("worker tests", "npm", ["--prefix", "worker", "test"]);

if (!existsSync(join(ROOT, "worker/.cloudflare/types"))) {
  report("worker types (tsc)", "skip", [
    "worker/.cloudflare/types is missing, so the types weren't checked.",
    "From a worktree: cp -R ../../../worker/.cloudflare/types worker/.cloudflare/",
  ]);
} else if (!existsSync(join(ROOT, "worker/node_modules/.bin/tsc"))) {
  report("worker types (tsc)", "skip", ["worker/node_modules is missing: run npm --prefix worker ci"]);
} else {
  run("worker types (tsc)", join(ROOT, "worker/node_modules/.bin/tsc"), ["--noEmit", "-p", "."], join(ROOT, "worker"));
}

// ---- house rules ----

// No emoji: the site uses pixel icons.
{
  const hits = grep(siteFiles, /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u);
  if (!hits.length) report("no emoji in site code", "ok");
  else report("no emoji in site code", "fail", ["Use a pixel icon instead: icon(\"name\") from ui/icons.js.", ...where(hits)]);
}

// No browser dialogs: the site has its own styled ones.
{
  const hits = grep(siteFiles, /(?<![\w$]|[\w$]\.)(?:window\.)?(alert|confirm|prompt)\s*\(/);
  if (!hits.length) report("no alert/confirm/prompt", "ok");
  else report("no alert/confirm/prompt", "fail", ["Use confirmDialog() from ui/confirm.js instead of the browser's boxes.", ...where(hits)]);
}

// innerHTML only with constant strings or icon(). Lines already reviewed are listed in
// tools/dev/innerhtml-allow.txt; a new one passes on its own only when it's plainly constant.
{
  const ALLOW = "tools/dev/innerhtml-allow.txt";
  const allowed = new Map();
  for (const raw of read(ALLOW).split("\n")) {
    const tab = raw.indexOf("\t");
    if (raw.startsWith("#") || tab < 0) continue;
    const key = raw.slice(0, tab) + "\t" + raw.slice(tab + 1).trim();
    allowed.set(key, (allowed.get(key) ?? 0) + 1);
  }
  const constant = /innerHTML\s*[:=]\s*(icon\(\s*"[\w-]+"\s*\)|"[^"]*"|'[^']*')\s*[,;)}]*\s*$/;
  const files = [...siteFiles, ...tracked.filter((f) => f === "worker/src/admin.html")];
  const bad = [];
  for (const hit of grep(files, /\binnerHTML\b/)) {
    if (constant.test(hit.text)) continue;
    const key = `${hit.file}\t${hit.text}`;
    if (allowed.get(key) > 0) allowed.set(key, allowed.get(key) - 1);
    else bad.push(hit);
  }
  const stale = [...allowed].filter(([, n]) => n > 0).map(([k]) => k.replace("\t", "  "));
  if (bad.length)
    report("innerHTML only with constant text or icon()", "fail", [
      "User text only via textContent. innerHTML is for constant strings and icon(...) only.",
      `If this line really is constant, add "<file><TAB><the line, trimmed>" to ${ALLOW}.`,
      ...where(bad),
    ]);
  else report("innerHTML only with constant text or icon()", "ok");
  if (stale.length) report("innerHTML allowlist is current", "warn", [`No longer in the code; remove from ${ALLOW}:`, ...stale]);
}

// Every stat on a leaderboard card only counts games after it went live: anything new that cardStats()
// returns must be switched on with hadFeature(), whose names come from FEATURE_FROM.
{
  const name = "card stats are in FEATURE_FROM";
  const src = read("worker/src/scores.ts");
  // On the card before FEATURE_FROM existed (racks are switched on in the function body, by
  // threePointContest). Never add to this list: gate a new stat with hadFeature() instead.
  const FROM_LAUNCH = ["bestStreak", "onFire", "racks", "bonusPoints", "hottestFire", "missTiming", "tries", "green"];
  const featureBlock = /const FEATURE_FROM = \{([\s\S]*?)\n\};/.exec(src);
  const fnStart = src.indexOf("export function cardStats(");
  const ret = fnStart >= 0 ? src.indexOf("\treturn {", fnStart) : -1;
  const retEnd = ret >= 0 ? src.indexOf("\n\t};", ret) : -1;
  if (!featureBlock || retEnd < 0) {
    report(name, "fail", ["Couldn't find FEATURE_FROM or cardStats()'s return { ... } in worker/src/scores.ts.", "Update this check in tools/dev/check.mjs to match the new code."]);
  } else {
    const features = [...featureBlock[1].matchAll(/^\t(\w+):/gm)].map((m) => m[1]);
    const problems = [];
    for (const m of src.matchAll(/hadFeature\([^,]+,\s*"(\w+)"\)/g))
      if (!features.includes(m[1])) problems.push(`hadFeature(…, "${m[1]}"): "${m[1]}" isn't in FEATURE_FROM. Add it with the time it went live.`);
    // Top-level properties of the returned object, with their text.
    const body = src.slice(ret, retEnd).split("\n").slice(1);
    const props = [];
    for (const line of body) {
      const m = /^\t\t(\w+)\s*(?=[:,]|$)/.exec(line);
      if (m) props.push({ key: m[1], text: line });
      else if (props.length && /^\t\t\t/.test(line)) props.at(-1).text += line;
    }
    for (const p of props)
      if (!FROM_LAUNCH.includes(p.key) && !/hadFeature\(/.test(p.text))
        problems.push(`New card stat "${p.key}": add a FEATURE_FROM entry in worker/src/scores.ts and return it only when hadFeature(createdAt, "<feature>"), so it counts only games played after it went live.`);
    if (problems.length) report(name, "fail", problems);
    else report(name, "ok");
  }
}

// Every announcer line has a recorded clip (voice.json is keyed by the exact text).
{
  const name = "every announcer line has a clip";
  try {
    const { PHRASES, SHE } = await import(pathToFileURL(join(ROOT, "phrases.js")).href);
    const voice = JSON.parse(read("assets/voice/voice.json"));
    const lines = [...new Set([...Object.values(PHRASES).flat(), ...Object.values(SHE)])];
    const missing = lines.filter((p) => !voice.clips?.[p]);
    const problems = [];
    if (!existsSync(join(ROOT, "assets/voice", voice.file ?? ""))) problems.push(`assets/voice/voice.json points at ${voice.file}, which isn't there.`);
    if (missing.length)
      problems.push(
        `${missing.length} line(s) in phrases.js have no clip. Record them with the announcer-voice skill (tools/build_voice.py), then commit assets/voice:`,
        ...missing.map((p) => `"${p}"`),
      );
    if (problems.length) report(name, "fail", problems);
    else report(`${name} (${lines.length})`, "ok");
  } catch (e) {
    report(name, "warn", [`Couldn't check: ${e.message}`]);
  }
}

// No sheet an iOS device could load is too big for its canvases (16.7 megapixels), with gear on and the
// biggest build (maxPixels from tools/pixelart/sheet_sizes.py), at any size players/recolor.js pickSize
// would give it; and no other player sheet is over the limit as it is.
{
  const LIMIT = 16_777_216;
  const GROWTH = 1.2; // as recolor.js, where maxPixels isn't worked out
  const webpSize = (file) => {
    const b = readFileSync(join(ROOT, file));
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === "VP8L") {
      const v = b.readUInt32LE(21);
      return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)];
    }
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  };
  const pathOf = (url) => url.split("?")[0];
  const { pickSize } = await import(pathToFileURL(join(ROOT, "players/recolor.js")).href);
  const bad = [];
  const covered = new Set(); // sheets the indexes point at: checked by what pickSize gives iOS
  for (const index of ["assets/characters/index.json", "assets/characters/bases/index.json"]) {
    for (const e of JSON.parse(read(index))) {
      if (!e.atlas) continue;
      for (const s of [e, ...Object.values(e.sizes ?? {})]) covered.add(pathOf(s.atlas));
      const loadable = new Set();
      for (const current of [undefined, null, ...Object.keys(e.sizes ?? {})])
        for (let k = 0; k <= 4; k += 0.005) loadable.add(pickSize(e, k, current, true));
      for (const size of loadable) {
        const s = size ? e.sizes[size] : e;
        const [w, h] = webpSize(pathOf(s.atlas));
        const worst = s.maxPixels ?? w * h * GROWTH;
        if (worst > LIMIT || w * h > LIMIT)
          bad.push(`${e.id} ${size ?? "full"} (${pathOf(s.atlas)}): ${((w * h) / 1e6).toFixed(1)} MP, ${(worst / 1e6).toFixed(1)} MP at most`);
      }
    }
  }
  for (const f of tracked.filter((f) => /^assets\/characters\/.*\.webp$/.test(f) && existsSync(join(ROOT, f)) && !covered.has(f))) {
    const [w, h] = webpSize(f);
    if (w * h > LIMIT) bad.push(`${f}: ${((w * h) / 1e6).toFixed(1)} MP`);
  }
  if (!bad.length) report("player sheets fit iOS canvases", "ok");
  else
    report("player sheets fit iOS canvases", "fail", [
      "iOS can't draw a canvas over 16.7 MP. Remake the kid's sizes (python tools/pixelart/sheet_sizes.py <kid>),",
      "which picks a medium size that fits with gear and build, or make the sheet smaller:",
      ...bad,
    ]);
}

// No secrets in the repo (it's public).
{
  const SECRET = /(^|\/)(\.dev\.vars|\.secrets\.json|\.env(\.(?!example$)[\w.-]+)?|id_(rsa|ed25519|ecdsa)|.*\.(pem|p8|p12|key|mobileprovision))$/;
  const hits = tracked.filter((f) => SECRET.test(f));
  if (!hits.length) report("no secrets files in git", "ok");
  else
    report("no secrets files in git", "fail", [
      "Secrets live only in worker/.secrets.json and worker/.dev.vars in the main checkout, never in git.",
      "Unstage with git rm --cached <file>. If it was ever pushed, rotate the secret too.",
      ...hits,
    ]);
}

const failed = results.filter((r) => r === "fail").length;
const warned = results.filter((r) => r === "warn").length;
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll checks passed${warned ? ` (${warned} warning(s))` : ""}.`);
process.exit(failed ? 1 : 0);
