// Plays Shootaround automatically in a headless Chrome and sends each game's score to the local Worker,
// to check the game end to end. Start Chrome first (in the background), e.g. Puppeteer's copy:
//   ~/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-mac-arm64/chrome-headless-shell \
//     --remote-debugging-port=9333 --user-data-dir=/tmp/shootaround-chrome about:blank
// then, with the site and the local Worker (port 8787) running:
//   node tools/dev/play.mjs 9333 "http://localhost:5175/games/shootaround/?debug" timed,survival,around
// It presses Space like a player, lets go at the top of the jump (every few shots a little late, to
// miss), and prints each game: score, shots, bonus balls, whether it was seeded from its start token, and
// the server's answer. Uses only Node's built-in WebSocket (Node 22+).
const [port, url, modes] = process.argv.slice(2);
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") console.log("PAGE ERROR:", m.params.exceptionDetails.exception?.description?.split("\n")[0]);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.log("CONSOLE ERROR:", m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expr) => {
  const res = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (res.result.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description ?? "eval failed");
  return res.result.result.value;
};
await send("Runtime.enable");
await send("Page.enable");
await new Promise((r) => setTimeout(r, 3000));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const helpers = `
window.__wait = (ms) => new Promise(r => setTimeout(r, ms));
window.__play = async (mode, missEvery) => {
  document.getElementById("stage").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  await __wait(500);
  document.querySelector('[data-mode="' + mode + '"]').click(); await __wait(300);
  document.querySelector("#char-pick .card").click(); await __wait(2500);
  const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { key: " ", code: "Space", bubbles: true }));
  let n = 0, down = 0;
  clearInterval(window.__auto);
  window.__auto = setInterval(() => {
    const g = window.game, s = g.state, p = g.player;
    if (s.phase !== "playing") { if (s.pressed) key("keyup"); clearInterval(window.__auto); return; }
    if (!s.pressed) {
      if (!p.moving && !p.activeBall && s.balls.length === 0 && ["idle", "dribble", "ready"].includes(p.anim)) { key("keydown"); down = performance.now(); }
    } else {
      const late = missEvery && n % missEvery === missEvery - 1 ? 0.3 : 0;
      if ((p.anim === "jump" && p.t >= 0.29 + late) || performance.now() - down > 3000) { if (p.anim === "jump") n++; key("keyup"); }
    }
  }, 8);
};
window.__send = async () => {
  const s = window.game.state;
  const score = s.mode === "around" ? Math.round(s.aroundTime * 10) : s.score;
  const body = { token: s.gameToken, mode: s.mode, score, shots: s.shotLog, player: "orson", nickname: "Tester", device: "test-device-shared-rules-01", turnstileToken: "XXXX.DUMMY.TOKEN.XXXX", input: "keyboard" };
  const r = await fetch("http://localhost:8787/api/scores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return s.mode + ": score " + score + ", " + s.shotLog.length + " shots, " + s.shotLog.filter(x => x[2]).length + " made, " + s.shotLog.filter(x => x[4]).length + " bonus balls, best streak " + s.shotLog.reduce((a, x) => (x[2] ? [a[0] + 1, Math.max(a[1], a[0] + 1)] : [0, a[1]]), [0, 0])[1] + ", seeded from token " + (s.rngSeed === s.gameToken) + " -> " + r.status + " " + (await r.text());
};
return typeof window.game;`;

for (const mode of modes.split(",")) {
  await send("Page.reload", { ignoreCache: true });
  await wait(3000);
  console.log("game loaded:", await run(helpers));
  await run(`window.__play("${mode}", ${mode === "survival" ? 9 : 5}); return 1;`);
  for (let i = 0; i < 120; i++) {
    await wait(1000);
    if ((await run(`return window.game.state.phase`)) === "over") break;
  }
  // The server wants the game to have lasted as long as it claims (Time attack: 59 s since the token).
  await wait(1500);
  console.log(await run(`return await window.__send()`));
}
ws.close();
process.exit(0);
