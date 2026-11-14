// Plays Shootaround automatically in a headless Chrome and sends each game's score to the local Worker,
// to check the game end to end. With the site and the local Worker (port 8787) running:
//   node tools/dev/play.mjs 9333 "http://localhost:5175/games/shootaround/?debug" timed,survival,around,threes
// The first argument is the port of a headless Chrome you started (see tools/dev/cdp.mjs), or "new" to start
// one for this run. The modes are the "Choose a game" cards' data-mode; the 3-point contest's only shows in
// ?debug for now. `node tools/dev/verify.mjs play` does the same and also saves screenshots.
// It presses Space like a player, lets go in the middle of the green (every few shots a little late, to
// miss), and prints each game: score, shots, bonus balls, whether it was seeded from its start token, and
// the server's answers: first to a made-up copy of the game (must be turned down), then the real one.
import { launchChrome, openTab, wait } from "./cdp.mjs";

export const HELPERS = `
window.__wait = (ms) => new Promise(r => setTimeout(r, ms));
window.__play = async (mode, missEvery) => {
  document.getElementById("stage").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  await __wait(500);
  document.querySelector('[data-mode="' + mode + '"]').click(); await __wait(300);
  document.querySelector("#char-pick .card")?.click(); // only the first time: after that a game starts as that player await __wait(500);
  document.querySelector(".team-dialog .team-choice")?.click(); await __wait(2000);
  const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { key: " ", code: "Space", bubbles: true }));
  let n = 0, down = 0;
  clearInterval(window.__auto);
  window.__auto = setInterval(() => {
    const g = window.game, s = g.state, p = g.player;
    if (s.phase !== "playing") { if (s.pressed) key("keyup"); clearInterval(window.__auto); return; }
    if (!s.pressed) {
      if (!p.moving && !p.activeBall && s.balls.every((b) => b.decided) && ["idle", "dribble", "ready"].includes(p.anim)) { key("keydown"); down = performance.now(); }
    } else {
      const late = missEvery && n % missEvery === missEvery - 1 ? 0.3 : 0;
      // The middle of the green: the top of the jump, unless the mode moves it.
      const green = g.zoneCenter ? g.zoneCenter() : 0.29;
      if ((p.anim === "jump" && p.t >= green + late) || performance.now() - down > 3000) { if (p.anim === "jump") n++; key("keyup"); }
    }
  }, 8);
};
// A made-up version of this game the server must turn down: a basket added to the score, a basket
// after sudden death's miss, a time before the last spot, or a 3-point contest money ball that isn't
// the last of its rack. Sent first, as a turned-down game doesn't use up the start token.
window.__forge = (body) => {
  const shots = body.shots.map((x) => [...x]);
  if (body.mode === "threes") { shots[0][4] = 1; return { ...body, shots, score: body.score + (shots[0][2] ? 3 : 0) }; }
  if (body.mode === "survival") return { ...body, shots: [...shots, [shots.at(-1)[0] + 2, 0, 1, 0, 0]], score: body.score + 2 };
  if (body.mode === "around") return { ...body, score: Math.round(shots.at(-1)[0] * 10) - 10 };
  return { ...body, score: body.score + 2 };
};
window.__send = async () => {
  const s = window.game.state;
  const score = s.mode === "around" ? Math.round(s.aroundTime * 10) : s.score;
  const body = { token: s.gameToken, mode: s.mode, score, shots: s.shotLog, player: "orson", nickname: "Tester", device: "test-device-shared-rules-01", turnstileToken: "XXXX.DUMMY.TOKEN.XXXX", input: "keyboard" };
  const myTeam = JSON.parse(localStorage.getItem("orson-hoops-my-team") ?? "null"); // as screens/over.js sends it
  if (myTeam) Object.assign(body, { team: myTeam.name, teamId: myTeam.key });
  const forged = await fetch("http://localhost:8787/api/scores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(__forge(body)) });
  const forgedText = "made-up copy -> " + forged.status + " " + (await forged.text()) + "\\n  ";
  const r = await fetch("http://localhost:8787/api/scores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return forgedText + s.mode + ": score " + score + ", " + s.shotLog.length + " shots, " + s.shotLog.filter(x => x[2]).length + " made, " + s.shotLog.filter(x => x[4]).length + " bonus balls, best streak " + s.shotLog.reduce((a, x) => (x[2] ? [a[0] + 1, Math.max(a[1], a[0] + 1)] : [0, a[1]]), [0, 0])[1] + ", seeded from token " + (s.rngSeed === s.gameToken) + " -> " + r.status + " " + (await r.text());
};
return typeof window.game;`;

/** How often each mode misses on purpose (a late release every n shots). */
export const missEvery = (mode) => (mode === "survival" ? 9 : mode === "threes" ? 7 : 5);

/**
 * Plays one game of `mode` in `tab` (on the game page) and sends it. `onTick(seconds)` is called once a
 * second while it plays (for mid-game screenshots); returns the server's answers as text.
 */
export async function playGame(tab, mode, { onTick, log = console.log } = {}) {
  await tab.reload(3000);
  log("game loaded:", await tab.run(HELPERS));
  await tab.run(`window.__play("${mode}", ${missEvery(mode)}); return 1;`);
  for (let i = 0; i < 120; i++) {
    await wait(1000);
    if ((await tab.run(`return window.game.state.phase`)) === "over") break;
    if (onTick) await onTick(i + 1);
  }
  // The server wants the game to have lasted as long as it claims (Time attack: 59 s since the token).
  await wait(1500);
  return tab.run(`return await window.__send()`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [port, url, modes] = process.argv.slice(2);
  const chrome = await launchChrome({ port: port === "new" ? undefined : port });
  const tab = await openTab(chrome.port, url, { network: false });
  tab.on((m) => {
    if (m.method === "Runtime.exceptionThrown") console.log("PAGE ERROR:", m.params.exceptionDetails.exception?.description?.split("\n")[0]);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.log("CONSOLE ERROR:", m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  await wait(3000);
  for (const mode of modes.split(",")) console.log(await playGame(tab, mode));
  await tab.close();
  chrome.stop();
  process.exit(0);
}
