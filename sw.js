// The website's service worker (not the iOS app's, which carries its files inside it), so the game
// loads without the network after the first visit and plays offline.
//   - Code (/build/*, hashed names) and stamped files (a ?v= stamp, or a hash in the name: sprite
//     sheets, gear, region maps, icons, the voice and sound clips): from the cache, else fetched once
//     and kept. A newer stamp of the same file replaces the older one.
//   - Pages and JSON lists without a stamp (assets/characters/index.json...): the network first, so a
//     new deploy shows on the next online visit; the cached copy only when the network can't be reached.
//   - Other files without a stamp (the court, the hoop): kept until the next deploy, then fetched again.
//   - Never /api/* (scores, ideas, players), /admin, or other sites.
// vite.config.js copies this into dist/ with the build's files, its commit and the time it was built
// filled in, so every deploy is a new worker. Pages register it with offline.js, which also asks it
// to keep files for later (keep below).

const VERSION = "__VERSION__";
const BUILT_AT = +"__BUILT_AT__";
const BUILD = new Set(JSON.parse('__BUILD__')); // every /build/ file of this deploy
const PAGES = ["/", "/games/shootaround/", "/players/", "/ideas/", "/404.html"];

const CODE = "code"; // /build/*
const STAMPED = "stamped"; // ?v= or hash-named files
const SITE = `site-${VERSION}`; // pages and unstamped files, per deploy
const AT = "x-cached-at"; // when a code file was cached (see activate)

const HASHED = /-[0-9a-f]{8}\.\w+$/; // announcer-bdc5b6f5.m4a
const isCode = (url) => url.pathname.startsWith("/build/");
const isStamped = (url) => url.searchParams.has("v") || HASHED.test(url.pathname);
const isData = (url) => /\.(json|webmanifest)$/.test(url.pathname);
const ours = (url) => url.origin === location.origin && !/^\/(api|admin)(\/|$)/.test(url.pathname);

// The cache a file belongs in, or null to leave it to the network.
function cacheFor(url) {
  if (!ours(url)) return null;
  if (isCode(url)) return CODE;
  if (isStamped(url)) return STAMPED;
  return SITE;
}

// Keeps a good response (a copy). A stamped file replaces its older stamps.
async function keep(name, request, response) {
  if (!response.ok || response.type !== "basic") return;
  const cache = await caches.open(name);
  const url = new URL(request.url);
  if (name === STAMPED) {
    const family = (u) => (HASHED.test(u.pathname) ? u.pathname.replace(HASHED, "") : u.pathname);
    for (const old of await cache.keys()) {
      const o = new URL(old.url);
      if (o.href !== url.href && family(o) === family(url) && (HASHED.test(o.pathname) === HASHED.test(url.pathname))) await cache.delete(old);
    }
  }
  let copy = response.clone();
  if (name === CODE) {
    const headers = new Headers(copy.headers);
    headers.set(AT, String(Date.now()));
    copy = new Response(await copy.blob(), { status: copy.status, statusText: copy.statusText, headers });
  }
  await cache.put(url.href, copy);
}

async function cacheFirst(name, request) {
  const hit = await caches.match(request.url, { cacheName: name });
  if (hit) return hit;
  const res = await fetch(request);
  await keep(name, request, res).catch(() => {});
  return res;
}

// A page is kept once, under its address without ?debug and the like: always the latest copy.
const pageKey = (url) => new URL(url).origin + new URL(url).pathname;

async function networkFirst(request, navigate) {
  const key = navigate ? new Request(pageKey(request.url)) : request;
  try {
    const res = await fetch(request);
    if (res.ok) await keep(SITE, key, res).catch(() => {});
    return res;
  } catch (err) {
    // Offline: the copy from the last visit.
    const hit = await caches.match(key.url, { cacheName: SITE });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const name = cacheFor(url);
  if (!name) return;
  if (request.mode === "navigate") return event.respondWith(networkFirst(request, true));
  if (name === SITE && isData(url)) return event.respondWith(networkFirst(request, false));
  event.respondWith(cacheFirst(name, request));
});

// Files to keep for later, from the pages (offline.js): what the page loaded before this worker was
// running, and the other kids' sheets and the announcer's clips once the title screen is up. One at
// a time, quietly, skipping what's already kept.
let queue = Promise.resolve();
self.addEventListener("message", (event) => {
  if (event.data?.type !== "keep" || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.slice(0, 200);
  queue = queue.then(async () => {
    for (const href of urls) {
      try {
        const url = new URL(href, location.origin);
        const name = cacheFor(url);
        if (!name || (await caches.match(url.href, { cacheName: name }))) continue;
        const res = await fetch(url.href, { priority: "low" });
        await keep(name, new Request(url.href), res);
      } catch {
        // Offline or gone: it's fetched when it's needed.
      }
    }
  });
  event.waitUntil(queue);
});

// A new deploy: the pages and the code now, and fresh copies of the unstamped files the last one
// kept (so the court and the lists still work offline straight after).
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const site = await caches.open(SITE);
      for (const page of PAGES) await fetch(page, { cache: "no-cache" }).then((res) => keep(SITE, new Request(page), res)).catch(() => {});
      const code = await caches.open(CODE);
      for (const path of BUILD) if (!(await code.match(path))) await keep(CODE, new Request(path), await fetch(path));
      for (const name of await caches.keys()) {
        if (!name.startsWith("site-") || name === SITE) continue;
        for (const old of await (await caches.open(name)).keys()) {
          if (new URL(old.url).pathname.endsWith("/") || old.url.endsWith(".html")) continue;
          if (await site.match(old.url)) continue;
          await fetch(old.url, { cache: "no-cache" }).then((res) => keep(SITE, old, res)).catch(() => {});
        }
      }
      await self.skipWaiting();
    })(),
  );
});

// Drops the last deploy's pages and unstamped files, and code no page uses any more: not in this
// build, and cached before it was made (a newer page may have fetched files this worker doesn't
// know about yet).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith("site-") && name !== SITE) await caches.delete(name);
      const code = await caches.open(CODE);
      for (const req of await code.keys()) {
        if (BUILD.has(new URL(req.url).pathname)) continue;
        const res = await code.match(req);
        if (+(res?.headers.get(AT) ?? 0) < BUILT_AT) await code.delete(req);
      }
      await self.clients.claim();
    })(),
  );
});
