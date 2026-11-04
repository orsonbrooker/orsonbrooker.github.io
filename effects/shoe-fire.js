// Flames licking up round a player's shoes while they're on fire, made from pixelfx's flame tongues.
// The shoes can move every frame (o.feet), so the flames stay on them through jumps and steps. Tongues behind
// the shoes draw in the back layer, the rest in front.
import { fit, mix, WHITE } from "../vendor/pixelfx/src/core/index.js";
import { hotFirst, flameTongue, ember, noiseFor, LAYERS, BACK_LAYERS } from "../vendor/pixelfx/src/fx/fire/_lib.js";

export const meta = {
  name: "Shoe fire",
  size: [60, 40],
  origin: [30, 32],
  duration: 1e6,
  loop: true,
  options: {
    palette: ["#4a1712", "#8a1f17", "#c9281f", "#f2561d", "#ff8a2a", "#ffc23d", "#ffe26b", "#fff3a6", "#ffffff"],
    feet: [[-8, 0], [8, 0]], // the bottom middle of each shoe, from the origin (effect pixels); updated live
  },
};

// tongues per foot: [x offset, height, half-width, back?]
const TONGUES = [[-3, 9, 2.4, true], [3, 8, 2.2, true], [-2.5, 13, 2.8, false], [1.5, 16, 3, false], [4.5, 10, 2.4, false]];

export function create(o) {
  const F = fit(o.palette, 9), H = hotFirst(F);
  const GLOW = mix(H[3], WHITE, 0.2), EMB = [H[1], H[2], H[4], H[6]];
  const NL = noiseFor(0), seed = o.seed % 1000;
  const embers = [];
  let t = 0, acc = 0;

  const tongues = (p, back) => {
    const N = (rate, s = 0, off = 0) => NL(t, rate, s + seed, off);
    o.feet.forEach(([fx, fy], f) => {
      TONGUES.forEach(([x, h, w, isBack], i) => {
        if (isBack !== back) return;
        const n = f * 40 + i * 7;
        const hh = h * (0.75 + 0.35 * (0.5 + 0.5 * N(3, n))) * (1 + 0.3 * Math.max(0, N(1.7, n + 3)));
        flameTongue(p, fx + x, fy + (back ? -2 : 0), hh, w, N(2, n + 5) * 2, N, n, H, back ? BACK_LAYERS : LAYERS, 0.5, 1.2);
      });
    });
  };

  return {
    update(dt) {
      t += dt;
      for (acc += dt * 10; acc > 1; acc--) {
        const [fx, fy] = o.feet[Math.random() < 0.5 ? 0 : 1];
        embers.push({ x: fx + (Math.random() - 0.5) * 8, y: fy - 6, vx: (Math.random() - 0.5) * 12, vy: -20 - Math.random() * 25, age: 0, life: 0.4 + Math.random() * 0.4, ph: Math.random() * 6 });
      }
      for (const e of embers) {
        e.age += dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }
      for (let i = embers.length - 1; i >= 0; i--) if (embers[i].age > embers[i].life) embers.splice(i, 1);
    },
    drawBack(p) {
      tongues(p, true);
    },
    draw(p) {
      tongues(p, false);
      for (const e of embers) ember(p, e.x, e.y, 1 - e.age / e.life, 1, EMB, e.age * 40 + e.ph);
      const fl = 0.85 + 0.15 * NL(t, 8, seed);
      for (const [fx, fy] of o.feet) p.glow(fx, fy - 3, 14, GLOW, 0.3 * fl);
    },
  };
}
