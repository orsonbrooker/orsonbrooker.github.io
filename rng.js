// Seeded random numbers for gameplay, so the same seed and the same inputs always give the same game.
// The seed is the game's start token; each purpose gets its own stream, so an extra draw in one
// (say, a new kind of spot) doesn't change what the others give.

// cyrb128: hashes text into four 32-bit numbers to start a generator from.
function cyrb128(text) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// sfc32: a small, fast, well-tested generator. Returns numbers in [0, 1), like Math.random.
function sfc32(a, b, c, d) {
  const next = () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next(); // warm up, so similar seeds don't start out alike
  return next;
}

// One generator for each named stream, all from the same seed.
export function seededStreams(seed, names) {
  return Object.fromEntries(names.map((name) => [name, sfc32(...cyrb128(`${seed}#${name}`))]));
}

// A seed for games with no start token (offline, or the server can't be reached).
export function randomSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "local." + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
