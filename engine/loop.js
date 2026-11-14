// The frame loop: calls tick(dt) once per animation frame with the seconds since the last one,
// capped at 0.05 so a stall (a hidden tab, a slow frame) doesn't jump the game ahead.
// A frame that throws is logged and the loop carries on: one bad frame mustn't freeze the game.
export function startLoop(tick) {
  let last;
  let errors = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      tick(dt);
    } catch (err) {
      if (errors++ < 5) console.error(err); // the first few (a broken frame repeats every frame)
    }
  }
  requestAnimationFrame((now) => {
    last = now;
    frame(now);
  });
}
