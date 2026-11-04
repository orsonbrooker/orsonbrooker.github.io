// The bar across the top of every page. Add to a new page with:
//
//   <nav class="site-nav" data-site-nav></nav>              (first thing in <body>)
//   <script type="module" src="/ui/nav.js"></script>
//
// Pages that go with the game also get a "Back to the game" link at the top of their content:
//   <a class="back-link" data-back-link href="/games/shootaround/"></a>

import { fillIcons, icon } from "../ui/icons.js?v=c284e3ca";

const LINKS = [
  { href: "/games/shootaround/", label: "Play", icon: "play" },
  { href: "/players/", label: "Players", icon: "players" },
  { href: "/ideas/", label: "Ideas", icon: "ideas" },
];

const here = location.pathname.replace(/index\.html$/, "");

for (const nav of document.querySelectorAll("[data-site-nav]")) {
  nav.setAttribute("aria-label", "Site");
  nav.innerHTML = `
    <a class="site-nav-home" href="/">${icon("home")}<span>Orson Brooker</span></a>
    <ul>
      ${LINKS.map(
        (l) =>
          `<li><a href="${l.href}"${here === l.href ? ' aria-current="page"' : ""}>${icon(l.icon)}<span>${l.label}</span></a></li>`,
      ).join("")}
    </ul>`;
}

for (const link of document.querySelectorAll("[data-back-link]")) {
  link.innerHTML = `${icon("back")}<span>Back to the game</span>`;
}

fillIcons();
