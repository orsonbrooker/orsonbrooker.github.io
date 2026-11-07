// A little buzz in the hand in the iOS app (Capacitor's Haptics plugin, ios/): a tap for a basket,
// a thump for catching fire. Does nothing on the website, or when the sound is off.

const plugin = () => globalThis.Capacitor?.Plugins?.Haptics;

export function buzz(kind) {
  const haptics = plugin();
  if (!haptics) return;
  const style = kind === "fire" ? "HEAVY" : "LIGHT";
  haptics.impact({ style }).catch(() => {});
}
