// Opens each page of the site in a headless Chrome and lists script errors, console errors and failed
// loads, so a build can be checked before going live:
//   node tools/dev/check_pages.mjs <chrome debug port, or "new"> http://localhost:5175
// Prints one line per page ("ok", or what went wrong) and exits 1 if any page had a problem.
// `node tools/dev/verify.mjs pages` does this at phone, iPad and desktop sizes, with screenshots.
import { describe, launchChrome, openTab, wait } from "./cdp.mjs";

export const PAGES = ["/", "/games/shootaround/", "/players/", "/ideas/", "/lab/", "/404.html"];

/** The problems worth reporting on a page: a 404 for the 404 page itself is expected. */
export const pageProblems = (tab) => tab.problems.filter((p) => !(p.kind === "404" && p.url?.endsWith("/404.html")));
/** The local Worker may not be running; failed /api calls are reported but don't fail the check. */
export const realProblems = (problems) => problems.filter((p) => !describe(p).includes("/api/"));

if (import.meta.url === `file://${process.argv[1]}`) {
  const [port, base] = process.argv.slice(2);
  const chrome = await launchChrome({ port: port === "new" ? undefined : port });
  let failed = false;
  for (const path of PAGES) {
    const tab = await openTab(chrome.port);
    await tab.send("Page.navigate", { url: base + path });
    await wait(4000);
    await tab.close();
    const problems = pageProblems(tab);
    if (realProblems(problems).length) failed = true;
    console.log(`${path.padEnd(22)} ${problems.length ? problems.map(describe).join(" | ") : "ok"}`);
  }
  chrome.stop();
  process.exit(failed ? 1 : 0);
}
