// Offline play on the website: starts the service worker (sw.js) once the page has loaded, and hands
// it files to keep. Every page loads this. Not in the iOS app (its files are inside it), and not in
// `npm run dev` (Vite's dev server serves files that change under the same name).

import { IN_APP } from "./api.js";

const usable = "serviceWorker" in navigator && !IN_APP && import.meta.env.PROD;

// What this page has loaded so far: on the first visit, files fetched before the worker was running
// aren't kept yet.
const loaded = () => performance.getEntriesByType("resource").map((e) => e.name).filter((u) => u.startsWith(location.origin));

/** Asks the service worker to keep these files (site addresses), and what the page has loaded so far:
 * fetched quietly, one at a time, skipping what's already kept. The extra files are skipped when the
 * device asks to save data. */
export function keepForLater(urls = []) {
  if (!usable) return;
  const extra = navigator.connection?.saveData ? [] : urls.map((u) => new URL(u, document.baseURI).href);
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "keep", urls: [...loaded(), ...extra] })).catch(() => {});
}

/** Whether a failed request was the network being down (rather than the server saying no). */
export const offline = (err) => !navigator.onLine || err instanceof TypeError;

function start() {
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => {
      keepForLater();
      setTimeout(keepForLater, 10000); // and what came after the load event
    })
    .catch(() => {});
}

if (usable) {
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
}
