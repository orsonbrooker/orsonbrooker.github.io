// Checks a pixel-art sheet's printed number and team name in every frame of every move: how much of
// it lands off his jersey (anywhere but a real piece of jersey colour, 15 pixels or more), and saves a
// picture of any frame where it does. Run it after rebuilding a sheet made from video.
//   node tools/dev/check_prints.mjs <chrome debug port, or "new"> <game url with ?pixel> <out.png>
// e.g. node tools/dev/check_prints.mjs new "http://localhost:5191/games/shootaround/?debug&pixel" /tmp/bad.png
// Uses your own headless Chrome (tools/dev/cdp.mjs; "new" starts one), and the dev server (it imports
// the game's modules). `node tools/dev/verify.mjs art orson` runs it too.
import { writeFileSync } from "node:fs";
import { launchChrome, openTab } from "./cdp.mjs";

export const PRINTS_CHECK = `
  const players = await import("/play/players.js");
  await players.loadRoster();
  await players.useCharacter("orson");
  const { sheet } = players, meta = sheet.sprites;
  // the original sheet (before recolouring), to know which pixels are jersey
  const orig = await players.loadImage("assets/characters/orson-pixel/sprites.png");
  const oc = Object.assign(document.createElement("canvas"), { width: orig.width, height: orig.height });
  const og = oc.getContext("2d"); og.drawImage(orig, 0, 0);
  const od = og.getImageData(0, 0, oc.width, oc.height).data;
  const jerseyRGB = new Set(meta.palette.jersey.map((s) => meta.rgb[s].join(",")));
  const isJ = (x, y) => od[(y * oc.width + x) * 4 + 3] > 0 && jerseyRGB.has([0, 1, 2].map((c) => od[(y * oc.width + x) * 4 + c]).join(","));
  const report = [];
  const bad = [];
  for (const [anim, frames] of Object.entries(meta.frames)) {
    frames.forEach(([sx, sy, w, h], i) => {
      const layer = sheet.prints?.get(sx + "," + sy);
      if (!layer) return;
      // the pieces of jersey in this frame, and their sizes
      const lab = new Int32Array(w * h).fill(-1);
      const sizes = []; let k = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (lab[y * w + x] >= 0 || !isJ(sx + x, sy + y)) continue;
        const stack = [[x, y]]; lab[y * w + x] = k; let n = 0;
        while (stack.length) {
          const [cx, cy] = stack.pop(); n++;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || lab[ny * w + nx] >= 0 || !isJ(sx + nx, sy + ny)) continue;
            lab[ny * w + nx] = k; stack.push([nx, ny]);
          }
        }
        sizes[k] = n;
        k++;
      }
      const F = layer.width / w;
      const ld = layer.getContext("2d").getImageData(0, 0, layer.width, layer.height).data;
      let ink = 0, off = 0;
      for (let qy = 0; qy < layer.height; qy++) for (let qx = 0; qx < layer.width; qx++) {
        if (ld[(qy * layer.width + qx) * 4 + 3] < 128) continue;
        ink++;
        const at = lab[Math.floor(qy / F) * w + Math.floor(qx / F)];
        if (at < 0 || sizes[at] < 15) off++;
      }
      const share = ink ? off / ink : 0;
      report.push([anim, i, ink, Math.round(share * 100)]);
      if (share > 0.02) bad.push([anim, i, sx, sy, w, h, Math.round(share * 100)]);
    });
  }
  // picture of the bad frames, 4x, with the print
  const K = 4, CW = 60, CH = 110;
  const c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.min(bad.length, 12)) * CW * K, height: Math.ceil(Math.max(1, bad.length) / 12) * CH * K });
  const g = c.getContext("2d"); g.imageSmoothingEnabled = false; g.fillStyle = "#6a8"; g.fillRect(0, 0, c.width, c.height);
  bad.forEach(([anim, i, sx, sy, w, h], n) => {
    const bx = (n % 12) * CW * K + 4, by = Math.floor(n / 12) * CH * K + 4;
    g.drawImage(sheet.atlas, sx, sy, w, h, bx, by, w * K, h * K);
    const p = sheet.prints.get(sx + "," + sy);
    g.drawImage(p, 0, 0, p.width, p.height, bx, by, w * K, h * K);
    g.fillStyle = "#000"; g.font = "20px monospace"; g.fillText(anim + " " + i, bx, by + h * K + 22);
  });
  return { report, bad: bad.map(([a, i, , , , , s]) => a + "#" + i + " " + s + "%"), png: c.toDataURL("image/png") };`;

/** Runs the check in an open tab of the game (with ?pixel); returns { report, bad, png }. */
export async function checkPrints(tab, url) {
  await tab.goto(url, 3500);
  return tab.run(PRINTS_CHECK);
}

/** Prints the per-move report, like the tool always has. */
export function printReport(res, log = console.log) {
  const byAnim = {};
  for (const [a, , , s] of res.report) (byAnim[a] ??= []).push(s);
  for (const [a, list] of Object.entries(byAnim)) log(a.padEnd(16), list.join(" "));
  log("frames off the jersey (>2% of ink):", res.bad.length ? res.bad.join(", ") : "none");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [port, url, out] = process.argv.slice(2);
  const chrome = await launchChrome({ port: port === "new" ? undefined : port });
  const tab = await openTab(chrome.port, "about:blank", { network: false });
  tab.on((m) => { if (m.method === "Runtime.exceptionThrown") console.log("PAGE ERROR:", m.params.exceptionDetails.exception?.description?.split("\n")[0]); });
  const res = await checkPrints(tab, url);
  writeFileSync(out, Buffer.from(res.png.split(",")[1], "base64"));
  printReport(res);
  // close the tab, or the game keeps running in it and uses the CPU
  await tab.close();
  chrome.stop();
  process.exit(0);
}
