// Shared headless-Chrome glue for the dev tools (play.mjs, check_pages.mjs, check_prints.mjs, verify.mjs),
// over the Chrome DevTools Protocol with Node's built-in WebSocket (Node 22+). No packages.
//
//   import { launchChrome, openTab } from "./cdp.mjs";
//   const chrome = await launchChrome();            // or attach to one already running: { port: 9333 }
//   const tab = await openTab(chrome.port, url);    // url optional (about:blank)
//   await tab.viewport(390, 844, { mobile: true });
//   await tab.run(`return document.title`);         // an async function body, run in the page
//   await tab.screenshot("out.png");
//   tab.problems                                    // script errors, console errors, failed loads, 4xx/5xx
//   await tab.close(); chrome.stop();
//
// Use your own headless Chrome (Puppeteer's chrome-headless-shell in ~/.cache/puppeteer), never the app's
// browser pane (it pauses the game when hidden) or the shared puppeteer MCP browser (other sessions drive it).
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Puppeteer's chrome-headless-shell (newest), or $CHROME. */
export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  if (existsSync(root)) {
    for (const v of readdirSync(root).sort().reverse()) {
      for (const sub of readdirSync(join(root, v))) {
        const bin = join(root, v, sub, "chrome-headless-shell");
        if (existsSync(bin)) return bin;
      }
    }
  }
  throw new Error("No headless Chrome found. Install one with: npx @puppeteer/browsers install chrome-headless-shell@stable (or set CHROME=...)");
}

/** A free TCP port on this Mac. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** Starts headless Chrome on its own profile, or attaches when given { port } of one already running. */
export async function launchChrome({ port } = {}) {
  if (port) return { port: Number(port), stop() {} };
  port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "verify-chrome-"));
  const proc = spawn(findChrome(), [
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required", "--mute-audio", "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await wait(100); }
  }
  const stop = () => { try { proc.kill(); } catch {} };
  process.once("exit", stop);
  return { port, stop };
}

/** Opens a new tab and connects to it. Collects problems from the moment it opens. */
export async function openTab(port, url = "about:blank", { network = true } = {}) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  const urls = new Map();
  const problems = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    const p = m.params;
    if (m.method === "Runtime.exceptionThrown") problems.push({ kind: "error", text: (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).split("\n")[0] });
    if (m.method === "Runtime.consoleAPICalled" && p.type === "error") problems.push({ kind: "console", text: p.args.map((a) => a.value ?? a.description).join(" ") });
    if (m.method === "Network.requestWillBeSent") urls.set(p.requestId, p.request.url);
    if (m.method === "Network.loadingFailed" && !p.canceled) problems.push({ kind: "failed", text: `${urls.get(p.requestId)} (${p.errorText})`, url: urls.get(p.requestId) });
    if (m.method === "Network.responseReceived" && p.response.status >= 400) problems.push({ kind: String(p.response.status), text: p.response.url, url: p.response.url });
    for (const f of listeners) f(m);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  if (network) await send("Network.enable");
  const tab = {
    id: target.id, port, send, problems,
    /** Calls f with every CDP event; returns a function that stops it. */
    on(f) { listeners.add(f); return () => listeners.delete(f); },
    /** Runs an async function body in the page and returns its (JSON) value. */
    async run(body) {
      const res = await send("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "eval failed");
      return res.result.value;
    },
    async goto(u, settleMs = 3000) { await send("Page.navigate", { url: u }); await wait(settleMs); },
    async reload(settleMs = 3000) { await send("Page.reload", { ignoreCache: true }); await wait(settleMs); },
    /** Emulates a screen: CSS width and height, device pixel ratio, and phone touch + user agent. */
    async viewport(width, height, { scale = 1, mobile = false } = {}) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
      await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, ...(mobile ? { maxTouchPoints: 5 } : {}) });
    },
    /** Slows the CPU down by this factor (1 = normal). */
    async throttle(rate) { await send("Emulation.setCPUThrottlingRate", { rate }); },
    /** Saves a PNG of what's on screen (or the whole page with { full: true }). */
    async screenshot(path, { full = false } = {}) {
      const res = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
      writeFileSync(path, Buffer.from(res.data, "base64"));
      return path;
    },
    /** Closes the tab, so a game left in it stops using the CPU. */
    async close() {
      try { ws.close(); } catch {}
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
    },
  };
  return tab;
}

/** One line per problem, for printing. */
export const describe = (p) => (p.kind === "error" ? "error: " : p.kind === "console" ? "console: " : p.kind === "failed" ? "failed: " : p.kind + ": ") + p.text;
