// Makes dist-app/ (the iOS app's files, which Capacitor copies into ios/) from the built site in dist/:
// the same pages, opening straight into the game, without what only the website needs.
// Run `npm run build:app` (builds the site first), then `npx cap sync ios`.
import { cpSync, rmSync, writeFileSync } from "node:fs";

rmSync("dist-app", { recursive: true, force: true });
cpSync("dist", "dist-app", { recursive: true });
// The app is just the game: the website's other pages (and links to them) stay out.
for (const f of ["CNAME", "404.html", "lab", "players", "ideas", "sitemap.xml", "robots.txt"]) rmSync(`dist-app/${f}`, { recursive: true, force: true });
// The app opens on the game. The menu's Home link comes back here too.
writeFileSync(
  "dist-app/index.html",
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta http-equiv="refresh" content="0; url=/games/shootaround/index.html"><title>Shootaround</title><body style="background:#a6798e">\n',
);
console.log("dist-app ready");
