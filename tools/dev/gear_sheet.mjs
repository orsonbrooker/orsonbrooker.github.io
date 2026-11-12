// A contact sheet for one gear item on the kids made from video, drawn by the game's own code
// (players/gear.js, recolor.js, stretch.js) in a headless Chrome, so what it shows is what the game draws:
// every side in clashing colours, the item in two other colour sets, height and build at both ends, and
// a row at the size a phone shows it.
//   (headless Chrome on a debugging port, as in play.mjs, and the site's Vite dev server running)
//   node tools/dev/gear_sheet.mjs 9346 http://localhost:5186 beanie <out.png> [curly,buns]
const [port, site, item, out, kidList = "curly,buns"] = process.argv.slice(2);
import { writeFileSync } from "node:fs";

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(site + "/404.html")}`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await new Promise((r) => setTimeout(r, 2500));

const page = async (item, kids) => {
  const { GEAR, loadGear, wearGear, gearParam } = await import("/players/gear.js");
  const { loadBases, loadBase, recolor } = await import("/players/recolor.js");
  const { stretchSheet } = await import("/players/stretch.js");
  const { makeBallSprites } = await import("/engine/draw.js");
  await document.fonts.load('16px "Press Start 2P"').catch(() => {});
  const ball = makeBallSprites()[Object.keys(makeBallSprites())[0]][0];
  const bases = await loadBases();
  // clashing: the kid in loud colours that show any hair poking through or a wrong edge
  const CLASH = { skin: "#f6d7c3", hair: "#3d6bd6", jersey: "#e86fb0", team: "#f2cf3d", shoes: "#3fa65c", number: "7", teamName: "KINGS" };
  const SETS = [
    { skin: "#6b4227", hair: "#26222a", jersey: "#d63a3a", team: "#f2f2ef", shoes: "#2c3e7a", number: "23", teamName: "DRAGONS" },
    { skin: "#e0a983", hair: "#e8c872", jersey: "#3fa65c", team: "#2b2b2f", shoes: "#f2cf3d", number: "5", teamName: "ROBOTS" },
  ];
  const SIDES = ["", "-fr", "-r", "-br", "-b", "-bl", "-l", "-fl"];
  const rows = [];
  for (const kid of kids) {
    const base = bases.find((b) => b.id === kid);
    const loaded = await loadBase(base);
    const worn = await loadGear(kid, gearParam(item));
    if (!worn.length) { rows.push({ label: `${kid}: no ${item} made`, cells: [] }); continue; }
    const make = (colours, build = {}) => {
      const s = wearGear({ meta: loaded.meta, img: recolor(loaded, colours), prints: null, regions: loaded.regionsData }, worn, colours);
      return stretchSheet(s, s.regions, build);
    };
    const frame = (sheet, anim, k = 0) => {
      const list = sheet.meta.frames[anim];
      return list && { sheet, f: list[Math.min(list.length - 1, k < 0 ? list.length + k : k)] };
    };
    const a = make(CLASH);
    rows.push({ label: `${kid}, clashing colours: every side, dribbling`, cells: SIDES.map((s) => frame(a, `dribble${s}`, 3)).filter(Boolean) });
    // every frame of one move, so a hat that changes from frame to frame shows
    for (const anim of ["dribble-l", "release-fr"])
      rows.push({ label: `${kid}, every frame of ${anim}`, narrow: true, cells: (a.meta.frames[anim] ?? []).map((_, k) => frame(a, anim, k)).slice(0, 14) });
    rows.push({ label: `${kid}, clashing colours: every side, shooting`, cells: SIDES.map((s) => frame(a, `release${s}`, -1)).filter(Boolean) });
    for (const [i, set] of SETS.entries()) {
      const b = make(set);
      rows.push({ label: `${kid}, colours ${i + 2}`, cells: ["idle", "dribble-fr", "jog-r", "dribble-b", "jump-l", "recover-fl"].map((n) => frame(b, n, 2)).filter(Boolean) });
    }
    const lo = make(SETS[0], { height: -1, bulk: -1 }), hi = make(SETS[0], { height: 1, bulk: 1 });
    rows.push({ label: `${kid}: shortest and slimmest, then tallest and broadest`, cells: [frame(lo, "idle"), frame(lo, "dribble-r", 2), frame(lo, "release-b", -1), frame(hi, "idle"), frame(hi, "dribble-r", 2), frame(hi, "release-b", -1)] });
    rows.push({ label: `${kid} at game size (phone)`, small: true, cells: SIDES.map((s) => frame(a, `dribble${s}`, 3)).filter(Boolean).concat([frame(make(SETS[0]), "idle"), frame(make(SETS[1]), "release-fl", -1)]) });
  }
  const K = 0.9, KS = 0.29, CW = 180, H = 300, HS = 110, PAD = 26;
  const height = rows.reduce((t, r) => t + (r.small ? HS : r.narrow ? 210 : H) + PAD, 40);
  const c = Object.assign(document.createElement("canvas"), { width: CW * 8 + 20, height });
  const g = c.getContext("2d");
  g.fillStyle = "#3a1f2e";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#fff";
  g.font = '14px "Press Start 2P"';
  g.fillText(`${GEAR[item]?.name ?? item}`, 10, 26);
  let y = 40;
  for (const r of rows) {
    g.font = "15px sans-serif";
    g.fillStyle = "#f3e6ec";
    g.fillText(r.label, 10, y + 16);
    const k = r.small ? KS : r.narrow ? 0.62 : K, rh = r.small ? HS : r.narrow ? 210 : H;
    r.cells.forEach((cell, i) => {
      const [x, fy, w, h, ox, oy] = cell.f;
      const step = r.small ? 70 : r.narrow ? 104 : CW;
      const cx = 10 + i * step + step / 2, ground = y + PAD + rh - 8;
      g.fillStyle = "#c98f5f"; // a court-ish floor
      g.fillRect(cx - step / 2 + 5, ground - 4, step - 10, 8);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      const held = cell.sheet.meta.balls?.[`${x},${fy}`];
      if (held) { const d = 2 * held[2] * k * 1.04; g.drawImage(ball, cx + (ox + held[0]) * k - d / 2, ground + (oy + held[1]) * k - d / 2, d, d); }
      g.drawImage(cell.sheet.img, x, fy, w, h, cx + ox * k, ground + oy * k, w * k, h * k);
    });
    y += rh + PAD;
  }
  return c.toDataURL("image/png");
};

const res = await send("Runtime.evaluate", { expression: `(${page})(${JSON.stringify(item)}, ${JSON.stringify(kidList.split(","))})`, awaitPromise: true, returnByValue: true });
if (res.result.exceptionDetails) {
  console.error(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text);
  process.exit(1);
}
writeFileSync(out, Buffer.from(res.result.result.value.split(",")[1], "base64"));
ws.send(JSON.stringify({ id: ++id, method: "Page.close" }));
console.log("wrote", out);
process.exit(0);
