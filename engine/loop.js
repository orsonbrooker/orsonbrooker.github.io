// The frame loop: calls tick(dt) once per animation frame with the seconds since the last one,
// capped at 0.05 so a stall (a hidden tab, a slow frame) doesn't jump the game ahead.
export function startLoop(tick) {
  let last;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame((now) => {
    last = now;
    frame(now);
  });
}
