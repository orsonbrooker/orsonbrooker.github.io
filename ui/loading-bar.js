// A chunky pixel loading bar (styles.css .loading-bar) for anything a kid waits for: it fills as the
// download comes in (engine/download.js Progress), and slides along when the size isn't known yet.

/** A new bar: `bar.follow(progress)` fills it from a Progress; `bar.set(fraction | null)` by hand. */
export function loadingBar(label = "Loading") {
  const bar = document.createElement("div");
  bar.className = "loading-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", label);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const fill = document.createElement("span");
  bar.append(fill);
  let stop = null;
  return Object.assign(bar, {
    set(fraction) {
      const known = typeof fraction === "number";
      bar.classList.toggle("unknown", !known);
      // (shown in steps of a twentieth, so it fills like pixel blocks)
      if (known) fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 20) * 5}%`;
      if (known) bar.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
      else bar.removeAttribute("aria-valuenow");
    },
    follow(progress) {
      stop?.();
      stop = progress ? progress.on((f) => bar.set(f)) : null;
      if (!progress) bar.set(0);
    },
  });
}

/**
 * Shows a loading bar in `parent` following `progress` until `until` (a promise) settles, unless it's
 * in first: a wait shorter than a blink shows nothing, so things already loaded don't flash a bar.
 * `parent` is marked busy for screen readers meanwhile. Returns the bar.
 */
export function showLoading(parent, progress, until, label = "Loading", { className = "", delay = 120 } = {}) {
  const bar = loadingBar(label);
  if (className) bar.classList.add(className);
  if (!progress || !parent) return bar;
  bar.follow(progress);
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    parent.append(bar);
    parent.setAttribute("aria-busy", "true");
  }, delay);
  Promise.resolve(until)
    .catch(() => {})
    .finally(() => {
      done = true;
      clearTimeout(timer);
      bar.follow(null);
      bar.remove();
      parent.removeAttribute("aria-busy");
    });
  return bar;
}
