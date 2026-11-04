// Pixel art effects from pixelfx (vendor/pixelfx, MIT), drawn as chunky pixels over the court.
// Each effect pixel covers SCALE x SCALE court pixels. Every effect gets its own small frame round where it
// is, so only the pixels near an effect are composited each frame.
import { createFrame, clearFrame, createFx, composite } from "./vendor/pixelfx/src/core/index.js";
import * as fireworkBurst from "./vendor/pixelfx/src/fx/explosions/firework-burst.js";
import * as collectBurst from "./vendor/pixelfx/src/fx/pickups/collect-burst.js";
import * as ballFire from "./effects/ball-fire.js";
import * as shoeFire from "./effects/shoe-fire.js";
import * as hitSpark from "./vendor/pixelfx/src/fx/impacts/hit-spark.js";

export const SCALE = 4;

// Dark to white ramps.
export const PALETTES = {
  gold: ["#4a2c08", "#86520c", "#c48412", "#f0b424", "#ffe066", "#fff6c4", "#ffffff"],
  pink: ["#3d0a33", "#701560", "#b0228f", "#f53cd1", "#ff86e6", "#ffd2f6", "#ffffff"],
  cyan: ["#06222e", "#0b4a5e", "#147d96", "#22b4cc", "#7cf0ff", "#c8faff", "#ffffff"],
  green: ["#06260f", "#0d4d22", "#167a38", "#25a84f", "#3ddc84", "#b4f5cf", "#ffffff"],
  fire: ["#4a1712", "#8a1f17", "#c9281f", "#f2561d", "#ff8a2a", "#ffc23d", "#ffe26b", "#fff3a6", "#ffffff"],
  purpleFire: ["#1e0a33", "#3b1066", "#5a1a9e", "#7b2cff", "#9d5cff", "#c77dff", "#ddb0ff", "#f6d6ff", "#ffffff"],
  spark: ["#3a1a10", "#8a3a14", "#c9681f", "#f2a43d", "#ffe26b", "#fff3a6", "#ffffff"],
};

const seed = () => (Math.random() * 1e6) | 0;

export function createFxLayer() {
  let live = [];

  // box: [width, height, origin x, origin y] of the effect's frame, in effect pixels.
  function add(mod, x, y, options = {}, { delay = 0, box, under = false } = {}) {
    const [w, h, bx, by] = box ?? [...mod.meta.size, ...mod.meta.origin].map((v, i) => (i < 2 ? v + 16 : v + 8));
    const frame = createFrame(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const e = {
      fx: createFx(mod, { seed: seed(), ...options, x: bx, y: by, wx: x / SCALE, wy: y / SCALE }),
      delay, under, frame, canvas,
      g: canvas.getContext("2d"),
      image: new ImageData(w, h),
      bx, by, x, y,
      // Follow something that moves (court pixels); angle in radians.
      move(nx, ny) {
        e.x = nx;
        e.y = ny;
        e.fx.options.wx = nx / SCALE;
        e.fx.options.wy = ny / SCALE;
      },
      hidden: false,
      stop: () => e.fx.stop(),
    };
    live.push(e);
    return e;
  }

  function drawOne(ctx, e, layer) {
    clearFrame(e.frame);
    e.fx.draw(e.frame, layer);
    composite(e.frame, e.image.data);
    e.g.putImageData(e.image, 0, 0);
    const left = Math.round(e.x / SCALE) - e.bx;
    const top = Math.round(e.y / SCALE) - e.by;
    ctx.drawImage(e.canvas, left * SCALE, top * SCALE, e.canvas.width * SCALE, e.canvas.height * SCALE);
  }

  return {
    PALETTES,
    // A burst of twinkles where a clean swish drops through the rim.
    swish(x, y, palette = "cyan") {
      add(collectBurst, x, y + 30 * SCALE, { palette: [PALETTES[palette][0], ...PALETTES[palette]] });
    },
    // Fireworks going off over the court, one after another.
    fireworks(courtW) {
      const shows = [
        [0.3, 0.24, "gold", 0],
        [0.72, 0.18, "pink", 0.35],
        [0.5, 0.34, "cyan", 0.75],
        [0.18, 0.4, "green", 1.15],
        [0.82, 0.38, "gold", 1.5],
      ];
      for (const [x, y, p, d] of shows) add(fireworkBurst, courtW * x, courtW * y, { palette: PALETTES[p], core: PALETTES.gold }, { delay: d });
    },
    // Flame streaming behind a ball along the path it took. Returns a handle: move(x, y) each frame, stop() to end.
    fireTrail(x, y, { palette = "fire", radius = 5 } = {}) {
      return add(ballFire, x, y, { palette: PALETTES[palette], radius }, { under: true });
    },
    // Flames on a player's shoes. feet: two [x, y] points (court pixels) at the bottom of each shoe.
    // Returns a handle: moveFeet(feet) every frame, stop() to end.
    shoeFire(feet, palette = "fire") {
      const e = add(shoeFire, 0, 0, { palette: PALETTES[palette] }, { box: [110, 110, 55, 80] });
      e.moveFeet = (pts) => {
        // the frame sits between the feet; each foot is passed in effect pixels from there
        const mx = (pts[0][0] + pts[1][0]) / 2, my = Math.max(pts[0][1], pts[1][1]);
        e.move(mx, my);
        e.fx.options.feet = pts.map(([x, y]) => [(x - mx) / SCALE, (y - my) / SCALE]);
      };
      e.moveFeet(feet);
      return e;
    },
    // Sparks knocked off the rim or board; floorDrop is how far below the hit the floor is (court pixels).
    spark(x, y, { floorDrop = 400, flip = false, aim = -0.3 } = {}) {
      const h = Math.round(floorDrop / SCALE);
      add(hitSpark, x, y + h * SCALE, { palette: PALETTES.spark, height: h, aim, flip }, { box: [130, h + 50, 65, h + 10] });
    },
    clear() {
      live = [];
    },
    update(dt) {
      for (const e of live) {
        if (e.delay > 0) e.delay -= dt;
        else e.fx.update(dt);
      }
      live = live.filter((e) => e.delay > 0 || !e.fx.done());
    },
    // pass "under": things drawn behind balls and players (fire trails, back halves of floor effects).
    // pass "over": everything else, on top. ctx is already scaled to the court.
    draw(ctx, pass = "over") {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      for (const e of live) {
        if (e.delay > 0 || e.hidden) continue;
        if (e.under) {
          if (pass === "under") drawOne(ctx, e);
        } else drawOne(ctx, e, pass === "under" ? "back" : "front");
      }
      ctx.restore();
    },
  };
}
