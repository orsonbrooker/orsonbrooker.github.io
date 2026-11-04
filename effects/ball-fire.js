// A fire trail for a flying ball, made from pixelfx's fire pieces (the fireball's puffs, smoke and embers).
// Unlike pixelfx's fireball, whose tail is fixed to the head, flame puffs are dropped where the ball has been,
// so the tail bends along the ball's real path. The ball's position comes in as o.wx, o.wy (effect pixels),
// updated every frame; the effect is drawn round that point.
import { fit, mix, hex, WHITE } from "../vendor/pixelfx/src/core/index.js";
import { hotFirst, firePuff, smokePuff, ember, flameBlade, noiseFor, LAYERS } from "../vendor/pixelfx/src/fx/fire/_lib.js";

export const meta = {
  name: "Ball fire",
  size: [380, 380],
  origin: [190, 190],
  duration: 1e6,
  loop: true,
  options: {
    palette: ["#4a1712", "#8a1f17", "#c9281f", "#f2561d", "#ff8a2a", "#ffc23d", "#ffe26b", "#fff3a6", "#ffffff"],
    radius: 5,
    wx: 0,
    wy: 0,
  },
};

const SMOKE1 = hex("#5b5566");

export function create(o) {
  const F = fit(o.palette, 9), H = hotFirst(F), R0 = o.radius;
  const GLOW = mix(mix(H[3], H[4], 0.5), WHITE, 0.25), SMOKE = mix(SMOKE1, H[6], 0.3), EMB = [H[1], H[2], H[4], H[6]];
  const NL = noiseFor(0), seed = o.seed % 1000;
  const puffs = [], embers = [];
  let t = 0, lx = o.wx, ly = o.wy, dx = 1, dy = 0, acc = 0, eacc = 0;
  const rand = (a, b) => a + Math.random() * (b - a);

  return {
    update(dt) {
      t += dt;
      const mx = o.wx - lx, my = o.wy - ly, moved = Math.hypot(mx, my);
      if (moved > 0.01) {
        // which way it's heading, smoothed so the head doesn't twitch
        const k = Math.min(1, dt * 30);
        dx += (mx / moved - dx) * k;
        dy += (my / moved - dy) * k;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
      }
      // drop puffs along the stretch just travelled so fast balls leave no gaps
      for (acc += dt * 150; acc > 1; acc--) {
        const u = Math.random();
        const fl = rand(0.3, 0.6);
        puffs.push({
          x: lx + mx * u + rand(-1, 1) * R0 * 0.7,
          y: ly + my * u + rand(-1, 1) * R0 * 0.7,
          vx: rand(-12, 12), vy: rand(-18, 6),
          age: 0, fl, sm: Math.random() < 0.5, sl: rand(0.25, 0.45),
          s: rand(1.4, 3), f: Math.random(),
        });
      }
      for (eacc += dt * 28; eacc > 1; eacc--) {
        embers.push({ x: o.wx + rand(-2, 2), y: o.wy + rand(-2, 2), vx: rand(-25, 25), vy: rand(-30, 10), age: 0, life: rand(0.3, 0.6), big: Math.random() < 0.25, ph: rand(0, 6.3) });
      }
      lx = o.wx;
      ly = o.wy;
      for (const q of puffs) {
        q.age += dt;
        q.vy -= 70 * dt; // flame rises
        q.vx *= 1 - 4 * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
      }
      for (const e of embers) {
        e.age += dt;
        e.vy += 50 * dt; // embers cool and fall
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }
      for (let i = puffs.length - 1; i >= 0; i--) if (puffs[i].age > puffs[i].fl + (puffs[i].sm ? puffs[i].sl : 0)) puffs.splice(i, 1);
      for (let i = embers.length - 1; i >= 0; i--) if (embers[i].age > embers[i].life) embers.splice(i, 1);
    },
    draw(p) {
      const ox = o.wx, oy = o.wy;
      const N = (rate, s = 0, off = 0) => NL(t, rate, s + seed, off);
      // smoke first, then flame puffs oldest (coolest) first so the hot ones sit on top
      for (const q of puffs) if (q.sm && q.age > q.fl) smokePuff(p, q.x - ox, q.y - oy, 1 - (q.age - q.fl) / q.sl, q.s * 0.9, SMOKE);
      const fire = puffs.filter((q) => q.age < q.fl).sort((a, b) => b.age - a.age);
      for (const q of fire) {
        const u = q.age / q.fl;
        firePuff(p, q.x - ox, q.y - oy, 1 - u, q.s * (1 + 1.3 * u), q.f, H, 0.07, -dx * 0.86, -dy * 0.86 - 0.3);
      }
      // the head: short tongues licking back off the ball
      [[0, 14, 4.2], [-0.5, 10, 3.4], [0.5, 10, 3.4]].forEach(([off, len, w], i) => {
        const n = i * 17 + 3, L = len * (0.8 + 0.3 * N(5, n)) * (R0 / 5);
        flameBlade(p, -dx * R0 * 0.5 - dy * off * R0, -dy * R0 * 0.5 + dx * off * R0, -dx, -dy, L, w * R0 / 5, N(3, n + 5) * 2, N, n, H, LAYERS, 0.5, 1);
      });
      for (const e of embers) ember(p, e.x - ox, e.y - oy, 1 - e.age / e.life, e.big ? 2 : 1, EMB, e.age * 40 + e.ph);
      const fl = 0.85 + 0.15 * N(9, 7);
      p.glow(0, 0, 40, GLOW, 0.4 * fl);
      p.glow(0, 0, 13, H[1], 0.3 * fl);
    },
  };
}
