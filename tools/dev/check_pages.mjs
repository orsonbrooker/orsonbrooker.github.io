// Opens each page of the site in a headless Chrome and lists script errors, console errors and failed
// loads, so a build can be checked before going live. Start Chrome as described in tools/dev/play.mjs, then:
//   node tools/dev/check_pages.mjs 9333 http://localhost:5175
// Prints one line per page ("ok", or what went wrong) and exits 1 if any page had a problem.
const [port, base] = process.argv.slice(2);
const PAGES = ["/", "/games/shootaround/", "/players/", "/ideas/", "/lab/", "/404.html"];
let failed = false;
for (const path of PAGES) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const problems = [];
  const urls = new Map();
  let id = 0;
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") problems.push("error: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0]);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Network.requestWillBeSent") urls.set(m.params.requestId, m.params.request.url);
    if (m.method === "Network.loadingFailed" && !m.params.canceled) problems.push(`failed: ${urls.get(m.params.requestId)} (${m.params.errorText})`);
    if (m.method === "Network.responseReceived" && m.params.response.status >= 400 && !m.params.response.url.endsWith("/404.html")) problems.push(`${m.params.response.status}: ${m.params.response.url}`);
  });
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  send("Runtime.enable");
  send("Network.enable");
  send("Page.enable");
  send("Page.navigate", { url: base + path });
  await new Promise((r) => setTimeout(r, 4000));
  ws.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
  // The local Worker may not be running; failed /api calls are reported but don't fail the check.
  const real = problems.filter((p) => !p.includes("/api/"));
  if (real.length) failed = true;
  console.log(`${path.padEnd(22)} ${problems.length ? problems.join(" | ") : "ok"}`);
}
process.exit(failed ? 1 : 0);
