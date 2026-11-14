// Downloads that report how far along they are, so anything a kid waits for can show a loading bar
// (ui/loading-bar.js). A `Progress` adds up the bytes of several files (a sheet and its colour map);
// a file whose size the server didn't say makes the bar move without a fraction until it's in.

/** How far along a set of downloads is: `fraction` is 0 to 1, or null while a size isn't known. */
export class Progress {
  constructor() {
    this.parts = new Map(); // name -> [bytes in, bytes in all (0: not known)]
    this.listeners = new Set();
    this.fraction = 0;
    this.finished = false;
  }

  /** A file joining the set: returns the function its download calls with (bytes in, bytes in all). */
  part(name) {
    this.parts.set(name, [0, 0]);
    this.update();
    return (got, total) => {
      this.parts.set(name, [got, total]);
      this.update();
    };
  }

  update() {
    let got = 0;
    let total = 0;
    let unknown = false;
    for (const [g, t] of this.parts.values()) {
      if (!t) unknown = true;
      got += Math.min(g, t || g);
      total += t;
    }
    this.fraction = this.finished ? 1 : unknown && !total ? null : total ? Math.min(0.99, got / total) : 0;
    for (const fn of this.listeners) fn(this.fraction);
  }

  /** Another Progress joining this one (the same files, already loading for someone else). */
  include(other) {
    const report = this.part(other);
    other.on((f) => report(f === null ? 0 : Math.round(f * 1000), f === null ? 0 : 1000));
  }

  /** Everything's in. */
  finish() {
    this.finished = true;
    this.update();
  }

  /** Calls `fn(fraction)` now and on every change; returns a function that stops it. */
  on(fn) {
    this.listeners.add(fn);
    fn(this.fraction);
    return () => this.listeners.delete(fn);
  }
}

/** Fetches `url` as a Blob, calling `onBytes(got, total)` as it comes in (total 0: not known). */
export async function fetchBlob(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  // (a compressed answer's length is its compressed size, so it can't be compared with what's read)
  const total = res.headers.get("Content-Encoding") ? 0 : Number(res.headers.get("Content-Length")) || 0;
  if (!onBytes || !res.body) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  onBytes(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes(got, total);
  }
  return new Blob(chunks, { type: res.headers.get("Content-Type") ?? "" });
}

/**
 * Loads an image, reporting its bytes to `progress` (a Progress, optional). It's decoded before it's
 * handed back (off the main thread where the browser can), so drawing it first doesn't stall a frame.
 * Without a Progress it loads the plain way, which the browser can start sooner.
 */
export async function loadImage(src, progress) {
  const img = new Image();
  img.crossOrigin = "anonymous"; // so its pixels can be read when the site is on another origin (the admin page, run locally)
  let blobUrl = null;
  if (progress) {
    const blob = await fetchBlob(src, progress.part(src));
    blobUrl = URL.createObjectURL(blob);
  }
  img.src = blobUrl ?? src;
  img.sourceUrl = src; // (its src may be a passing blob: address; this one stays, for caches keyed by it)
  try {
    await img.decode();
  } catch (err) {
    // decode() can turn down a fine image (a very big one, on some browsers): wait for it the old way
    if (img.complete && !img.naturalWidth) throw err; // it really didn't load
    if (!img.complete) await new Promise((resolve, reject) => ((img.onload = resolve), (img.onerror = () => reject(err))));
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
  return img;
}
