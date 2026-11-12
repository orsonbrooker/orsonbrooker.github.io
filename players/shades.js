// Shade ramps: how a player's chosen colour becomes light and shade.
//
// Every pixel of a colour region (skin, hair, jersey, team, shoes) is placed by how light it is
// among all the pixels of that region on the sheet, every frame together (mostly its rank, so a
// region drawn dark or light spreads over the whole ramp). That place is a point on a ramp of
// STEPS shades made from the chosen colour in OKLCH (a colour space where equal steps of lightness
// look equal): the chosen colour as the fourth, three shadows below and two highlights above, a
// fixed step of lightness between them. Near black or white the shades that would go past the end
// are squeezed in, the chosen colour moving only if they'd be too close to tell apart, so black
// hair stays black and still shows its shape, and a white jersey stays white with its folds. The
// shades lose a little colour toward the ends (most in the highlights) and turn a few degrees
// cooler in the shadows and warmer in the highlights. A lookup table per region swaps each pixel's
// lightness for its shade, so recolouring stays one table read per pixel.

// How much of a region each shade covers, darkest first: the chosen colour (the fourth) the most,
// a deep shadow and a highlight the least. A pixel between two shades' middles is blended.
const SHARES = [0.08, 0.14, 0.22, 0.3, 0.18, 0.08];
export const STEPS = SHARES.length;
const MID = 3; // the shade that is the chosen colour
const STEP_L = 0.09; // OKLCH lightness between neighbouring shades, in the shadows
const STEP_UP = 0.06; // and in the highlights (gentler, so a lit cheek doesn't go pale)
const MIN_STEP_L = 0.035; // the least, when squeezed near black or white
const MIN_L = 0.1; // the darkest a shade may be
const MAX_L = 0.94; // the lightest (any higher and yellow turns cream)
const MAX_GREY_L = 0.985; // the lightest for whites and greys, which can't turn cream
const GREY = 0.04; // OKLCH chroma below which a colour counts as a grey
const SHADOW_CHROMA = 0.15; // how much colour the darkest shade loses
const LIGHT_CHROMA = 0.3; // and the lightest
const HUE_SHIFT = 8; // degrees toward blue in the shadows, toward yellow in the highlights
const COOL = 265;
const WARM = 75;
const GOLD = 50; // where yellows' shadows turn instead (toward blue they'd go green)
const RANK = 0.65; // how much a pixel's place is its rank (the rest is its lightness, stretched)
const CLIP = 2; // see shadeRanks

// Lightness of an sRGB pixel, 0..255 (integer weights, fast enough for every pixel of a sheet).
export const lightness = (r, g, b) => (77 * r + 150 * g + 29 * b) >> 8;

// For each region id, the place of each lightness 0..255 among that region's pixels, 0..1.
// `sources` are { px: RGBA bytes, region: (pixel index) => region id }; pixels that are clear
// or in no region don't count.
export function shadeRanks(sources) {
  const counts = new Map();
  for (const { px, region } of sources) {
    for (let i = 0, n = px.length >> 2; i < n; i++) {
      if (!px[i * 4 + 3]) continue;
      const id = region(i);
      if (!id) continue;
      let c = counts.get(id);
      if (!c) counts.set(id, (c = new Uint32Array(256)));
      c[lightness(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])]++;
    }
  }
  const ranks = {};
  for (const [id, hist] of counts) {
    let total = 0;
    for (const v of hist) total += v;
    // the region's own range of lightness (leaving out the odd few at each end)
    let lo = 0;
    let hi = 255;
    for (let n = 0; lo < 255 && (n += hist[lo]) < total * 0.02; lo++);
    for (let n = 0; hi > lo && (n += hist[hi]) < total * 0.02; hi--);
    // No lightness may hold more than CLIP times its fair share, so a big flat area (a cheek, a
    // jersey's front) isn't stretched into blotches by the little noise it has.
    const cap = (CLIP * total) / (hi - lo + 1);
    const c = hist.map((v) => Math.min(v, cap));
    let kept = 0;
    for (const v of c) kept += v;
    const rank = new Float32Array(256);
    let below = 0;
    for (let l = 0; l < 256; l++) {
      // a lightness shared by many pixels sits at the middle of its share
      const r = (below + c[l] / 2) / kept;
      below += c[l];
      const stretched = Math.min(1, Math.max(0, (l - lo) / Math.max(1, hi - lo)));
      rank[l] = RANK * r + (1 - RANK) * stretched;
    }
    rank.count = total; // how many pixels it was made from
    ranks[id] = rank;
  }
  return ranks;
}

// The colour ("#rrggbb") at shade k (0 darkest .. STEPS - 1 lightest, in between blends), as a
// function of k, giving [r, g, b] bytes.
export function shadeRamp(hex) {
  let [L, C, h] = toOklch(hexRgb(hex));
  const up = STEPS - 1 - MID;
  // squeeze the shades that would go past black or white, moving the chosen colour only if needed
  const down = Math.min(STEP_L, Math.max(MIN_STEP_L, (L - MIN_L) / MID));
  L = Math.max(L, MIN_L + MID * down);
  const top = C < GREY ? MAX_GREY_L : MAX_L;
  const rise = Math.min(STEP_UP, Math.max(MIN_STEP_L * 0.75, (top - L) / up));
  L = Math.min(L, top - up * rise);
  return (k) => {
    const u = k < MID ? (k - MID) / MID : (k - MID) / up; // -1 darkest .. 1 lightest
    let Lk = L + (k - MID) * (k < MID ? down : rise);
    const Ck = C * (1 - (u < 0 ? SHADOW_CHROMA : LIGHT_CHROMA) * u * u);
    const hk = turn(h, u < 0 ? (h > 70 && h < 130 ? GOLD : COOL) : WARM, HUE_SHIFT * Math.abs(u));
    // a highlight that can't be this colourful so light (yellow near white) gives up some light
    while (Lk > L && !fits(Lk, Ck * 0.85, hk)) Lk -= 0.005;
    return fromOklch(Lk, Ck, hk);
  };
}

// The middle of each shade's share of the region, 0..1.
const MIDDLES = SHARES.map((s, k) => SHARES.slice(0, k).reduce((a, b) => a + b, 0) + s / 2);

// The ramp of a colour sampled finely once (SAMPLES points from darkest to lightest, 3 bytes each),
// so many tables of the same colour (one per frame) are quick to make.
const SAMPLES = 256;
export function shadeSamples(hex) {
  const ramp = shadeRamp(hex);
  const out = new Uint8ClampedArray(SAMPLES * 3);
  for (let n = 0; n < SAMPLES; n++) out.set(ramp(((STEPS - 1) * n) / (SAMPLES - 1)), n * 3);
  return out;
}

// A region's lookup table: lightness 0..255 -> its colour, 3 bytes each, from its ranks and the
// colour's samples (shadeSamples).
export function shadeTable(rank, samples) {
  const table = new Uint8ClampedArray(256 * 3);
  for (let l = 0; l < 256; l++) {
    const p = rank[l];
    let k = 0;
    while (k < STEPS - 1 && p > MIDDLES[k + 1]) k++;
    const at = p <= MIDDLES[0] ? 0 : k === STEPS - 1 ? k : k + (p - MIDDLES[k]) / (MIDDLES[k + 1] - MIDDLES[k]);
    const n = Math.round((at / (STEPS - 1)) * (SAMPLES - 1)) * 3;
    table[l * 3] = samples[n];
    table[l * 3 + 1] = samples[n + 1];
    table[l * 3 + 2] = samples[n + 2];
  }
  return table;
}

// --- OKLab / OKLCH (Björn Ottosson's), sRGB bytes in and out ---

const hexRgb = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const toLinear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toByte = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));

function toOklch(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

function oklchLinear(L, C, h) {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// The colour, with its chroma lowered until it fits in sRGB (so its lightness and hue stay).
const fits = (L, C, h) => oklchLinear(L, C, h).every((v) => v >= -1e-4 && v <= 1 + 1e-4);

function fromOklch(L, C, h) {
  if (!fits(L, C, h)) {
    let lo = 0;
    for (let i = 0; i < 16; i++) {
      const c = (lo + C) / 2;
      if (fits(L, c, h)) lo = c;
      else C = c;
    }
    C = lo;
  }
  return oklchLinear(L, C, h).map((v) => toByte(Math.min(1, Math.max(0, v))));
}

// Hue h turned up to `by` degrees toward `to`, the short way round (never past it).
function turn(h, to, by) {
  const d = ((to - h + 540) % 360) - 180;
  return (h + Math.sign(d) * Math.min(Math.abs(d), by) + 360) % 360;
}
