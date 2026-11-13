// A spot-check of the Worker tests: changes each number in shared/rules.js, one at a time, and runs the
// tests. A change that no test notices is a rule the tests don't really pin down. Run it now and then
// (say monthly, or after changing the rules or their tests); it isn't part of `npm run check`.
//
//   node tools/dev/mutate_rules.mjs            whole numbers +1, decimals x2
//   node tools/dev/mutate_rules.mjs --both     also whole numbers -1 and decimals /2
//
// It works on copies in a temp folder and never changes the real files. Node built-ins only.

import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const both = process.argv.includes("--both");
const source = readFileSync(join(ROOT, "shared/rules.js"), "utf8");

// The numbers in the code, skipping comments and strings.
function numbers(src) {
  const found = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") i = src.indexOf("\n", i) < 0 ? src.length : src.indexOf("\n", i);
    else if (c === "/" && next === "*") i = src.indexOf("*/", i + 2) + 2;
    else if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
    } else if (/[0-9]/.test(c) && !/[\w$.]/.test(src[i - 1] ?? "")) {
      const m = /^\d+(\.\d+)?(e-?\d+)?/.exec(src.slice(i));
      found.push({ at: i, text: m[0] });
      i += m[0].length;
    } else i++;
  }
  return found;
}

function mutants(n) {
  const v = Number(n.text);
  const int = Number.isInteger(v) && !n.text.includes(".");
  const out = int ? [v + 1] : [v * 2];
  if (both) out.push(int ? v - 1 : v / 2);
  return out.filter((m) => m >= 0).map((m) => String(Math.round(m * 1e9) / 1e9));
}

const lineOf = (at) => source.slice(0, at).split("\n").length;
const lineText = (at) => source.split("\n")[lineOf(at) - 1].trim();

// One copy of shared/ and worker/ per parallel runner.
const tests = readdirSync(join(ROOT, "worker/test")).filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`);
function makeCopy() {
  const dir = mkdtempSync(join(tmpdir(), "mutate-rules-"));
  cpSync(join(ROOT, "shared"), join(dir, "shared"), { recursive: true });
  // Files outside worker/ and shared/ that the tests import.
  for (const file of ["phrases.js"]) cpSync(join(ROOT, file), join(dir, file));
  cpSync(join(ROOT, "worker"), join(dir, "worker"), {
    recursive: true,
    filter: (src) => !/[\\/]worker[\\/](node_modules|\.cloudflare|\.dev\.vars|\.secrets\.json)/.test(src),
  });
  symlinkSync(join(ROOT, "worker/node_modules"), join(dir, "worker/node_modules"));
  return dir;
}

function runTests(dir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", ...tests], { cwd: join(dir, "worker"), stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve(signal ? "timeout" : code);
    });
  });
}

// Make sure the tests pass as they are first.
const jobs = numbers(source).flatMap((n) => mutants(n).map((to) => ({ ...n, to })));
const workers = Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2)));
const copies = Array.from({ length: workers }, makeCopy);
try {
  if ((await runTests(copies[0])) !== 0) {
    console.error("The Worker tests fail without any change. Fix them first (npm --prefix worker test).");
    process.exit(1);
  }
  console.log(`${jobs.length} changes to shared/rules.js, ${workers} at a time...`);
  const missed = [];
  let done = 0;
  await Promise.all(
    copies.map(async (dir) => {
      while (jobs.length) {
        const job = jobs.shift();
        const changed = source.slice(0, job.at) + job.to + source.slice(job.at + job.text.length);
        writeFileSync(join(dir, "shared/rules.js"), changed);
        const result = await runTests(dir);
        done++;
        if (result === 0) missed.push(job);
      }
    }),
  );
  missed.sort((a, b) => a.at - b.at);
  console.log(`\n${done - missed.length} of ${done} changes were caught by a test.`);
  if (missed.length) {
    console.log(`\nNot caught (no test failed):`);
    for (const m of missed) console.log(`  shared/rules.js:${lineOf(m.at)}  ${m.text} -> ${m.to}   ${lineText(m.at).slice(0, 90)}`);
  }
} finally {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
}
