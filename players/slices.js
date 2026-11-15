// Long pixel work (recolouring a whole sheet, stretching every frame) without freezing the page: the work is
// written once, as a generator that yields between rows or frames, and run either straight through
// (`runNow`, for code that needs the answer at once) or in slices of about SLICE ms with the page let back in
// between (`runSliced`, so taps, scrolling and drawing carry on). Same code, so the same pixels either way.

const SLICE = 25; // ms of work before the page gets a turn

/** Runs a step generator to the end at once and returns its result. */
export function runNow(steps) {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

// The page's turn: input, drawing and timers run before the work carries on.
const breather = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));

/** Thrown by runSliced when the work stopped being wanted (a newer one replaced it). */
export class Stale extends Error {
  name = "Stale";
}

/**
 * Runs a step generator a slice at a time, letting the page in between; resolves to its result. `wanted`
 * (optional) is asked at each break: once it says no, the work stops there and rejects with Stale (the
 * steps only save anything, a cache or a result, at their end, so a stopped one leaves nothing half done).
 */
export async function runSliced(steps, wanted = null) {
  let since = performance.now();
  let r = steps.next();
  while (!r.done) {
    if (performance.now() - since > SLICE) {
      await breather();
      if (wanted && !wanted()) {
        steps.return();
        throw new Stale();
      }
      since = performance.now();
    }
    r = steps.next();
  }
  return r.value;
}
